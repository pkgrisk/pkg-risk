"""Work queue for continuous package analysis."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path

from pkgrisk.adapters.base import BaseAdapter
from pkgrisk.adapters.homebrew import HomebrewAdapter
from pkgrisk.adapters.npm import NpmAdapter
from pkgrisk.adapters.pypi import PyPiAdapter
from pkgrisk.models.schemas import Ecosystem

logger = logging.getLogger(__name__)


class PackageSource(str, Enum):
    """Source of a package in the work queue."""

    NEW = "new"  # Never analyzed before
    STALE = "stale"  # Analysis is older than threshold


@dataclass
class QueuedPackage:
    """A package awaiting analysis."""

    ecosystem: Ecosystem
    name: str
    source: PackageSource
    last_analyzed: datetime | None = None


@dataclass
class WorkQueueStats:
    """Statistics about the work queue."""

    new_packages: int = 0
    stale_packages: int = 0
    total_analyzed: int = 0
    up_to_date: int = 0
    ecosystems: dict[str, int] = field(default_factory=dict)


class WorkQueue:
    """Priority queue for package analysis with interleaving.

    Discovers packages from all ecosystems and manages analysis priority:
    - New packages (never analyzed) get high priority
    - Stale packages (analyzed > 7 days ago) get lower priority
    - Interleaves at a configurable ratio (default: 3 new : 1 stale)

    Usage:
        queue = WorkQueue(data_dir=Path("data"))
        await queue.refresh()  # Discover all packages

        while True:
            package = queue.get_next_package()
            if package is None:
                break
            # analyze package...
            queue.mark_completed(package)
    """

    def __init__(
        self,
        data_dir: Path = Path("data"),
        stale_threshold_days: int = 7,
        interleave_ratio: tuple[int, int] = (3, 1),  # (new, stale)
    ) -> None:
        """Initialize the work queue.

        Args:
            data_dir: Root data directory containing analyzed/ subdirs
            stale_threshold_days: Consider packages stale after this many days
            interleave_ratio: Ratio of (new packages, stale packages) per cycle
        """
        self.data_dir = data_dir
        self.stale_threshold = timedelta(days=stale_threshold_days)
        self.new_ratio, self.stale_ratio = interleave_ratio

        # Adapters for each ecosystem
        self._adapters: dict[Ecosystem, BaseAdapter] = {
            Ecosystem.HOMEBREW: HomebrewAdapter(),
            Ecosystem.NPM: NpmAdapter(),
            Ecosystem.PYPI: PyPiAdapter(),
        }

        # Queues by source type
        self._new_queue: list[QueuedPackage] = []
        self._stale_queue: list[QueuedPackage] = []

        # Interleave tracking
        self._cycle_position: int = 0

        # Track what we've seen
        self._all_packages: set[tuple[str, str]] = set()  # (ecosystem, name)

    async def refresh(self) -> WorkQueueStats:
        """Refresh the work queue by discovering all packages.

        Scans all ecosystems for available packages and categorizes
        them as new or stale based on existing analysis files.

        Returns:
            WorkQueueStats with counts of discovered packages
        """
        stats = WorkQueueStats()
        self._new_queue.clear()
        self._stale_queue.clear()
        self._all_packages.clear()

        now = datetime.now(timezone.utc)
        stale_cutoff = now - self.stale_threshold

        for ecosystem, adapter in self._adapters.items():
            ecosystem_dir = self.data_dir / "analyzed" / ecosystem.value

            # Get all packages from adapter
            try:
                packages = await adapter.list_packages(limit=None)
            except Exception as e:
                logger.error(f"Failed to list {ecosystem.value} packages: {e}")
                continue

            stats.ecosystems[ecosystem.value] = len(packages)

            for name in packages:
                self._all_packages.add((ecosystem.value, name))

                # Check if we have an existing analysis
                analysis_file = ecosystem_dir / f"{name}.json"
                last_analyzed = self._get_analyzed_at(analysis_file)

                if last_analyzed is None:
                    # Never analyzed - add to new queue
                    self._new_queue.append(
                        QueuedPackage(
                            ecosystem=ecosystem,
                            name=name,
                            source=PackageSource.NEW,
                            last_analyzed=None,
                        )
                    )
                    stats.new_packages += 1
                elif last_analyzed < stale_cutoff:
                    # Analyzed but stale
                    self._stale_queue.append(
                        QueuedPackage(
                            ecosystem=ecosystem,
                            name=name,
                            source=PackageSource.STALE,
                            last_analyzed=last_analyzed,
                        )
                    )
                    stats.stale_packages += 1
                else:
                    # Recently analyzed - skip
                    stats.up_to_date += 1

        stats.total_analyzed = stats.up_to_date + stats.stale_packages

        # Sort stale queue by oldest first
        self._stale_queue.sort(key=lambda p: p.last_analyzed or datetime.min)

        logger.info(
            f"Queue refreshed: {stats.new_packages} new, "
            f"{stats.stale_packages} stale, {stats.up_to_date} up-to-date"
        )

        return stats

    def _get_analyzed_at(self, filepath: Path) -> datetime | None:
        """Extract analyzed_at timestamp from an analysis file.

        Args:
            filepath: Path to the analysis JSON file

        Returns:
            datetime if file exists and has valid timestamp, None otherwise
        """
        if not filepath.exists():
            return None

        try:
            data = json.loads(filepath.read_text())
            analyzed_str = data.get("analyzed_at")
            if analyzed_str:
                # Handle both 'Z' suffix and explicit timezone
                if analyzed_str.endswith("Z"):
                    analyzed_str = analyzed_str[:-1] + "+00:00"
                return datetime.fromisoformat(analyzed_str)
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Could not parse {filepath}: {e}")

        return None

    def get_next_package(self) -> QueuedPackage | None:
        """Get the next package to analyze using interleaved priority.

        Implements the interleaving ratio (e.g., 3 new : 1 stale).
        Falls back to any available queue when one is exhausted.

        Returns:
            Next QueuedPackage to analyze, or None if queue is empty
        """
        # If both queues empty, nothing to do
        if not self._new_queue and not self._stale_queue:
            return None

        # If only one queue has items, use it
        if not self._stale_queue:
            return self._new_queue.pop(0)
        if not self._new_queue:
            return self._stale_queue.pop(0)

        # Interleave: serve new_ratio new packages, then stale_ratio stale
        cycle_length = self.new_ratio + self.stale_ratio

        if self._cycle_position < self.new_ratio:
            # Serve from new queue
            self._cycle_position += 1
            return self._new_queue.pop(0)
        else:
            # Serve from stale queue
            self._cycle_position += 1
            if self._cycle_position >= cycle_length:
                self._cycle_position = 0
            return self._stale_queue.pop(0)

    def mark_completed(self, package: QueuedPackage) -> None:
        """Mark a package as completed (updates internal tracking).

        Args:
            package: The package that was just analyzed
        """
        logger.debug(f"Completed: {package.ecosystem.value}/{package.name}")

    def remaining(self) -> int:
        """Return total remaining packages in queue."""
        return len(self._new_queue) + len(self._stale_queue)

    def peek_queue_state(self) -> dict:
        """Return current queue state for monitoring."""
        return {
            "new_remaining": len(self._new_queue),
            "stale_remaining": len(self._stale_queue),
            "cycle_position": self._cycle_position,
            "total_known_packages": len(self._all_packages),
        }
