"""CLI entry point for pkgrisk."""

import asyncio
import json
import os
from pathlib import Path

# Load .env file if it exists
from dotenv import load_dotenv
load_dotenv()

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from pkgrisk.adapters.base import BaseAdapter
from pkgrisk.adapters.homebrew import HomebrewAdapter
from pkgrisk.adapters.npm import NpmAdapter
from pkgrisk.analyzers.github import GitHubFetcher
from pkgrisk.monitoring import MetricsCollector

app = typer.Typer(help="Package health and risk scoring tool.")

# Supported ecosystems and their adapters
ECOSYSTEM_ADAPTERS: dict[str, type[BaseAdapter]] = {
    "homebrew": HomebrewAdapter,
    "npm": NpmAdapter,
}


def get_adapter(ecosystem: str) -> BaseAdapter:
    """Get adapter for the specified ecosystem.

    Args:
        ecosystem: Package ecosystem name (homebrew, npm, etc.)

    Returns:
        Adapter instance for the ecosystem.

    Raises:
        ValueError: If ecosystem is not supported.
    """
    adapter_class = ECOSYSTEM_ADAPTERS.get(ecosystem.lower())
    if not adapter_class:
        supported = ", ".join(ECOSYSTEM_ADAPTERS.keys())
        raise ValueError(f"Unsupported ecosystem: {ecosystem}. Supported: {supported}")
    return adapter_class()


console = Console()


@app.command()
def list_packages(
    ecosystem: str = typer.Argument("homebrew", help="Package ecosystem to query"),
    limit: int = typer.Option(10, "--limit", "-n", help="Number of packages to list"),
) -> None:
    """List top packages from an ecosystem."""
    asyncio.run(_list_packages(ecosystem, limit))


async def _list_packages(ecosystem: str, limit: int) -> None:
    """Async implementation of list_packages."""
    try:
        adapter = get_adapter(ecosystem)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        progress.add_task("Fetching package list...", total=None)
        packages = await adapter.list_packages(limit=limit)

    table = Table(title=f"Top {len(packages)} {ecosystem.title()} Packages")
    table.add_column("Rank", style="dim", width=6)
    table.add_column("Package", style="cyan")
    table.add_column("Description", style="white", max_width=60)
    table.add_column("30d Installs", justify="right", style="green")

    for i, name in enumerate(packages, 1):
        metadata = await adapter.get_package_metadata(name)
        stats = await adapter.get_install_stats(name)
        installs = f"{stats.downloads_last_30d:,}" if stats and stats.downloads_last_30d else "-"
        table.add_row(str(i), name, metadata.description[:60], installs)

    console.print(table)


