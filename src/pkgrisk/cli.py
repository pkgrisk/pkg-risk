"""CLI entry point for pkgrisk."""

import asyncio
import json
from pathlib import Path

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from pkgrisk.adapters.homebrew import HomebrewAdapter
from pkgrisk.analyzers.github import GitHubFetcher

app = typer.Typer(help="Package health and risk scoring tool.")
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
    if ecosystem.lower() != "homebrew":
        console.print(f"[red]Ecosystem '{ecosystem}' not yet supported.[/red]")
        console.print("Supported ecosystems: homebrew")
        raise typer.Exit(1)

    adapter = HomebrewAdapter()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        progress.add_task("Fetching package list...", total=None)
        packages = await adapter.list_packages(limit=limit)

    table = Table(title=f"Top {len(packages)} Homebrew Formulas")
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
    if ecosystem.lower() != "homebrew":
        console.print(f"[red]Ecosystem '{ecosystem}' not yet supported.[/red]")
        raise typer.Exit(1)

    adapter = HomebrewAdapter()
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
def version() -> None:
    """Show version information."""
    from pkgrisk import __version__

    console.print(f"pkgrisk v{__version__}")


if __name__ == "__main__":
    app()
