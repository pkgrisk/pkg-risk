"""End-to-end analysis pipeline for packages."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from pkgrisk.adapters.base import BaseAdapter
from pkgrisk.analyzers.deps_dev import DepsDevFetcher
from pkgrisk.analyzers.github import GitHubFetcher
from pkgrisk.analyzers.llm import LLMAnalyzer
from pkgrisk.analyzers.osv import OSVFetcher
from pkgrisk.analyzers.scorer import Scorer
from pkgrisk.analyzers.supply_chain import SupplyChainAnalyzer
from pkgrisk.models.schemas import (
    AggregatorData,
    DataAvailability,
    Ecosystem,
    LLMAssessments,
    PackageAnalysis,
    Platform,
    SupplyChainData,
)

if TYPE_CHECKING:
    from pkgrisk.monitoring import MetricsCollector


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
        llm_model: str = "llama3.3:70b",
        skip_llm: bool = False,
        skip_supply_chain: bool = False,
        metrics: MetricsCollector | None = None,
    ) -> None:
        """Initialize the pipeline.

        Args:
            adapter: Package manager adapter.
            data_dir: Directory to save results. Defaults to ./data.
            github_token: GitHub personal access token.
            llm_model: Ollama model for LLM analysis.
            skip_llm: Skip LLM analysis entirely.
            skip_supply_chain: Skip supply chain analysis (tarball inspection).
            metrics: Optional metrics collector for monitoring.
        """
        self.adapter = adapter
        self.data_dir = data_dir or Path("data")
        self.github = GitHubFetcher(token=github_token)
        self.osv = OSVFetcher()
        self.deps_dev = DepsDevFetcher()
        self.llm = LLMAnalyzer(model=llm_model) if not skip_llm else None
        self.supply_chain = SupplyChainAnalyzer() if not skip_supply_chain else None
        self.scorer = Scorer()
        self.metrics = metrics
        self.parallel_llm = False  # Run LLM calls in parallel for better GPU utilization
        self._http_client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "AnalysisPipeline":
        """Set up shared HTTP client."""
        self._http_client = httpx.AsyncClient(timeout=60.0)
        return self

    async def __aexit__(self, *args) -> None:
        """Clean up HTTP client."""
        if self._http_client:
            await self._http_client.aclose()

    def _record_timing(self, stage: str, duration: float) -> None:
        """Record stage timing if metrics collector is available."""
        if self.metrics:
            self.metrics.record_stage_timing(stage, duration)

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
        t0 = time.perf_counter()
        metadata = await self.adapter.get_package_metadata(package_name)
        install_stats = await self.adapter.get_install_stats(package_name)
        repo_ref = self.adapter.get_source_repo(metadata)
        install_count = install_stats.downloads_last_30d if install_stats else None
        self._record_timing("metadata", time.perf_counter() - t0)

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
            t0 = time.perf_counter()
            github_data = await self.github.fetch_repo_data(repo_ref)
            self._record_timing("github", time.perf_counter() - t0)

            # Update rate limits from GitHub fetcher
            if self.metrics and hasattr(self.github, 'rate_limit_remaining'):
                self.metrics.update_github_rate_limit(
                    self.github.rate_limit_remaining,
                    self.github.rate_limit_total,
                    self.github.rate_limit_reset,
                )

            if github_data is None:
                # Repo URL exists but couldn't fetch (404, private, etc.)
                data_availability = DataAvailability.REPO_NOT_FOUND
                unavailable_reason = f"Repository {repo_ref.owner}/{repo_ref.repo} not accessible (may be private, deleted, or renamed)"

        # Stage 2.5: Fetch CVE history from OSV
        if github_data and repo_ref:
            try:
                t0 = time.perf_counter()
                # Fetch release dates for time-to-patch calculation
                release_dates = await self.github.fetch_release_dates(
                    repo_ref.owner, repo_ref.repo
                )

                # Fetch CVE history
                cve_history = await self.osv.fetch_cve_history(
                    package_name=package_name,
                    ecosystem=ecosystem.value,
                    releases=github_data.releases,
                    owner=repo_ref.owner,
                    repo=repo_ref.repo,
                    release_dates=release_dates,
                )
                self._record_timing("cve", time.perf_counter() - t0)

                # Attach to security data and update known_cves count
                github_data.security.cve_history = cve_history
                github_data.security.known_cves = cve_history.total_cves

                # Update OSV status
                if self.metrics:
                    self.metrics.update_osv_status("OK")
            except Exception:
                if self.metrics:
                    self.metrics.update_osv_status("error")
                pass  # CVE fetching failures shouldn't break pipeline

        # Stage 2.6: Supply chain analysis (NPM only for now)
        supply_chain_data = None
        if self.supply_chain and ecosystem == Ecosystem.NPM:
            try:
                t0 = time.perf_counter()
                supply_chain_data = await self._run_supply_chain_analysis(
                    package_name, repo_ref
                )
                self._record_timing("supply_chain", time.perf_counter() - t0)
            except Exception as e:
                # Supply chain analysis failures shouldn't break pipeline
                import logging
                logging.getLogger(__name__).debug(
                    f"Supply chain analysis failed for {package_name}: {e}"
                )

        # Stage 2.7: Fetch deps.dev aggregator data (cross-forge intelligence)
        aggregator_data = None
        try:
            t0 = time.perf_counter()
            aggregator_data = await self.deps_dev.fetch_all_intelligence(
                package_name=package_name,
                version=metadata.version,
                ecosystem=ecosystem.value,
                repo_ref=repo_ref,
            )
            self._record_timing("deps_dev", time.perf_counter() - t0)

            # If we have project data for a non-GitHub repo, upgrade status
            # This includes Scorecard (GitHub) or basic metrics (GitLab/Bitbucket)
            if (
                data_availability == DataAvailability.NOT_GITHUB
                and aggregator_data
                and aggregator_data.has_project_data
            ):
                data_availability = DataAvailability.PARTIAL_FORGE
                unavailable_reason = (
                    f"Repository is on {repo_ref.platform.value}. "
                    f"Using deps.dev for cross-forge analysis."
                )
        except Exception as e:
            # deps.dev failures shouldn't break pipeline
            import logging
            logging.getLogger(__name__).debug(
                f"deps.dev fetch failed for {package_name}: {e}"
            )

        # Stage 3: Run LLM assessments (only if we have GitHub data)
        llm_assessments = None
        if self.llm and github_data:
            llm_available = await self.llm.is_available()
            if llm_available:
                t0 = time.perf_counter()
                llm_assessments = await self._run_llm_assessments(
                    package_name,
                    ecosystem.value,
                    repo_ref.owner if repo_ref else "",
                    repo_ref.repo if repo_ref else "",
                    github_data,
                    parallel=self.parallel_llm,
                )
                self._record_timing("llm", time.perf_counter() - t0)

        # Stage 4: Calculate scores (only if data is available)
        scores = None
        analysis_summary = None

        t0 = time.perf_counter()
        # Score if we have full GitHub data OR partial forge data from deps.dev
        can_score = (
            (data_availability == DataAvailability.AVAILABLE and github_data)
            or (data_availability == DataAvailability.PARTIAL_FORGE and aggregator_data)
        )

        if can_score:
            scores = self.scorer.calculate_scores(
                github_data,
                llm_assessments,
                install_count,
                ecosystem=ecosystem.value,
                metadata=metadata,
                supply_chain=supply_chain_data,
                aggregator_data=aggregator_data,
            )
            analysis_summary = self._build_summary(
                github_data, llm_assessments, scores, supply_chain_data, aggregator_data
            )
        else:
            # No scores for unavailable packages
            analysis_summary = {
                "data_availability": data_availability.value,
                "unavailable_reason": unavailable_reason,
            }
        self._record_timing("scoring", time.perf_counter() - t0)

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
            supply_chain=supply_chain_data,
            aggregator_data=aggregator_data,
            analysis_summary=analysis_summary,
            analyzed_at=datetime.now(timezone.utc),
            data_fetched_at=datetime.now(timezone.utc),
        )

        # Save if requested
        if save:
            t0 = time.perf_counter()
            self._save_analysis(analysis)
            self._record_timing("save", time.perf_counter() - t0)

        return analysis

    async def _run_llm_assessments(
        self,
        package_name: str,
        ecosystem: str,
        owner: str,
        repo: str,
        github_data,
        parallel: bool = False,
    ) -> LLMAssessments:
        """Run all LLM assessments for a package.

        Args:
            package_name: Package name.
            ecosystem: Ecosystem name.
            owner: GitHub owner.
            repo: GitHub repo name.
            github_data: GitHub data for the repo.
            parallel: If True, run LLM calls concurrently for better GPU utilization.

        Returns:
            LLMAssessments with all completed assessments.
        """
        if parallel:
            return await self._run_llm_assessments_parallel(
                package_name, ecosystem, owner, repo, github_data
            )
        return await self._run_llm_assessments_sequential(
            package_name, ecosystem, owner, repo, github_data
        )

    async def _run_llm_assessments_sequential(
        self,
        package_name: str,
        ecosystem: str,
        owner: str,
        repo: str,
        github_data,
    ) -> LLMAssessments:
        """Run LLM assessments sequentially (original behavior)."""
        assessments = LLMAssessments()

        # 1. README assessment
        if github_data.files.has_readme:
            readme_content = await self.github.fetch_readme_content(owner, repo)
            if readme_content:
                try:
                    assessments.readme = await self.llm.assess_readme(
                        readme_content, package_name, ecosystem
                    )
                except Exception:
                    pass  # LLM failures shouldn't break pipeline

        # 2. Sentiment assessment from issues
        try:
            issues = await self.github.fetch_recent_issues(owner, repo, limit=15)
            if issues:
                assessments.sentiment = await self.llm.assess_sentiment(
                    issues, package_name, ecosystem
                )
        except Exception:
            pass

        # 3. Communication assessment from maintainer comments
        try:
            comments = await self.github.fetch_maintainer_comments(owner, repo, limit=30)
            if comments and len(comments) >= 5:  # Need enough comments for meaningful analysis
                assessments.communication = await self.llm.assess_communication(
                    comments, package_name, ecosystem
                )
        except Exception:
            pass

        # 4. Maintenance assessment
        try:
            last_commit = github_data.commits.last_commit_date
            last_commit_str = last_commit.isoformat() if last_commit else "unknown"
            last_release = github_data.releases.last_release_date
            last_release_str = last_release.isoformat() if last_release else None

            # Use merged_prs if available, otherwise fall back to closed_prs
            # (some projects merge via CLI, so merged_at is never populated)
            pr_activity = github_data.prs.merged_prs_6mo
            if pr_activity == 0:
                pr_activity = github_data.prs.closed_prs_6mo

            assessments.maintenance = await self.llm.assess_maintenance(
                last_commit_date=last_commit_str,
                commit_count=github_data.commits.commits_last_6mo,
                open_issues=github_data.issues.open_issues,
                closed_issues=github_data.issues.closed_issues_6mo,
                open_prs=github_data.prs.open_prs,
                merged_prs=pr_activity,
                last_release_date=last_release_str,
                active_contributors=github_data.contributors.active_contributors_6mo,
                package_name=package_name,
                ecosystem=ecosystem,
            )
        except Exception:
            pass

        # 5. Changelog assessment
        if github_data.files.has_changelog:
            try:
                changelog_content = await self.github.fetch_changelog_content(owner, repo)
                if changelog_content:
                    assessments.changelog = await self.llm.assess_changelog(
                        changelog_content, package_name, ecosystem
                    )
            except Exception:
                pass

        # 6. Governance assessment
        if github_data.files.has_contributing or github_data.files.has_governance:
            try:
                governance_docs = await self.github.fetch_governance_docs(owner, repo)
                if governance_docs:
                    assessments.governance = await self.llm.assess_governance(
                        governance_docs, package_name, ecosystem
                    )
            except Exception:
                pass

        # 7. Security code analysis
        try:
            code_samples = await self.github.fetch_source_files_for_security(
                owner,
                repo,
                language=github_data.repo.language,
                default_branch=github_data.repo.default_branch,
                max_bytes=15000,
                max_files=10,
            )
            if code_samples:
                assessments.security = await self.llm.assess_security(
                    code_samples, package_name, ecosystem
                )
        except Exception:
            pass

        return assessments

    async def _run_llm_assessments_parallel(
        self,
        package_name: str,
        ecosystem: str,
        owner: str,
        repo: str,
        github_data,
    ) -> LLMAssessments:
        """Run LLM assessments in parallel for better GPU utilization.

        This fetches all content first, then runs all LLM calls concurrently.
        Can improve GPU utilization from ~50% to ~80-90% by keeping the GPU busy.
        """
        import asyncio

        assessments = LLMAssessments()

        # Phase 1: Fetch all content in parallel (network I/O)
        fetch_tasks = {}

        if github_data.files.has_readme:
            fetch_tasks["readme"] = self.github.fetch_readme_content(owner, repo)

        fetch_tasks["issues"] = self.github.fetch_recent_issues(owner, repo, limit=15)
        fetch_tasks["comments"] = self.github.fetch_maintainer_comments(owner, repo, limit=30)

        if github_data.files.has_changelog:
            fetch_tasks["changelog"] = self.github.fetch_changelog_content(owner, repo)

        if github_data.files.has_contributing or github_data.files.has_governance:
            fetch_tasks["governance"] = self.github.fetch_governance_docs(owner, repo)

        fetch_tasks["code_samples"] = self.github.fetch_source_files_for_security(
            owner,
            repo,
            language=github_data.repo.language,
            default_branch=github_data.repo.default_branch,
            max_bytes=15000,
            max_files=10,
        )

        # Execute all fetches concurrently
        fetch_results = {}
        if fetch_tasks:
            keys = list(fetch_tasks.keys())
            results = await asyncio.gather(
                *fetch_tasks.values(),
                return_exceptions=True,
            )
            for key, result in zip(keys, results):
                if not isinstance(result, Exception):
                    fetch_results[key] = result

        # Phase 2: Run all LLM assessments in parallel (GPU work)
        llm_tasks = {}

        # README assessment
        readme_content = fetch_results.get("readme")
        if readme_content:
            llm_tasks["readme"] = self.llm.assess_readme(
                readme_content, package_name, ecosystem
            )

        # Sentiment assessment
        issues = fetch_results.get("issues")
        if issues:
            llm_tasks["sentiment"] = self.llm.assess_sentiment(
                issues, package_name, ecosystem
            )

        # Communication assessment
        comments = fetch_results.get("comments")
        if comments and len(comments) >= 5:
            llm_tasks["communication"] = self.llm.assess_communication(
                comments, package_name, ecosystem
            )

        # Maintenance assessment (uses github_data, no fetch needed)
        last_commit = github_data.commits.last_commit_date
        last_commit_str = last_commit.isoformat() if last_commit else "unknown"
        last_release = github_data.releases.last_release_date
        last_release_str = last_release.isoformat() if last_release else None
        pr_activity = github_data.prs.merged_prs_6mo
        if pr_activity == 0:
            pr_activity = github_data.prs.closed_prs_6mo

        llm_tasks["maintenance"] = self.llm.assess_maintenance(
            last_commit_date=last_commit_str,
            commit_count=github_data.commits.commits_last_6mo,
            open_issues=github_data.issues.open_issues,
            closed_issues=github_data.issues.closed_issues_6mo,
            open_prs=github_data.prs.open_prs,
            merged_prs=pr_activity,
            last_release_date=last_release_str,
            active_contributors=github_data.contributors.active_contributors_6mo,
            package_name=package_name,
            ecosystem=ecosystem,
        )

        # Changelog assessment
        changelog_content = fetch_results.get("changelog")
        if changelog_content:
            llm_tasks["changelog"] = self.llm.assess_changelog(
                changelog_content, package_name, ecosystem
            )

        # Governance assessment
        governance_docs = fetch_results.get("governance")
        if governance_docs:
            llm_tasks["governance"] = self.llm.assess_governance(
                governance_docs, package_name, ecosystem
            )

        # Security assessment
        code_samples = fetch_results.get("code_samples")
        if code_samples:
            llm_tasks["security"] = self.llm.assess_security(
                code_samples, package_name, ecosystem
            )

        # Execute all LLM calls concurrently
        if llm_tasks:
            keys = list(llm_tasks.keys())
            results = await asyncio.gather(
                *llm_tasks.values(),
                return_exceptions=True,
            )
            for key, result in zip(keys, results):
                if not isinstance(result, Exception):
                    setattr(assessments, key, result)

        return assessments

    async def _run_supply_chain_analysis(
        self,
        package_name: str,
        repo_ref,
    ) -> SupplyChainData | None:
        """Run supply chain security analysis for a package.

        Args:
            package_name: Package name.
            repo_ref: Repository reference (for comparing tarball to repo).

        Returns:
            SupplyChainData with analysis results, or None if analysis fails.
        """
        # Import here to avoid circular imports
        from pkgrisk.adapters.npm import NpmAdapter

        # Only works with NPM adapter
        if not isinstance(self.adapter, NpmAdapter):
            return None

        # Fetch supply chain data from npm
        sc_data = await self.adapter.get_supply_chain_data(package_name)
        if not sc_data or not sc_data.get("package_json"):
            return None

        # Get repository file list for comparison (if available)
        repo_files = None
        if repo_ref:
            try:
                # We could fetch the repo tree here, but for now skip
                # to avoid additional API calls. The tarball analyzer
                # will still detect suspicious files.
                pass
            except Exception:
                pass

        # Run the analysis
        return await self.supply_chain.analyze_package(
            package_json=sc_data["package_json"],
            tarball_url=sc_data.get("tarball_url"),
            repo_files=repo_files,
            previous_version_data=sc_data.get("previous_version_data"),
            npm_package_data=sc_data.get("npm_package_data"),
        )

    def _build_summary(
        self,
        github_data,
        llm_assessments: LLMAssessments | None,
        scores,
        supply_chain: SupplyChainData | None = None,
        aggregator_data: AggregatorData | None = None,
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
                if llm_assessments.sentiment.common_complaints:
                    for complaint in llm_assessments.sentiment.common_complaints[:2]:
                        summary["concerns"].append(f"Community: {complaint}")

            if llm_assessments.communication:
                summary["communication_style"] = llm_assessments.communication.communication_style
                if llm_assessments.communication.communication_style == "exemplary":
                    summary["highlights"].append("Excellent maintainer communication")
                elif llm_assessments.communication.communication_style in ("poor", "hostile"):
                    summary["concerns"].append(f"Communication: {llm_assessments.communication.summary}")
                if llm_assessments.communication.red_flags:
                    for flag in llm_assessments.communication.red_flags[:2]:
                        summary["concerns"].append(f"Communication: {flag}")

            if llm_assessments.changelog:
                if llm_assessments.changelog.breaking_changes_marked:
                    summary["highlights"].append("Breaking changes clearly marked in changelog")
                if llm_assessments.changelog.has_migration_guides:
                    summary["highlights"].append("Has migration guides for upgrades")

            if llm_assessments.governance:
                if llm_assessments.governance.has_succession_plan:
                    summary["highlights"].append("Has succession plan for maintainers")
                if llm_assessments.governance.bus_factor_risk == "high":
                    summary["concerns"].append("Governance: High bus factor risk identified")

            if llm_assessments.security:
                # Add critical security findings
                if llm_assessments.security.critical_findings:
                    for finding in llm_assessments.security.critical_findings[:3]:
                        summary["concerns"].append(f"Security: {finding}")
                # Add high-severity injection risks
                if llm_assessments.security.injection_risks:
                    high_risks = [r for r in llm_assessments.security.injection_risks
                                  if r.get("severity") == "high"]
                    for risk in high_risks[:2]:
                        summary["concerns"].append(
                            f"Security: {risk.get('description', 'Injection risk detected')}"
                        )
                # Highlight good security practices
                if llm_assessments.security.overall_score >= 8:
                    summary["highlights"].append("Code follows security best practices")
                elif llm_assessments.security.overall_score <= 4:
                    summary["concerns"].append(
                        f"Security: {llm_assessments.security.summary}"
                    )

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

        # Supply chain security findings
        if supply_chain:
            summary["supply_chain_risk"] = supply_chain.risk_level

            # Critical findings get top priority
            for finding in supply_chain.critical_findings[:3]:
                summary["concerns"].insert(0, f"SUPPLY CHAIN: {finding}")

            # Lifecycle script warnings
            if supply_chain.lifecycle_scripts.has_preinstall:
                summary["concerns"].append("Supply Chain: Has preinstall script")
            if supply_chain.lifecycle_scripts.has_postinstall:
                summary["concerns"].append("Supply Chain: Has postinstall script")
            if supply_chain.lifecycle_scripts.installs_runtime:
                summary["concerns"].insert(0, "SUPPLY CHAIN: Installs alternative runtime (Shai Hulud indicator)")
            if supply_chain.lifecycle_scripts.has_credential_access:
                summary["concerns"].insert(0, "SUPPLY CHAIN: Accesses credential files")
            if supply_chain.lifecycle_scripts.has_obfuscation:
                summary["concerns"].append("Supply Chain: Contains obfuscated code")

            # Version diff warnings
            if supply_chain.version_diff:
                if supply_chain.version_diff.version_jump_suspicious:
                    summary["concerns"].append("Supply Chain: Suspicious version jump detected")
                if supply_chain.version_diff.scripts_added:
                    added = ", ".join(supply_chain.version_diff.scripts_added[:3])
                    summary["concerns"].append(f"Supply Chain: New scripts added: {added}")

            # Tarball warnings
            if supply_chain.tarball and supply_chain.tarball.suspicious_files:
                files = ", ".join(supply_chain.tarball.suspicious_files[:3])
                summary["concerns"].insert(0, f"SUPPLY CHAIN: Suspicious files in package: {files}")

            # Publishing warnings
            if not supply_chain.publishing.publisher_is_listed_maintainer:
                summary["concerns"].append("Supply Chain: Publisher not in maintainers list")

            # Positive signals
            if supply_chain.publishing.has_provenance:
                summary["highlights"].append("Has npm provenance attestation")
            if supply_chain.overall_risk_score == 0:
                summary["highlights"].append("No supply chain risks detected")

        # Aggregator data (deps.dev, OpenSSF Scorecard)
        if aggregator_data:
            # Basic project metrics (for GitLab/Bitbucket when Scorecard unavailable)
            if aggregator_data.project_metrics and not aggregator_data.scorecard:
                pm = aggregator_data.project_metrics
                summary["forge_metrics"] = {
                    "stars": pm.stars,
                    "forks": pm.forks,
                    "open_issues": pm.open_issues,
                }
                if pm.oss_fuzz_line_count:
                    coverage = (pm.oss_fuzz_line_cover_count or 0) / pm.oss_fuzz_line_count * 100
                    summary["highlights"].append(f"OSS-Fuzz coverage: {coverage:.0f}%")

            # Scorecard insights
            if aggregator_data.scorecard:
                sc = aggregator_data.scorecard
                summary["scorecard_score"] = sc.overall_score

                # Highlight good security practices
                if sc.overall_score >= 7:
                    summary["highlights"].append(
                        f"OpenSSF Scorecard: {sc.overall_score:.1f}/10"
                    )
                elif sc.overall_score < 4:
                    summary["concerns"].append(
                        f"Low OpenSSF Scorecard: {sc.overall_score:.1f}/10"
                    )

                # Specific check highlights
                if sc.cii_badge:
                    summary["highlights"].append("Has CII Best Practices badge")
                if sc.fuzzing_enabled:
                    summary["highlights"].append("Fuzzing enabled")
                if sc.sast_enabled:
                    summary["highlights"].append("SAST enabled")

                # Specific check concerns
                if sc.dangerous_workflow_score is not None and sc.dangerous_workflow_score < 5:
                    summary["concerns"].append("Dangerous CI/CD workflow patterns detected")
                if sc.branch_protection_score is not None and sc.branch_protection_score < 3:
                    summary["concerns"].append("Weak branch protection settings")

            # SLSA provenance
            if aggregator_data.slsa_attestation:
                level = aggregator_data.slsa_level
                if level:
                    summary["highlights"].append(f"SLSA Level {level} provenance")
                else:
                    summary["highlights"].append("Has SLSA provenance attestation")

            # Dependency graph concerns
            if aggregator_data.dependency_graph:
                dg = aggregator_data.dependency_graph
                summary["dependency_count"] = dg.total_count
                if dg.vulnerable_transitive > 0:
                    summary["concerns"].append(
                        f"Transitive deps with vulnerabilities: {dg.vulnerable_transitive}"
                    )
                if dg.max_depth > 10:
                    summary["concerns"].append(
                        f"Deep dependency tree (depth: {dg.max_depth})"
                    )

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
