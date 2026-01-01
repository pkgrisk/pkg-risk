"""TUI dashboard for monitoring pkg-risk analysis pipeline."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.reactive import reactive
from textual.widgets import Footer, Header, Static

from .metrics import MetricsCollector, PipelineMetrics


def format_duration(seconds: float) -> str:
    """Format duration in human-readable format."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}m {secs}s"
    else:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        return f"{hours}h {minutes}m"


def format_time(dt: datetime | None) -> str:
    """Format datetime as HH:MM:SS."""
    if dt is None:
        return "--:--:--"
    return dt.strftime("%H:%M:%S")


class ProgressPanel(Static):
    """Shows overall progress with ETA."""

    def update_metrics(self, metrics: PipelineMetrics) -> None:
        """Update the panel with new metrics."""
        completed = metrics.completed_packages
        total = metrics.total_packages
        pct = metrics.progress_percent

        # Total analyzed across all runs
        total_analyzed = metrics.scored_count + metrics.unavailable_count + metrics.error_count

        # Build progress bar
        bar_width = 30
        filled = int(pct / 100 * bar_width)
        bar = "━" * filled + "╺" + "─" * (bar_width - filled - 1)

        # Calculate ETA
        eta_str = "--:--"
        if metrics.eta_seconds is not None:
            eta_str = format_duration(metrics.eta_seconds)

        elapsed_str = format_duration(metrics.elapsed_seconds)
        current = metrics.current_package or "idle"

        status = "[green]RUNNING[/green]" if metrics.is_running else "[yellow]STOPPED[/yellow]"

        content = f"""[bold]PROGRESS[/bold]  {status}
[cyan]{bar}[/cyan] {pct:.0f}%
{completed}/{total} this batch | {total_analyzed} total

[bold]Current:[/bold] {current}
[bold]Elapsed:[/bold] {elapsed_str}
[bold]ETA:[/bold]     {eta_str}"""

        self.update(content)


class APIStatusPanel(Static):
    """Shows API status and rate limits."""

    def update_metrics(self, metrics: PipelineMetrics) -> None:
        """Update the panel with new metrics."""
        # GitHub rate limit
        gh_remaining = metrics.github_rate_limit_remaining
        gh_total = metrics.github_rate_limit_total
        gh_pct = (gh_remaining / gh_total * 100) if gh_total > 0 else 100

        if gh_pct > 50:
            gh_status = f"[green]✓[/green] {gh_remaining:,}/{gh_total:,}"
        elif gh_pct > 20:
            gh_status = f"[yellow]⚠[/yellow] {gh_remaining:,}/{gh_total:,}"
        else:
            gh_status = f"[red]✗[/red] {gh_remaining:,}/{gh_total:,}"

        # Reset time
        reset_str = ""
        if metrics.github_rate_limit_reset:
            reset_in = (metrics.github_rate_limit_reset - datetime.now(metrics.github_rate_limit_reset.tzinfo)).total_seconds()
            if reset_in > 0:
                reset_str = f" (reset in {format_duration(reset_in)})"

        # LLM status
        if metrics.llm_available:
            llm_status = f"[green]✓[/green] {metrics.llm_model or 'available'}"
        else:
            llm_status = "[dim]- not configured[/dim]"

        # OSV status
        osv_map = {"OK": "[green]✓[/green] OK", "error": "[red]✗[/red] error", "unknown": "[dim]- unknown[/dim]"}
        osv_status = osv_map.get(metrics.osv_status, "[dim]- unknown[/dim]")

        content = f"""[bold]API STATUS[/bold]

[bold]GitHub:[/bold] {gh_status}{reset_str}
[bold]LLM:[/bold]    {llm_status}
[bold]OSV:[/bold]    {osv_status}"""

        self.update(content)


class ResultsPanel(Static):
    """Shows analysis results summary."""

    def update_metrics(self, metrics: PipelineMetrics) -> None:
        """Update the panel with new metrics."""
        scored = metrics.scored_count
        unavailable = metrics.unavailable_count
        errors = metrics.error_count
        total = scored + unavailable + errors

        # Average score
        avg_str = f"{metrics.average_score:.1f}" if metrics.average_score is not None else "-"

        # Grade distribution
        grades = metrics.grade_distribution
        grade_line = "  ".join(f"{g}:{grades.get(g, 0)}" for g in ["A", "B", "C", "D", "F"])

        content = f"""[bold]RESULTS[/bold] ({total} total)

[green]✓ Scored:[/green]     {scored}
[yellow]⚠ Unavailable:[/yellow] {unavailable}
[red]✗ Errors:[/red]      {errors}

[bold]Avg Score:[/bold] {avg_str}
[bold]Grades:[/bold]    {grade_line}"""

        self.update(content)


