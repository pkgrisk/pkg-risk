"""End-to-end analysis pipeline for packages."""

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

from pkgrisk.adapters.base import BaseAdapter
from pkgrisk.analyzers.github import GitHubFetcher
from pkgrisk.analyzers.llm import LLMAnalyzer
from pkgrisk.analyzers.scorer import Scorer
from pkgrisk.models.schemas import (
    DataAvailability,
    Ecosystem,
    LLMAssessments,
    PackageAnalysis,
    Platform,
)


class AnalysisPipeline:
    """Orchestrates the full analysis pipeline for packages.

    Pipeline stages:
    1. Fetch package metadata from ecosystem adapter
    2. Fetch GitHub repository data (if available)
    3. Run LLM assessments (if Ollama available)
    4. Calculate scores
    5. Save results
    """

    def __init__(
        self,
        adapter: BaseAdapter,
        data_dir: Path | None = None,
        github_token: str | None = None,
        llm_model: str = "llama3.1:70b",
        skip_llm: bool = False,
    ) -> None:
        """Initialize the pipeline.

        Args:
            adapter: Package manager adapter.
            data_dir: Directory to save results. Defaults to ./data.
            github_token: GitHub personal access token.
            llm_model: Ollama model for LLM analysis.
            skip_llm: Skip LLM analysis entirely.
        """
        self.adapter = adapter
        self.data_dir = data_dir or Path("data")
        self.github = GitHubFetcher(token=github_token)
        self.llm = LLMAnalyzer(model=llm_model) if not skip_llm else None
        self.scorer = Scorer()
        self._http_client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "AnalysisPipeline":
        """Set up shared HTTP client."""
        self._http_client = httpx.AsyncClient(timeout=60.0)
        return self

    async def __aexit__(self, *args) -> None:
        """Clean up HTTP client."""
        if self._http_client:
            await self._http_client.aclose()

    async def analyze_package(
        self,
        package_name: str,
        save: bool = True,
    ) -> PackageAnalysis:
        """Run full analysis on a single package.

        Args:
            package_name: Name of the package to analyze.
            save: Whether to save results to disk.

        Returns:
            Complete PackageAnalysis.
        """
        ecosystem = self.adapter.ecosystem

        # Stage 1: Fetch package metadata
        metadata = await self.adapter.get_package_metadata(package_name)
        install_stats = await self.adapter.get_install_stats(package_name)
        repo_ref = self.adapter.get_source_repo(metadata)
        install_count = install_stats.downloads_last_30d if install_stats else None

        # Stage 2: Determine data availability and fetch GitHub data
        data_availability = DataAvailability.AVAILABLE
        unavailable_reason = None
        github_data = None

        if not repo_ref:
            # No repository URL found
            data_availability = DataAvailability.NO_REPO
            unavailable_reason = "No source repository URL found in package metadata"
        elif repo_ref.platform != Platform.GITHUB:
            # Repository exists but not on GitHub
            data_availability = DataAvailability.NOT_GITHUB
            unavailable_reason = f"Repository is on {repo_ref.platform.value}, not GitHub. Limited analysis available."
        else:
            # Try to fetch GitHub data
            github_data = await self.github.fetch_repo_data(repo_ref)
            if github_data is None:
                # Repo URL exists but couldn't fetch (404, private, etc.)
                data_availability = DataAvailability.REPO_NOT_FOUND
                unavailable_reason = f"Repository {repo_ref.owner}/{repo_ref.repo} not accessible (may be private, deleted, or renamed)"

        # Stage 3: Run LLM assessments (only if we have GitHub data)
        llm_assessments = None
        if self.llm and github_data:
            llm_available = await self.llm.is_available()
            if llm_available:
                llm_assessments = await self._run_llm_assessments(
                    package_name,
                    ecosystem.value,
                    repo_ref.owner if repo_ref else "",
                    repo_ref.repo if repo_ref else "",
                    github_data,
                )

        # Stage 4: Calculate scores (only if data is available)
        scores = None
        analysis_summary = None

        if data_availability == DataAvailability.AVAILABLE and github_data:
            scores = self.scorer.calculate_scores(github_data, llm_assessments, install_count)
            analysis_summary = self._build_summary(github_data, llm_assessments, scores)
        else:
            # No scores for unavailable packages
            analysis_summary = {
                "data_availability": data_availability.value,
                "unavailable_reason": unavailable_reason,
            }

        # Stage 5: Create result
        analysis = PackageAnalysis(
            ecosystem=ecosystem,
            name=package_name,
            description=metadata.description,
            version=metadata.version,
            homepage=metadata.homepage,
            repository=repo_ref,
            install_count_30d=install_count,
            data_availability=data_availability,
            unavailable_reason=unavailable_reason,
            scores=scores,
            github_data=github_data,
            llm_assessments=llm_assessments,
            analysis_summary=analysis_summary,
            analyzed_at=datetime.now(timezone.utc),
            data_fetched_at=datetime.now(timezone.utc),
        )

        # Save if requested
        if save:
            self._save_analysis(analysis)

        return analysis

    async def _run_llm_assessments(
        self,
        package_name: str,
        ecosystem: str,
        owner: str,
        repo: str,
        github_data,
    ) -> LLMAssessments:
        """Run all LLM assessments for a package.

        Args:
            package_name: Package name.
            ecosystem: Ecosystem name.
            owner: GitHub owner.
            repo: GitHub repo name.
            github_data: GitHub data for the repo.

        Returns:
            LLMAssessments with all completed assessments.
        """
        assessments = LLMAssessments()

        # README assessment
        if github_data.files.has_readme:
            readme_content = await self.github.fetch_readme_content(owner, repo)
            if readme_content:
                try:
                    assessments.readme = await self.llm.assess_readme(
                        readme_content, package_name, ecosystem
                    )
                except Exception:
                    pass  # LLM failures shouldn't break pipeline

        # Sentiment assessment from issues
        try:
            issues = await self.github.fetch_recent_issues(owner, repo, limit=15)
            if issues:
                assessments.sentiment = await self.llm.assess_sentiment(
                    issues, package_name, ecosystem
                )
        except Exception:
            pass

        # Maintenance assessment
        try:
            last_commit = github_data.commits.last_commit_date
            last_commit_str = last_commit.isoformat() if last_commit else "unknown"
            last_release = github_data.releases.last_release_date
            last_release_str = last_release.isoformat() if last_release else None

            assessments.maintenance = await self.llm.assess_maintenance(
                last_commit_date=last_commit_str,
                commit_count=github_data.commits.commits_last_6mo,
                open_issues=github_data.issues.open_issues,
                closed_issues=github_data.issues.closed_issues_6mo,
                open_prs=github_data.prs.open_prs,
                merged_prs=github_data.prs.merged_prs_6mo,
                last_release_date=last_release_str,
                active_contributors=github_data.contributors.active_contributors_6mo,
                package_name=package_name,
                ecosystem=ecosystem,
            )
        except Exception:
            pass

        return assessments

    def _build_summary(
        self,
        github_data,
        llm_assessments: LLMAssessments | None,
        scores,
    ) -> dict:
        """Build human-readable analysis summary."""
        summary = {
            "maintenance_status": "unknown",
            "security_summary": "",
            "doc_summary": "",
            "concerns": [],
            "highlights": [],
        }

        if llm_assessments:
            if llm_assessments.maintenance:
                summary["maintenance_status"] = llm_assessments.maintenance.status
                summary["concerns"].extend(llm_assessments.maintenance.concerns)
                summary["highlights"].extend(llm_assessments.maintenance.positive_signals)

            if llm_assessments.readme:
                summary["doc_summary"] = llm_assessments.readme.summary
                if llm_assessments.readme.top_issue:
                    summary["concerns"].append(f"Docs: {llm_assessments.readme.top_issue}")

            if llm_assessments.sentiment:
                summary["community_sentiment"] = llm_assessments.sentiment.sentiment
                if llm_assessments.sentiment.abandonment_signals:
                    summary["concerns"].append("Possible abandonment signals detected")

        if github_data:
            # Security summary
            security_items = []
            if github_data.security.known_cves > 0:
                security_items.append(f"{github_data.security.known_cves} known CVEs")
            if github_data.security.has_security_md:
                security_items.append("has SECURITY.md")
            if github_data.security.has_dependabot:
                security_items.append("Dependabot enabled")
            summary["security_summary"] = ", ".join(security_items) if security_items else "No issues"

            # Bus factor concern
            if github_data.contributors.top_contributor_pct > 80:
                pct = github_data.contributors.top_contributor_pct
                summary["concerns"].append(f"High bus factor risk ({pct:.0f}% from top contributor)")

            # Highlight active maintenance
            if github_data.commits.commits_last_6mo > 20:
                summary["highlights"].append("Actively maintained")

            if github_data.ci.has_github_actions:
                summary["highlights"].append("CI/CD configured")

        return summary

    def _save_analysis(self, analysis: PackageAnalysis) -> Path:
        """Save analysis result to disk.

        Args:
            analysis: The analysis to save.

        Returns:
            Path to saved file.
        """
        # Create directory structure
        ecosystem_dir = self.data_dir / "analyzed" / analysis.ecosystem.value
        ecosystem_dir.mkdir(parents=True, exist_ok=True)

        # Save individual package file
        filepath = ecosystem_dir / f"{analysis.name}.json"
        data = analysis.model_dump(mode="json")
        filepath.write_text(json.dumps(data, indent=2, default=str))

        return filepath

    async def analyze_packages(
        self,
        limit: int | None = None,
        progress_callback=None,
    ) -> list[PackageAnalysis]:
        """Analyze multiple packages from the adapter.

        Args:
            limit: Maximum number of packages to analyze.
            progress_callback: Optional callback(current, total, package_name).

        Returns:
            List of completed analyses.
        """
        # Get package list
        packages = await self.adapter.list_packages(limit=limit)
        total = len(packages)
        results = []

        for i, package_name in enumerate(packages):
            if progress_callback:
                progress_callback(i + 1, total, package_name)

            try:
                analysis = await self.analyze_package(package_name, save=True)
                results.append(analysis)
            except Exception as e:
                # Log but continue with other packages
                print(f"Error analyzing {package_name}: {e}")

        # Save combined results
        self._save_ecosystem_summary(results)

        return results

    def _save_ecosystem_summary(self, analyses: list[PackageAnalysis]) -> None:
        """Save summary file for an ecosystem.

        Args:
            analyses: List of completed analyses.
        """
        if not analyses:
            return

        ecosystem = analyses[0].ecosystem

        # Create final directory
        final_dir = self.data_dir / "final"
        final_dir.mkdir(parents=True, exist_ok=True)

        # Build summary data (lighter weight than full analysis)
        summary_data = []
        for analysis in analyses:
            summary_data.append({
                "name": analysis.name,
                "version": analysis.version,
                "description": analysis.description,
                "install_count_30d": analysis.install_count_30d,
                "data_availability": analysis.data_availability.value,
                "unavailable_reason": analysis.unavailable_reason,
                "scores": analysis.scores.model_dump() if analysis.scores else None,
                "analysis_summary": analysis.analysis_summary,
                "repository": analysis.repository.model_dump() if analysis.repository else None,
                "analyzed_at": analysis.analyzed_at.isoformat() if analysis.analyzed_at else None,
            })

        # Save ecosystem file
        filepath = final_dir / f"{ecosystem.value}.json"
        filepath.write_text(json.dumps(summary_data, indent=2))

        # Update stats
        stats_file = final_dir / "stats.json"
        stats = {}
        if stats_file.exists():
            stats = json.loads(stats_file.read_text())

        # Calculate stats only for available packages
        available = [a for a in analyses if a.data_availability == DataAvailability.AVAILABLE]
        unavailable = [a for a in analyses if a.data_availability != DataAvailability.AVAILABLE]

        stats[ecosystem.value] = {
            "total_packages": len(analyses),
            "available_packages": len(available),
            "unavailable_packages": len(unavailable),
            "avg_score": sum(a.scores.overall for a in available if a.scores) / len(available) if available else None,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        stats_file.write_text(json.dumps(stats, indent=2))
