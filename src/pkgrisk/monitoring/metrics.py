"""Thread-safe metrics collector for pipeline monitoring."""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass
class ErrorEntry:
    """A recorded error from the pipeline."""

    timestamp: datetime
    package: str
    error_type: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "package": self.package,
            "error_type": self.error_type,
            "message": self.message,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ErrorEntry:
        return cls(
            timestamp=datetime.fromisoformat(data["timestamp"]),
            package=data["package"],
            error_type=data["error_type"],
            message=data["message"],
        )


@dataclass
class ActivityEntry:
    """A log entry for completed package analysis."""

    timestamp: datetime
    package: str
    status: str  # "scored", "unavailable", "error"
    score: float | None = None
    grade: str | None = None
    message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "package": self.package,
            "status": self.status,
            "score": self.score,
            "grade": self.grade,
            "message": self.message,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ActivityEntry:
        return cls(
            timestamp=datetime.fromisoformat(data["timestamp"]),
            package=data["package"],
            status=data["status"],
            score=data.get("score"),
            grade=data.get("grade"),
            message=data.get("message"),
        )


@dataclass
class PipelineMetrics:
    """Current state of the analysis pipeline."""

    # Progress
    ecosystem: str = ""
    total_packages: int = 0
    completed_packages: int = 0
    current_package: str = ""
    start_time: datetime | None = None

    # Results
    scored_count: int = 0
    unavailable_count: int = 0
    error_count: int = 0
    grade_distribution: dict[str, int] = field(
        default_factory=lambda: {"A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
    )
    total_score: float = 0.0  # For calculating average

    # API Status
    github_rate_limit_remaining: int = 5000
    github_rate_limit_total: int = 5000
    github_rate_limit_reset: datetime | None = None
    llm_available: bool = False
    llm_model: str = ""
    osv_status: str = "unknown"

    # Stage Timings (running averages)
    stage_timings: dict[str, float] = field(default_factory=dict)
    stage_counts: dict[str, int] = field(default_factory=dict)

    # Errors (ring buffer of last N)
    recent_errors: deque[ErrorEntry] = field(default_factory=lambda: deque(maxlen=10))

    # Activity log (ring buffer)
    activity_log: deque[ActivityEntry] = field(default_factory=lambda: deque(maxlen=50))

    # Pipeline state
    is_running: bool = False
    last_updated: datetime | None = None

    @property
    def progress_percent(self) -> float:
        """Calculate progress percentage."""
        if self.total_packages == 0:
            return 0.0
        return (self.completed_packages / self.total_packages) * 100

    @property
    def elapsed_seconds(self) -> float:
        """Calculate elapsed time in seconds."""
        if self.start_time is None:
            return 0.0
        return (datetime.now() - self.start_time).total_seconds()

    @property
    def eta_seconds(self) -> float | None:
        """Estimate remaining time in seconds."""
        if self.completed_packages == 0 or self.total_packages == 0:
            return None
        elapsed = self.elapsed_seconds
        rate = self.completed_packages / elapsed if elapsed > 0 else 0
        remaining = self.total_packages - self.completed_packages
        return remaining / rate if rate > 0 else None

    @property
    def average_score(self) -> float | None:
        """Calculate average score of scored packages."""
        if self.scored_count == 0:
            return None
        return self.total_score / self.scored_count

    def to_dict(self) -> dict[str, Any]:
        """Serialize metrics to a dictionary for JSON storage."""
        return {
            "ecosystem": self.ecosystem,
            "total_packages": self.total_packages,
            "completed_packages": self.completed_packages,
            "current_package": self.current_package,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "scored_count": self.scored_count,
            "unavailable_count": self.unavailable_count,
            "error_count": self.error_count,
            "grade_distribution": self.grade_distribution,
            "total_score": self.total_score,
            "github_rate_limit_remaining": self.github_rate_limit_remaining,
            "github_rate_limit_total": self.github_rate_limit_total,
            "github_rate_limit_reset": (
                self.github_rate_limit_reset.isoformat()
                if self.github_rate_limit_reset
                else None
            ),
            "llm_available": self.llm_available,
            "llm_model": self.llm_model,
            "osv_status": self.osv_status,
            "stage_timings": self.stage_timings,
            "stage_counts": self.stage_counts,
            "recent_errors": [e.to_dict() for e in self.recent_errors],
            "activity_log": [a.to_dict() for a in self.activity_log],
            "is_running": self.is_running,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PipelineMetrics:
        """Deserialize metrics from a dictionary."""
        metrics = cls(
            ecosystem=data.get("ecosystem", ""),
            total_packages=data.get("total_packages", 0),
            completed_packages=data.get("completed_packages", 0),
            current_package=data.get("current_package", ""),
            start_time=(
                datetime.fromisoformat(data["start_time"])
                if data.get("start_time")
                else None
            ),
            scored_count=data.get("scored_count", 0),
            unavailable_count=data.get("unavailable_count", 0),
            error_count=data.get("error_count", 0),
            grade_distribution=data.get(
                "grade_distribution", {"A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
            ),
            total_score=data.get("total_score", 0.0),
            github_rate_limit_remaining=data.get("github_rate_limit_remaining", 5000),
            github_rate_limit_total=data.get("github_rate_limit_total", 5000),
            github_rate_limit_reset=(
                datetime.fromisoformat(data["github_rate_limit_reset"])
                if data.get("github_rate_limit_reset")
                else None
            ),
            llm_available=data.get("llm_available", False),
            llm_model=data.get("llm_model", ""),
            osv_status=data.get("osv_status", "unknown"),
            stage_timings=data.get("stage_timings", {}),
            stage_counts=data.get("stage_counts", {}),
            is_running=data.get("is_running", False),
            last_updated=(
                datetime.fromisoformat(data["last_updated"])
                if data.get("last_updated")
                else None
            ),
        )

        # Restore deques
        metrics.recent_errors = deque(
            [ErrorEntry.from_dict(e) for e in data.get("recent_errors", [])],
            maxlen=10,
        )
        metrics.activity_log = deque(
            [ActivityEntry.from_dict(a) for a in data.get("activity_log", [])],
            maxlen=50,
        )

        return metrics


class MetricsCollector:
    """Thread-safe metrics collector for pipeline monitoring.

    Collects metrics during pipeline execution and persists them to a JSON file
    for cross-process monitoring by the TUI dashboard.
    """

    def __init__(self, metrics_file: Path | None = None):
        self._lock = threading.Lock()
        self._metrics_file = metrics_file or Path("data/.metrics.json")
        self._save_counter = 0
        self._save_interval = 1  # Save after every N package completions

        # Load existing metrics to preserve historical data across restarts
        self._metrics = self._load_existing_metrics()

    def _load_existing_metrics(self) -> PipelineMetrics:
        """Load existing metrics from file to preserve historical data.

        Returns:
            PipelineMetrics loaded from file, or empty metrics if file doesn't exist
        """
        try:
            if self._metrics_file.exists():
                with open(self._metrics_file) as f:
                    data = json.load(f)
                return PipelineMetrics.from_dict(data)
        except Exception:
            pass
        return PipelineMetrics()

    def start_batch(self, total: int, ecosystem: str) -> None:
        """Mark the start of a batch analysis.

        Preserves historical data (cumulative counts, stage timings, activity log)
        while resetting session-specific fields for this batch.
        """
        with self._lock:
            # Load existing metrics to preserve historical data
            existing = self.load()

            # Create new metrics with historical data preserved
            self._metrics = PipelineMetrics(
                # Session-specific fields (reset for this batch)
                ecosystem=ecosystem,
                total_packages=total,
                completed_packages=0,
                current_package="",
                start_time=datetime.now(),
                is_running=True,
                last_updated=datetime.now(),
                # Cumulative statistics (preserved from history)
                scored_count=existing.scored_count,
                unavailable_count=existing.unavailable_count,
                error_count=existing.error_count,
                grade_distribution=existing.grade_distribution.copy(),
                total_score=existing.total_score,
                # Stage timings (preserved - running averages)
                stage_timings=existing.stage_timings.copy(),
                stage_counts=existing.stage_counts.copy(),
                # API status (will be updated during run)
                github_rate_limit_remaining=existing.github_rate_limit_remaining,
                github_rate_limit_total=existing.github_rate_limit_total,
                github_rate_limit_reset=existing.github_rate_limit_reset,
                llm_available=existing.llm_available,
                llm_model=existing.llm_model,
                osv_status=existing.osv_status,
            )

            # Restore deques (activity log and errors are preserved)
            self._metrics.recent_errors = existing.recent_errors
            self._metrics.activity_log = existing.activity_log

            self._save()

    def start_package(self, name: str) -> None:
        """Mark a package as currently being analyzed."""
        with self._lock:
            self._metrics.current_package = name
            self._metrics.last_updated = datetime.now()
            self._save()

    def complete_package(
        self,
        name: str,
        status: str,
        score: float | None = None,
        grade: str | None = None,
        message: str | None = None,
    ) -> None:
        """Record the completion of a package analysis."""
        with self._lock:
            self._metrics.completed_packages += 1
            self._metrics.current_package = ""
            self._metrics.last_updated = datetime.now()

            # Update result counts
            if status == "scored":
                self._metrics.scored_count += 1
                if score is not None:
                    self._metrics.total_score += score
                if grade:
                    self._metrics.grade_distribution[grade] = (
                        self._metrics.grade_distribution.get(grade, 0) + 1
                    )
            elif status == "unavailable":
                self._metrics.unavailable_count += 1
            else:  # error
                self._metrics.error_count += 1

            # Add to activity log
            self._metrics.activity_log.append(
                ActivityEntry(
                    timestamp=datetime.now(),
                    package=name,
                    status=status,
                    score=score,
                    grade=grade,
                    message=message,
                )
            )

            self._save_counter += 1
            if self._save_counter >= self._save_interval:
                self._save()
                self._save_counter = 0

    def record_error(self, package: str, error_type: str, message: str) -> None:
        """Record an error that occurred during analysis."""
        with self._lock:
            self._metrics.recent_errors.append(
                ErrorEntry(
                    timestamp=datetime.now(),
                    package=package,
                    error_type=error_type,
                    message=message,
                )
            )
            self._metrics.last_updated = datetime.now()
            self._save()

    def record_stage_timing(self, stage: str, duration: float) -> None:
        """Record the duration of a pipeline stage (updates running average)."""
        with self._lock:
            current_count = self._metrics.stage_counts.get(stage, 0)
            current_avg = self._metrics.stage_timings.get(stage, 0.0)

            # Update running average
            new_count = current_count + 1
            new_avg = (current_avg * current_count + duration) / new_count

            self._metrics.stage_counts[stage] = new_count
            self._metrics.stage_timings[stage] = new_avg
            # Don't save on every timing - too frequent

    def update_github_rate_limit(
        self, remaining: int, total: int, reset_time: datetime | None = None
    ) -> None:
        """Update GitHub API rate limit status."""
        with self._lock:
            self._metrics.github_rate_limit_remaining = remaining
            self._metrics.github_rate_limit_total = total
            self._metrics.github_rate_limit_reset = reset_time
            self._metrics.last_updated = datetime.now()

    def update_llm_status(self, available: bool, model: str = "") -> None:
        """Update LLM availability status."""
        with self._lock:
            self._metrics.llm_available = available
            self._metrics.llm_model = model
            self._metrics.last_updated = datetime.now()

    def update_osv_status(self, status: str) -> None:
        """Update OSV API status."""
        with self._lock:
            self._metrics.osv_status = status
            self._metrics.last_updated = datetime.now()

    def finish_batch(self) -> None:
        """Mark the batch analysis as complete."""
        with self._lock:
            self._metrics.is_running = False
            self._metrics.current_package = ""
            self._metrics.last_updated = datetime.now()
            self._save()

    def get_metrics(self) -> PipelineMetrics:
        """Get a copy of current metrics."""
        with self._lock:
            # Return a shallow copy to avoid external modification
            return PipelineMetrics.from_dict(self._metrics.to_dict())

    def _save(self) -> None:
        """Save metrics to file (must be called with lock held)."""
        try:
            self._metrics_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self._metrics_file, "w") as f:
                json.dump(self._metrics.to_dict(), f, indent=2)
        except Exception:
            # Silently ignore save errors to not disrupt the pipeline
            pass

    def load(self) -> PipelineMetrics:
        """Load metrics from file (for dashboard use)."""
        try:
            if self._metrics_file.exists():
                with open(self._metrics_file) as f:
                    data = json.load(f)
                return PipelineMetrics.from_dict(data)
        except Exception:
            pass
        return PipelineMetrics()


# Global singleton for easy access
_collector: MetricsCollector | None = None


def get_collector(metrics_file: Path | None = None) -> MetricsCollector:
    """Get the global metrics collector instance."""
    global _collector
    if _collector is None:
        _collector = MetricsCollector(metrics_file)
    return _collector


class StageTimer:
    """Context manager for timing pipeline stages."""

    def __init__(self, collector: MetricsCollector, stage: str):
        self.collector = collector
        self.stage = stage
        self.start_time: float | None = None

    def __enter__(self) -> StageTimer:
        self.start_time = time.perf_counter()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self.start_time is not None:
            duration = time.perf_counter() - self.start_time
            self.collector.record_stage_timing(self.stage, duration)