class TimingPanel(Static):
    """Shows stage timing averages."""

    def update_metrics(self, metrics: PipelineMetrics) -> None:
        """Update the panel with new metrics."""
        timings = metrics.stage_timings

        # Stage order and display names
        stages = [
            ("metadata", "Metadata"),
            ("github", "GitHub"),
            ("cve", "CVE"),
            ("llm", "LLM"),
            ("scoring", "Scoring"),
            ("save", "Save"),
        ]

        # Find max timing for bar scaling
        max_time = max(timings.values()) if timings else 1.0

        lines = ["[bold]STAGE TIMING[/bold] (avg)", ""]
        for key, name in stages:
            if key in timings:
                t = timings[key]
                bar_width = 12
                filled = int(t / max_time * bar_width) if max_time > 0 else 0
                bar = "█" * filled + "░" * (bar_width - filled)

                # Color based on time
                if t < 1.0:
                    color = "green"
                elif t < 5.0:
                    color = "yellow"
                else:
                    color = "red"

                lines.append(f"{name:10} {t:5.1f}s [{color}]{bar}[/{color}]")
            else:
                lines.append(f"{name:10}    -s [dim]{'░' * 12}[/dim]")

        self.update("\n".join(lines))


class ErrorsPanel(Static):
    """Shows recent errors."""

    def update_metrics(self, metrics: PipelineMetrics) -> None:
        """Update the panel with new metrics."""
        lines = ["[bold]RECENT ERRORS[/bold]", ""]

        if not metrics.recent_errors:
            lines.append("[dim]No errors[/dim]")
        else:
            for error in list(metrics.recent_errors)[-5:]:
                time_str = format_time(error.timestamp)
                msg = error.message[:50] + "..." if len(error.message) > 50 else error.message
                lines.append(f"[dim]{time_str}[/dim] [cyan]{error.package:15}[/cyan] [red]{error.error_type}[/red]: {msg}")

        self.update("\n".join(lines))


class ActivityPanel(Static):
    """Shows recent activity log."""

    def update_metrics(self, metrics: PipelineMetrics) -> None:
        """Update the panel with new metrics."""
        lines = ["[bold]ACTIVITY LOG[/bold]", ""]

        if not metrics.activity_log:
            lines.append("[dim]No activity yet[/dim]")
        else:
            for entry in list(metrics.activity_log)[-10:]:
                time_str = format_time(entry.timestamp)

                if entry.status == "scored":
                    score_str = f"{entry.score:.1f}" if entry.score else "-"
                    grade = entry.grade or "-"
                    status_icon = "[green]✓[/green]"
                    details = f"(score: {score_str}, grade: {grade})"
                elif entry.status == "unavailable":
                    status_icon = "[yellow]⚠[/yellow]"
                    reason = entry.message[:30] if entry.message else "no repo"
                    details = f"({reason})"
                else:
                    status_icon = "[red]✗[/red]"
                    details = f"({entry.message[:30]})" if entry.message else "(error)"

                lines.append(f"[dim]{time_str}[/dim]  {status_icon} [cyan]{entry.package:20}[/cyan] {details}")

        self.update("\n".join(lines))


class PipelineDashboard(App):
    """TUI dashboard for monitoring pkg-risk analysis pipeline."""

    CSS = """
    Screen {
        layout: vertical;
    }

    #top-row {
        height: 9;
        layout: horizontal;
    }

    #progress-panel {
        width: 1fr;
        border: solid green;
        padding: 0 1;
    }

    #api-panel {
        width: 1fr;
        border: solid blue;
        padding: 0 1;
    }

    #middle-row {
        height: 10;
        layout: horizontal;
    }

    #results-panel {
        width: 1fr;
        border: solid cyan;
        padding: 0 1;
    }

    #timing-panel {
        width: 1fr;
        border: solid magenta;
        padding: 0 1;
    }

    #errors-panel {
        height: 8;
        border: solid red;
        padding: 0 1;
    }

    #activity-panel {
        height: 1fr;
        border: solid white;
        padding: 0 1;
    }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "refresh", "Refresh"),
    ]

    def __init__(
        self,
        metrics_file: Path | None = None,
        refresh_interval: float = 10.0,
    ):
        super().__init__()
        self.collector = MetricsCollector(metrics_file or Path("data/.metrics.json"))
        self.refresh_interval = refresh_interval

    def compose(self) -> ComposeResult:
        """Create dashboard layout."""
        yield Header()

        with Container(id="top-row"):
            yield ProgressPanel(id="progress-panel")
            yield APIStatusPanel(id="api-panel")

        with Container(id="middle-row"):
            yield ResultsPanel(id="results-panel")
            yield TimingPanel(id="timing-panel")

        yield ErrorsPanel(id="errors-panel")
        yield ActivityPanel(id="activity-panel")

        yield Footer()

    def on_mount(self) -> None:
        """Start auto-refresh timer."""
        self.refresh_metrics()
        self.set_interval(self.refresh_interval, self.refresh_metrics)

    def refresh_metrics(self) -> None:
        """Load metrics from file and update all panels."""
        metrics = self.collector.load()

        self.query_one("#progress-panel", ProgressPanel).update_metrics(metrics)
        self.query_one("#api-panel", APIStatusPanel).update_metrics(metrics)
        self.query_one("#results-panel", ResultsPanel).update_metrics(metrics)
        self.query_one("#timing-panel", TimingPanel).update_metrics(metrics)
        self.query_one("#errors-panel", ErrorsPanel).update_metrics(metrics)
        self.query_one("#activity-panel", ActivityPanel).update_metrics(metrics)

    def action_refresh(self) -> None:
        """Manual refresh."""
        self.refresh_metrics()


def run_dashboard(metrics_file: Path | None = None, refresh_interval: float = 10.0) -> None:
    """Run the dashboard app."""
    app = PipelineDashboard(metrics_file=metrics_file, refresh_interval=refresh_interval)
    app.run()
