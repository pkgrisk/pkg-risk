"""Continuous analysis pipeline daemon."""

from __future__ import annotations

import asyncio
import logging
import signal
import time
from datetime import datetime, timezone
from pathlib import Path

from pkgrisk.adapters.homebrew import HomebrewAdapter
from pkgrisk.adapters.npm import NpmAdapter
from pkgrisk.adapters.pypi import PyPiAdapter
from pkgrisk.analyzers.pipeline import AnalysisPipeline
from pkgrisk.daemon.publisher import GitHubPublisher
from pkgrisk.daemon.work_queue import QueuedPackage, WorkQueue
from pkgrisk.models.schemas import DataAvailability, Ecosystem
from pkgrisk.monitoring import MetricsCollector

logger = logging.getLogger(__name__)


class RateLimitExhausted(Exception):
    """Raised when GitHub API rate limit is exhausted."""

    def __init__(self, reset_time: datetime, remaining: int = 0):
        self.reset_time = reset_time
        self.remaining = remaining
        super().__init__(f"Rate limit exhausted, resets at {reset_time}")


class ContinuousPipeline:
    """Daemon for continuous package analysis.

    Runs indefinitely, analyzing packages from a work queue while
    handling rate limits and supporting graceful shutdown.

    Features:
    - Interleaved analysis of new and stale packages
    - Automatic rate limit detection and sleep
    - Graceful shutdown on SIGINT/SIGTERM
    - Integration with MetricsCollector for monitoring
    - Periodic queue refresh to discover new packages
    - Auto-publish to GitHub after N packages

    Usage:
        pipeline = ContinuousPipeline(
            data_dir=Path("data"),
            github_token=os.environ.get("GITHUB_TOKEN"),
        )
        await pipeline.run()  # Runs until SIGINT/SIGTERM
    """

    # Minimum rate limit remaining before preemptive sleep
    RATE_LIMIT_THRESHOLD = 50

    # Seconds to wait after a failed analysis before retrying
    ERROR_BACKOFF_BASE = 5.0
    ERROR_BACKOFF_MAX = 300.0  # 5 minutes max

    # Seconds between queue refreshes (to pick up new packages)
    QUEUE_REFRESH_INTERVAL = 3600  # 1 hour

    def __init__(
        self,
        data_dir: Path = Path("data"),
        github_token: str | None = None,
        skip_llm: bool = True,
        llm_model: str = "llama3.3:70b",
        stale_threshold_days: int = 7,
        interleave_ratio: tuple[int, int] = (3, 1),
        rate_limit_threshold: int = 50,
        publish_interval: int = 50,
        no_publish: bool = False,
        parallel_llm: bool = False,
    ) -> None:
        """Initialize the continuous pipeline.

        Args:
            data_dir: Root data directory for analysis storage
            github_token: GitHub API token (uses GITHUB_TOKEN env if None)
            skip_llm: Whether to skip LLM analysis (default True for speed)
            llm_model: Ollama model name if LLM is enabled
            stale_threshold_days: Days before a package is considered stale
            interleave_ratio: (new, stale) ratio for queue interleaving
            rate_limit_threshold: Preemptively sleep when remaining < this
            publish_interval: Packages between GitHub publishes
            no_publish: Disable auto-publishing to GitHub
            parallel_llm: Run LLM calls in parallel for better GPU utilization
        """
        self.data_dir = data_dir
        self.github_token = github_token
        self.skip_llm = skip_llm
        self.llm_model = llm_model
        self.rate_limit_threshold = rate_limit_threshold
        self.no_publish = no_publish
        self.parallel_llm = parallel_llm

        # Work queue
        self.work_queue = WorkQueue(
            data_dir=data_dir,
            stale_threshold_days=stale_threshold_days,
            interleave_ratio=interleave_ratio,
        )

        # Metrics collector
        self.metrics = MetricsCollector(data_dir / ".metrics.json")

        # Publisher
        self.publisher = GitHubPublisher(
            repo_dir=Path("."),
            publish_interval=publish_interval,
        )

        # Per-ecosystem analysis pipelines
        self._pipelines: dict[Ecosystem, AnalysisPipeline] = {}

        # Shutdown handling
        self._shutdown_requested = False
        self._current_package: QueuedPackage | None = None

        # Error tracking for backoff
        self._consecutive_errors = 0
        self._last_queue_refresh: datetime | None = None

        # Stats
        self._total_analyzed = 0

    def _get_pipeline(self, ecosystem: Ecosystem) -> AnalysisPipeline:
        """Get or create an AnalysisPipeline for an ecosystem.

        Args:
            ecosystem: The package ecosystem

        Returns:
            Configured AnalysisPipeline for the ecosystem
        """
        if ecosystem not in self._pipelines:
            adapter = {
                Ecosystem.HOMEBREW: HomebrewAdapter,
                Ecosystem.NPM: NpmAdapter,
                Ecosystem.PYPI: PyPiAdapter,
            }[ecosystem]()

            pipeline = AnalysisPipeline(
                adapter=adapter,
                data_dir=self.data_dir,
                github_token=self.github_token,
                skip_llm=self.skip_llm,
                llm_model=self.llm_model,
                metrics=self.metrics,
            )
            pipeline.parallel_llm = self.parallel_llm
            self._pipelines[ecosystem] = pipeline

        return self._pipelines[ecosystem]

    def _setup_signal_handlers(self) -> None:
        """Set up signal handlers for graceful shutdown."""

        def handle_shutdown(signum, frame):
            signame = signal.Signals(signum).name
            logger.info(f"Received {signame}, initiating graceful shutdown...")
            self._shutdown_requested = True

            if self._current_package:
                logger.info(
                    f"Waiting for current package to complete: "
                    f"{self._current_package.ecosystem.value}/{self._current_package.name}"
                )

        signal.signal(signal.SIGINT, handle_shutdown)
        signal.signal(signal.SIGTERM, handle_shutdown)

    async def run(self) -> None:
        """Run the continuous analysis daemon.

        This method runs indefinitely until:
        - SIGINT/SIGTERM is received
        - All packages are analyzed and none are stale

        The daemon will:
        1. Refresh the work queue periodically
        2. Analyze packages in interleaved order
        3. Sleep when rate limits are exhausted
        4. Handle errors with exponential backoff
        5. Publish to GitHub periodically
        """
        self._setup_signal_handlers()

        logger.info("Starting continuous analysis daemon...")
        logger.info(f"Data directory: {self.data_dir}")
        logger.info(f"LLM analysis: {'disabled' if self.skip_llm else self.llm_model}")
        logger.info(f"Auto-publish: {'disabled' if self.no_publish else f'every {self.publisher.publish_interval} packages'}")

        # Initial queue refresh
        await self._refresh_queue_if_needed(force=True)

        # Mark daemon as running in metrics
        self.metrics._metrics.is_running = True
        self.metrics._metrics.ecosystem = "all"
        self.metrics._save()

        # Check and update LLM availability
        if not self.skip_llm:
            # Get a pipeline to check LLM
            pipeline = self._get_pipeline(Ecosystem.HOMEBREW)
            if pipeline.llm:
                llm_available = await pipeline.llm.is_available()
                self.metrics.update_llm_status(llm_available, pipeline.llm.model if llm_available else "")
                if llm_available:
                    logger.info(f"LLM connected: {pipeline.llm.model}")
                else:
                    logger.warning(f"LLM not available: {pipeline.llm.model}")
        else:
            self.metrics.update_llm_status(False, "")

        try:
            await self._main_loop()
        finally:
            # Force publish any pending changes before exit
            if not self.no_publish:
                logger.info("Publishing pending changes before shutdown...")
                await self.publisher.force_publish()

            # Clean up
            self.metrics._metrics.is_running = False
            self.metrics._metrics.current_package = ""
            self.metrics._save()
            logger.info(f"Daemon shutdown complete. Total analyzed: {self._total_analyzed}")

    async def _main_loop(self) -> None:
        """Main analysis loop."""
        while not self._shutdown_requested:
            # Check if we need to refresh the queue
            await self._refresh_queue_if_needed()

            # Get next package
            package = self.work_queue.get_next_package()

            if package is None:
                # Queue is empty - wait and refresh
                logger.info(
                    f"Work queue empty (analyzed {self._total_analyzed} total). "
                    "Waiting for refresh interval..."
                )
                await self._interruptible_sleep(60)
                continue

            self._current_package = package

            try:
                # Check rate limits before analyzing
                await self._check_rate_limits()

                if self._shutdown_requested:
                    # Re-queue the package we didn't process
                    break

                # Analyze the package
                await self._analyze_package(package)

                # Reset error counter on success
                self._consecutive_errors = 0
                self._total_analyzed += 1

                # Maybe publish to GitHub
                if not self.no_publish:
                    self.publisher.record_package()
                    await self.publisher.maybe_publish()

            except RateLimitExhausted as e:
                # Sleep until rate limit resets
                await self._handle_rate_limit_exhausted(e)

            except Exception as e:
                # Handle errors with backoff
                await self._handle_error(package, e)

            finally:
                self._current_package = None

    async def _refresh_queue_if_needed(self, force: bool = False) -> None:
        """Refresh the work queue if enough time has passed.

        Args:
            force: Force refresh regardless of interval
        """
        now = datetime.now(timezone.utc)

        if not force and self._last_queue_refresh:
            elapsed = (now - self._last_queue_refresh).total_seconds()
            if elapsed < self.QUEUE_REFRESH_INTERVAL:
                return

        logger.info("Refreshing work queue...")
        stats = await self.work_queue.refresh()
        self._last_queue_refresh = now

        # Update metrics with queue totals
        self.metrics._metrics.total_packages = stats.new_packages + stats.stale_packages
        self.metrics._metrics.completed_packages = 0
        self.metrics._save()

        logger.info(
            f"Queue refreshed: {stats.new_packages} new, "
            f"{stats.stale_packages} stale, {stats.up_to_date} up-to-date"
        )

    async def _check_rate_limits(self) -> None:
        """Check GitHub rate limits and raise if necessary.

        Raises:
            RateLimitExhausted: If rate limit is below threshold
        """
        # Get rate limit from any pipeline (they share the same token)
        for pipeline in self._pipelines.values():
            github = pipeline.github

            # If we have rate limit info and it's low, raise
            if github.rate_limit_remaining < self.rate_limit_threshold:
                if github.rate_limit_reset:
                    raise RateLimitExhausted(
                        github.rate_limit_reset,
                        github.rate_limit_remaining,
                    )
            break

    async def _handle_rate_limit_exhausted(self, e: RateLimitExhausted) -> None:
        """Handle rate limit exhaustion by sleeping.

        Args:
            e: The RateLimitExhausted exception with reset time
        """
        now = datetime.now(timezone.utc)

        if e.reset_time <= now:
            # Reset time already passed, just continue
            logger.info("Rate limit reset time has passed, continuing...")
            return

        sleep_seconds = (e.reset_time - now).total_seconds()
        # Add small buffer
        sleep_seconds = max(sleep_seconds + 10, 60)

        logger.warning(
            f"GitHub rate limit low (remaining: {e.remaining}). "
            f"Sleeping for {sleep_seconds:.0f} seconds until {e.reset_time}"
        )

        # Update metrics
        self.metrics.update_github_rate_limit(
            e.remaining,
            self.metrics._metrics.github_rate_limit_total,
            e.reset_time,
        )

        # Sleep in small intervals to allow shutdown
        await self._interruptible_sleep(sleep_seconds)

        logger.info("Resuming after rate limit sleep")

    async def _interruptible_sleep(self, seconds: float) -> None:
        """Sleep that can be interrupted by shutdown request.

        Args:
            seconds: Total seconds to sleep
        """
        start = time.time()
        while time.time() - start < seconds:
            if self._shutdown_requested:
                logger.info("Shutdown requested during sleep")
                break
            await asyncio.sleep(min(10, seconds - (time.time() - start)))

    async def _analyze_package(self, package: QueuedPackage) -> None:
        """Analyze a single package.

        Args:
            package: The package to analyze
        """
        logger.info(
            f"Analyzing {package.ecosystem.value}/{package.name} "
            f"({package.source.value})"
        )

        # Get the appropriate pipeline
        pipeline = self._get_pipeline(package.ecosystem)

        # Update metrics
        self.metrics.start_package(package.name)

        try:
            # Run analysis
            analysis = await pipeline.analyze_package(package.name, save=True)

            # Record completion
            if (
                analysis.data_availability == DataAvailability.AVAILABLE
                and analysis.scores
            ):
                self.metrics.complete_package(
                    package.name,
                    status="scored",
                    score=analysis.scores.overall,
                    grade=analysis.scores.grade,
                )
                result_str = f"score {analysis.scores.overall:.1f} ({analysis.scores.grade})"
            else:
                self.metrics.complete_package(
                    package.name,
                    status="unavailable",
                    message=analysis.unavailable_reason,
                )
                result_str = f"unavailable ({analysis.unavailable_reason})"

            # Mark completed in queue
            self.work_queue.mark_completed(package)

            logger.info(f"Completed {package.ecosystem.value}/{package.name}: {result_str}")

        except Exception as e:
            self.metrics.record_error(package.name, type(e).__name__, str(e))
            raise

    async def _handle_error(self, package: QueuedPackage, error: Exception) -> None:
        """Handle analysis errors with exponential backoff.

        Args:
            package: The package that failed
            error: The exception that occurred
        """
        self._consecutive_errors += 1

        # Calculate backoff
        backoff = min(
            self.ERROR_BACKOFF_BASE * (2 ** (self._consecutive_errors - 1)),
            self.ERROR_BACKOFF_MAX,
        )

        logger.error(
            f"Error analyzing {package.ecosystem.value}/{package.name}: {error}. "
            f"Backing off for {backoff:.0f}s (attempt {self._consecutive_errors})"
        )

        # Record error in metrics
        self.metrics.record_error(package.name, type(error).__name__, str(error))
        self.metrics.complete_package(package.name, status="error", message=str(error))

        await asyncio.sleep(backoff)

    def get_status(self) -> dict:
        """Get current daemon status for monitoring.

        Returns:
            Dictionary with daemon status information
        """
        return {
            "running": not self._shutdown_requested,
            "current_package": (
                f"{self._current_package.ecosystem.value}/{self._current_package.name}"
                if self._current_package
                else None
            ),
            "queue_state": self.work_queue.peek_queue_state(),
            "publisher_state": self.publisher.get_status(),
            "consecutive_errors": self._consecutive_errors,
            "total_analyzed": self._total_analyzed,
            "last_queue_refresh": (
                self._last_queue_refresh.isoformat()
                if self._last_queue_refresh
                else None
            ),
        }