@app.command()
def fetch(
    package: str = typer.Argument(..., help="Package name to fetch"),
    ecosystem: str = typer.Option("homebrew", "--ecosystem", "-e", help="Package ecosystem"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output JSON file"),
    github: bool = typer.Option(False, "--github", "-g", help="Also fetch GitHub data"),
) -> None:
    """Fetch data for a specific package."""
    asyncio.run(_fetch_package(package, ecosystem, output, github))


async def _fetch_package(
    package: str,
    ecosystem: str,
    output: Path | None,
    fetch_github: bool,
) -> None:
    """Async implementation of fetch."""
    try:
        adapter = get_adapter(ecosystem)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    github = GitHubFetcher() if fetch_github else None

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Fetching package metadata...", total=None)

        try:
            metadata = await adapter.get_package_metadata(package)
            stats = await adapter.get_install_stats(package)
            repo_ref = adapter.get_source_repo(metadata)
        except Exception as e:
            console.print(f"[red]Error fetching package: {e}[/red]")
            raise typer.Exit(1)

        github_data = None
        if fetch_github and repo_ref:
            progress.update(task, description="Fetching GitHub data...")
            github_data = await github.fetch_repo_data(repo_ref)

    # Display results
    console.print()
    console.print(f"[bold cyan]{metadata.name}[/bold cyan] v{metadata.version}")
    console.print(f"[dim]{metadata.description}[/dim]")
    console.print()

    info_table = Table(show_header=False, box=None)
    info_table.add_column("Key", style="bold")
    info_table.add_column("Value")

    info_table.add_row("Ecosystem", metadata.ecosystem.value)
    info_table.add_row("Homepage", metadata.homepage or "-")
    info_table.add_row("Repository", metadata.repository_url or "-")
    info_table.add_row("License", metadata.license or "-")

    if stats and stats.downloads_last_30d:
        info_table.add_row("30d Installs", f"{stats.downloads_last_30d:,}")

    if metadata.dependencies:
        info_table.add_row("Dependencies", ", ".join(metadata.dependencies[:5]))
        if len(metadata.dependencies) > 5:
            info_table.add_row("", f"... and {len(metadata.dependencies) - 5} more")

    console.print(info_table)

    if github_data:
        console.print()
        console.print("[bold]GitHub Data:[/bold]")

        gh_table = Table(show_header=False, box=None)
        gh_table.add_column("Key", style="bold")
        gh_table.add_column("Value")

        gh_table.add_row("Stars", f"{github_data.repo.stars:,}")
        gh_table.add_row("Forks", f"{github_data.repo.forks:,}")
        gh_table.add_row("Open Issues", str(github_data.repo.open_issues))
        gh_table.add_row("Contributors", str(github_data.contributors.total_contributors))
        gh_table.add_row("Commits (6mo)", str(github_data.commits.commits_last_6mo))

        if github_data.releases.latest_version:
            gh_table.add_row("Latest Release", github_data.releases.latest_version)

        gh_table.add_row("Has CI", "Yes" if github_data.ci.has_github_actions else "No")
        gh_table.add_row("Has Security Policy", "Yes" if github_data.security.has_security_md else "No")

        console.print(gh_table)

    # Save to file if requested
    if output:
        data = {
            "metadata": metadata.model_dump(),
            "stats": stats.model_dump() if stats else None,
            "repository": repo_ref.model_dump() if repo_ref else None,
            "github": github_data.model_dump() if github_data else None,
        }
        output.write_text(json.dumps(data, indent=2, default=str))
        console.print(f"\n[green]Saved to {output}[/green]")


@app.command()
def github_info(
    owner: str = typer.Argument(..., help="Repository owner"),
    repo: str = typer.Argument(..., help="Repository name"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output JSON file"),
) -> None:
    """Fetch GitHub repository data directly."""
    asyncio.run(_github_info(owner, repo, output))


async def _github_info(owner: str, repo: str, output: Path | None) -> None:
    """Async implementation of github_info."""
    from pkgrisk.models.schemas import Platform, RepoRef

    fetcher = GitHubFetcher()
    repo_ref = RepoRef(platform=Platform.GITHUB, owner=owner, repo=repo)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        progress.add_task("Fetching GitHub data...", total=None)
        data = await fetcher.fetch_repo_data(repo_ref)

    if not data:
        console.print(f"[red]Repository {owner}/{repo} not found[/red]")
        raise typer.Exit(1)

    # Display summary
    console.print()
    console.print(f"[bold cyan]{owner}/{repo}[/bold cyan]")
    if data.repo.description:
        console.print(f"[dim]{data.repo.description}[/dim]")
    console.print()

    # Main stats
    stats_table = Table(title="Repository Stats", show_header=False, box=None)
    stats_table.add_column("Metric", style="bold")
    stats_table.add_column("Value", justify="right")

    stats_table.add_row("Stars", f"{data.repo.stars:,}")
    stats_table.add_row("Forks", f"{data.repo.forks:,}")
    stats_table.add_row("Open Issues", str(data.repo.open_issues))
    stats_table.add_row("Watchers", f"{data.repo.watchers:,}")
    stats_table.add_row("Language", data.repo.language or "-")
    stats_table.add_row("License", data.repo.license or "-")

    console.print(stats_table)
    console.print()

    # Activity
    activity_table = Table(title="Activity", show_header=False, box=None)
    activity_table.add_column("Metric", style="bold")
    activity_table.add_column("Value", justify="right")

    activity_table.add_row("Total Contributors", str(data.contributors.total_contributors))
    activity_table.add_row("Top Contributor %", f"{data.contributors.top_contributor_pct:.1f}%")
    activity_table.add_row("Commits (6mo)", str(data.commits.commits_last_6mo))
    activity_table.add_row("Commits (1yr)", str(data.commits.commits_last_year))
    activity_table.add_row("Merged PRs (6mo)", str(data.prs.merged_prs_6mo))
    activity_table.add_row("Open PRs", str(data.prs.open_prs))
    activity_table.add_row("Stale PRs", str(data.prs.stale_prs))

    console.print(activity_table)
    console.print()

    # Security & Quality
    quality_table = Table(title="Security & Quality", show_header=False, box=None)
    quality_table.add_column("Check", style="bold")
    quality_table.add_column("Status", justify="right")

    def status(val: bool) -> str:
        return "[green]Yes[/green]" if val else "[dim]No[/dim]"

    quality_table.add_row("README", status(data.files.has_readme))
    quality_table.add_row("LICENSE", status(data.files.has_license))
    quality_table.add_row("CHANGELOG", status(data.files.has_changelog))
    quality_table.add_row("CONTRIBUTING", status(data.files.has_contributing))
    quality_table.add_row("SECURITY.md", status(data.security.has_security_md))
    quality_table.add_row("Tests", status(data.files.has_tests_dir))
    quality_table.add_row("CI/CD", status(data.ci.has_github_actions))
    quality_table.add_row("Dependabot", status(data.security.has_dependabot))
    quality_table.add_row("CodeQL", status(data.security.has_codeql))

    if data.ci.recent_runs_pass_rate is not None:
        quality_table.add_row("CI Pass Rate", f"{data.ci.recent_runs_pass_rate:.1f}%")

    console.print(quality_table)

    # Save to file if requested
    if output:
        output.write_text(json.dumps(data.model_dump(), indent=2, default=str))
        console.print(f"\n[green]Saved to {output}[/green]")


@app.command()
def analyze(
    package: str = typer.Argument(..., help="Package name to analyze"),
    ecosystem: str = typer.Option("homebrew", "--ecosystem", "-e", help="Package ecosystem"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output JSON file"),
    skip_llm: bool = typer.Option(False, "--skip-llm", help="Skip LLM analysis"),
    model: str = typer.Option("llama3.1:70b", "--model", "-m", help="Ollama model for LLM analysis"),
) -> None:
    """Analyze a package and calculate health scores."""
    asyncio.run(_analyze_package(package, ecosystem, output, skip_llm, model))


async def _analyze_package(
    package: str,
    ecosystem: str,
    output: Path | None,
    skip_llm: bool,
    model: str,
) -> None:
    """Async implementation of analyze."""
    import os

    from rich.panel import Panel
    from rich.progress import BarColumn, TaskProgressColumn

    from pkgrisk.analyzers.pipeline import AnalysisPipeline

    try:
        adapter = get_adapter(ecosystem)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Analyzing package...", total=None)

        pipeline = AnalysisPipeline(
            adapter=adapter,
            github_token=os.environ.get("GITHUB_TOKEN"),
            skip_llm=skip_llm,
            llm_model=model,
        )

        try:
            progress.update(task, description="Fetching package data...")
            analysis = await pipeline.analyze_package(package, save=False)
        except Exception as e:
            console.print(f"[red]Error analyzing package: {e}[/red]")
            raise typer.Exit(1)

    from pkgrisk.models.schemas import DataAvailability

    # Display results
    console.print()
    console.print(f"[bold cyan]{analysis.name}[/bold cyan] v{analysis.version}")
    console.print(f"[dim]{analysis.description}[/dim]")
    console.print()

    # Check data availability
    if analysis.data_availability != DataAvailability.AVAILABLE:
        # Package data not available
        console.print(
            Panel(
                f"[bold yellow]Score Unavailable[/bold yellow]\n\n{analysis.unavailable_reason}",
                title="Data Not Available",
                expand=False,
                border_style="yellow",
            )
        )

        if analysis.install_count_30d:
            console.print(f"\n[bold]30-day installs:[/bold] {analysis.install_count_30d:,}")

        if analysis.homepage:
            console.print(f"[bold]Homepage:[/bold] {analysis.homepage}")

    elif analysis.scores:
        # Score display for available packages
        scores = analysis.scores

        # Overall score with color coding
        score_color = "green" if scores.overall >= 80 else "yellow" if scores.overall >= 60 else "red"
        console.print(
            Panel(
                f"[bold][{score_color}]{scores.overall:.0f}[/{score_color}][/bold] / 100  Grade: [bold]{scores.grade}[/bold]",
                title="Overall Health Score",
                expand=False,
            )
        )
        console.print()

        # Component scores
        scores_table = Table(title="Score Breakdown", show_header=True)
        scores_table.add_column("Component", style="bold")
        scores_table.add_column("Score", justify="right")
        scores_table.add_column("Weight", justify="right", style="dim")
        scores_table.add_column("Bar", width=20)

        components = [
            ("Security", scores.security),
            ("Maintenance", scores.maintenance),
            ("Community", scores.community),
            ("Bus Factor", scores.bus_factor),
            ("Documentation", scores.documentation),
            ("Stability", scores.stability),
        ]

        for name, component in components:
            bar = _score_bar(component.score)
            color = "green" if component.score >= 80 else "yellow" if component.score >= 60 else "red"
            scores_table.add_row(
                name,
                f"[{color}]{component.score:.0f}[/{color}]",
                f"{component.weight}%",
                bar,
            )

        console.print(scores_table)

        # Analysis summary
        if analysis.analysis_summary:
            console.print()
            summary = analysis.analysis_summary

            if summary.get("maintenance_status"):
                status = summary["maintenance_status"]
                status_color = {
                    "actively-maintained": "green",
                    "maintained": "green",
                    "minimal-maintenance": "yellow",
                    "stale": "red",
                    "abandoned": "red",
                }.get(status, "white")
                console.print(f"[bold]Maintenance:[/bold] [{status_color}]{status}[/{status_color}]")

            if summary.get("security_summary"):
                console.print(f"[bold]Security:[/bold] {summary['security_summary']}")

            if summary.get("highlights"):
                console.print()
                console.print("[bold green]Highlights:[/bold green]")
                for highlight in summary["highlights"]:
                    console.print(f"  [green]+[/green] {highlight}")

            if summary.get("concerns"):
                console.print()
                console.print("[bold yellow]Concerns:[/bold yellow]")
                for concern in summary["concerns"]:
                    console.print(f"  [yellow]![/yellow] {concern}")

    # Save if requested
    if output:
        output.write_text(json.dumps(analysis.model_dump(mode="json"), indent=2, default=str))
        console.print(f"\n[green]Saved to {output}[/green]")


def _score_bar(score: float, width: int = 20) -> str:
    """Create a visual score bar."""
    filled = int(score / 100 * width)
    empty = width - filled
    color = "green" if score >= 80 else "yellow" if score >= 60 else "red"
    return f"[{color}]{'█' * filled}[/{color}][dim]{'░' * empty}[/dim]"


@app.command()
def analyze_batch(
    ecosystem: str = typer.Option("homebrew", "--ecosystem", "-e", help="Package ecosystem"),
    limit: int = typer.Option(10, "--limit", "-n", help="Number of packages to analyze"),
    skip_llm: bool = typer.Option(True, "--skip-llm/--with-llm", help="Skip LLM analysis"),
    data_dir: Path = typer.Option(Path("data"), "--data-dir", "-d", help="Data directory"),
) -> None:
    """Analyze multiple packages in batch."""
    asyncio.run(_analyze_batch(ecosystem, limit, skip_llm, data_dir))


async def _analyze_batch(
    ecosystem: str,
    limit: int,
    skip_llm: bool,
    data_dir: Path,
) -> None:
    """Async implementation of analyze_batch."""
    import os

    from rich.progress import BarColumn, MofNCompleteColumn, TaskProgressColumn, TimeElapsedColumn

    from pkgrisk.analyzers.pipeline import AnalysisPipeline
    from pkgrisk.models.schemas import DataAvailability

    try:
        adapter = get_adapter(ecosystem)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)

    # Initialize metrics collector for monitoring
    metrics = MetricsCollector(data_dir / ".metrics.json")

    pipeline = AnalysisPipeline(
        adapter=adapter,
        data_dir=data_dir,
        github_token=os.environ.get("GITHUB_TOKEN"),
        skip_llm=skip_llm,
        metrics=metrics,
    )

    console.print(f"[bold]Analyzing top {limit} {ecosystem} packages...[/bold]")
    console.print()

    # Get packages first
    packages = await adapter.list_packages(limit=limit)

    # Start batch tracking
    metrics.start_batch(len(packages), ecosystem)

    # Check LLM availability
    if pipeline.llm:
        llm_available = await pipeline.llm.is_available()
        metrics.update_llm_status(llm_available, pipeline.llm.model if llm_available else "")
    else:
        metrics.update_llm_status(False, "")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Analyzing...", total=len(packages))
        results = []
        errors = []

        for i, package_name in enumerate(packages):
            progress.update(task, description=f"Analyzing {package_name}...", completed=i)
            metrics.start_package(package_name)

            try:
                analysis = await pipeline.analyze_package(package_name, save=True)
                results.append(analysis)

                # Record completion in metrics
                if analysis.data_availability == DataAvailability.AVAILABLE and analysis.scores:
                    metrics.complete_package(
                        package_name,
                        status="scored",
                        score=analysis.scores.overall,
                        grade=analysis.scores.grade,
                    )
                else:
                    metrics.complete_package(
                        package_name,
                        status="unavailable",
                        message=analysis.unavailable_reason,
                    )
            except Exception as e:
                errors.append((package_name, str(e)))
                metrics.record_error(package_name, type(e).__name__, str(e))
                metrics.complete_package(package_name, status="error", message=str(e))

        progress.update(task, completed=len(packages))

    # Finish batch
    metrics.finish_batch()

    # Separate available and unavailable packages
    available = [r for r in results if r.data_availability == DataAvailability.AVAILABLE]
    unavailable = [r for r in results if r.data_availability != DataAvailability.AVAILABLE]

    # Summary
    console.print()
    console.print(f"[bold green]Completed:[/bold green] {len(results)} packages analyzed")
    console.print(f"  [green]{len(available)}[/green] with scores, [yellow]{len(unavailable)}[/yellow] unavailable")

    if errors:
        console.print(f"[bold red]Errors:[/bold red] {len(errors)} packages failed")
        for name, error in errors[:5]:
            console.print(f"  [red]x[/red] {name}: {error}")

    # Show top/bottom scores (only for available packages)
    if available:
        sorted_results = sorted(available, key=lambda r: r.scores.overall if r.scores else 0, reverse=True)

        console.print()
        console.print("[bold]Top 5 Scores:[/bold]")
        for r in sorted_results[:5]:
            if r.scores:
                console.print(f"  {r.scores.overall:5.1f} {r.scores.grade}  {r.name}")

        console.print()
        console.print("[bold]Bottom 5 Scores:[/bold]")
        for r in sorted_results[-5:]:
            if r.scores:
                console.print(f"  {r.scores.overall:5.1f} {r.scores.grade}  {r.name}")

    # Show unavailable packages
    if unavailable:
        console.print()
        console.print("[bold yellow]Unavailable (no open source repo):[/bold yellow]")
        for r in unavailable[:10]:
            console.print(f"  [dim]-[/dim] {r.name}")
        if len(unavailable) > 10:
            console.print(f"  [dim]... and {len(unavailable) - 10} more[/dim]")

    console.print()
    console.print(f"[dim]Results saved to {data_dir}[/dim]")


@app.command()
def monitor(
    data_dir: Path = typer.Option(Path("data"), "--data-dir", "-d", help="Data directory"),
    interval: float = typer.Option(10.0, "--interval", "-i", help="Refresh interval in seconds"),
) -> None:
    """Launch the pipeline monitoring dashboard.

    Opens an interactive TUI dashboard that displays real-time metrics
    from the analysis pipeline. Use this to monitor a running analysis
    in another terminal.

    Controls:
      q - quit
      r - manual refresh
    """
    from pkgrisk.monitoring import run_dashboard

    metrics_file = data_dir / ".metrics.json"
    run_dashboard(metrics_file=metrics_file, refresh_interval=interval)


@app.command()
def version() -> None:
    """Show version information."""
    from pkgrisk import __version__

    console.print(f"pkgrisk v{__version__}")


if __name__ == "__main__":
    app()
