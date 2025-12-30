"""Score calculator for package health metrics."""

import math
from datetime import datetime, timezone

from pkgrisk.models.schemas import (
    GitHubData,
    LLMAssessments,
    ScoreComponent,
    Scores,
)


class Scorer:
    """Calculates health scores from collected metrics.

    Scoring weights (total 100%):
    - Security: 30%
    - Maintenance: 25%
    - Community: 15%
    - Bus Factor: 10%
    - Documentation: 10%
    - Stability: 10%
    """

    # Score weights
    WEIGHTS = {
        "security": 30,
        "maintenance": 25,
        "community": 15,
        "bus_factor": 10,
        "documentation": 10,
        "stability": 10,
    }

    def calculate_scores(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
        install_count: int | None = None,
    ) -> Scores:
        """Calculate all score components.

        Args:
            github_data: GitHub repository data.
            llm_assessments: LLM-based assessments.
            install_count: Package install/download count.

        Returns:
            Scores object with all components and overall score.
        """
        security = self._calculate_security_score(github_data, llm_assessments)
        maintenance = self._calculate_maintenance_score(github_data, llm_assessments)
        community = self._calculate_community_score(github_data, llm_assessments, install_count)
        bus_factor = self._calculate_bus_factor_score(github_data, llm_assessments)
        documentation = self._calculate_documentation_score(github_data, llm_assessments)
        stability = self._calculate_stability_score(github_data, llm_assessments)

        # Calculate weighted overall score
        overall = (
            security.score * security.weight
            + maintenance.score * maintenance.weight
            + community.score * community.weight
            + bus_factor.score * bus_factor.weight
            + documentation.score * documentation.weight
            + stability.score * stability.weight
        ) / 100

        # Calculate grade
        grade = self._score_to_grade(overall)

        return Scores(
            overall=round(overall, 1),
            grade=grade,
            percentile=None,  # Calculated later when we have all packages
            security=security,
            maintenance=maintenance,
            community=community,
            bus_factor=bus_factor,
            documentation=documentation,
            stability=stability,
        )

    def _score_to_grade(self, score: float) -> str:
        """Convert numeric score to letter grade."""
        if score >= 90:
            return "A"
        elif score >= 80:
            return "B"
        elif score >= 70:
            return "C"
        elif score >= 60:
            return "D"
        else:
            return "F"

    def _calculate_security_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
    ) -> ScoreComponent:
        """Calculate security score (30% weight).

        Factors:
        - Known CVEs (major penalty)
        - SECURITY.md presence
        - Security CI (Dependabot, CodeQL)
        - Signed commits/releases
        - LLM security assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["security"])

        score = 100.0
        security = github_data.security

        # CVE penalty (major impact)
        if security.known_cves > 0:
            score -= min(40, security.known_cves * 10)

        # Vulnerable dependencies penalty
        if security.vulnerable_deps > 0:
            score -= min(20, security.vulnerable_deps * 5)

        # Security policy presence (bonus)
        if not security.has_security_md and not security.has_security_policy:
            score -= 10

        # Security CI tools (bonus for having them)
        security_tools = sum([
            security.has_dependabot,
            security.has_codeql,
            security.has_security_ci,
        ])
        if security_tools == 0:
            score -= 10
        elif security_tools >= 2:
            score += 5

        # Signed commits (small bonus)
        if security.signed_commits_pct >= 50:
            score += 5

        # LLM security assessment
        if llm_assessments and llm_assessments.security:
            llm_score = llm_assessments.security.overall_score
            # Weight LLM assessment at 20% of security score
            score = score * 0.8 + (llm_score * 10) * 0.2

            # Critical findings penalty
            if llm_assessments.security.critical_findings:
                score -= min(20, len(llm_assessments.security.critical_findings) * 10)

        return ScoreComponent(score=max(0, min(100, score)), weight=self.WEIGHTS["security"])

    def _calculate_maintenance_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
    ) -> ScoreComponent:
        """Calculate maintenance score (25% weight).

        Factors:
        - Commit recency (decay curve)
        - Commit frequency
        - Issue response rate
        - PR merge time
        - Release frequency
        - LLM maintenance assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["maintenance"])

        score = 100.0
        commits = github_data.commits
        issues = github_data.issues
        prs = github_data.prs
        releases = github_data.releases

        # Commit recency (exponential decay)
        if commits.last_commit_date:
            days_ago = (datetime.now(timezone.utc) - commits.last_commit_date).days
            # 50% decay at 90 days, 75% at 180 days, 90% at 365 days
            recency_factor = math.exp(-days_ago / 180)
            score *= (0.3 + 0.7 * recency_factor)  # Minimum 30% of score from recency

        # Commit frequency (6 months)
        if commits.commits_last_6mo == 0:
            score -= 20
        elif commits.commits_last_6mo < 5:
            score -= 10
        elif commits.commits_last_6mo > 50:
            score += 5

        # Issue close rate
        total_issues = issues.open_issues + issues.closed_issues_6mo
        if total_issues > 0:
            close_rate = issues.closed_issues_6mo / total_issues
            if close_rate < 0.3:
                score -= 15
            elif close_rate > 0.7:
                score += 5

        # Stale PRs penalty
        if prs.stale_prs > 5:
            score -= min(15, prs.stale_prs * 2)

        # Release frequency
        if releases.releases_last_year == 0:
            score -= 10
        elif releases.releases_last_year >= 4:
            score += 5

        # LLM maintenance assessment
        if llm_assessments and llm_assessments.maintenance:
            status = llm_assessments.maintenance.status
            status_scores = {
                "actively-maintained": 100,
                "maintained": 80,
                "minimal-maintenance": 60,
                "stale": 40,
                "abandoned": 20,
            }
            llm_score = status_scores.get(status, 50)
            # Weight LLM assessment at 30%
            score = score * 0.7 + llm_score * 0.3

        return ScoreComponent(score=max(0, min(100, score)), weight=self.WEIGHTS["maintenance"])

    def _calculate_community_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
        install_count: int | None = None,
    ) -> ScoreComponent:
        """Calculate community health score (15% weight).

        Factors:
        - Stars (age-normalized)
        - Fork ratio
        - New contributors
        - Good first issues
        - Download/install count
        - LLM sentiment assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["community"])

        score = 70.0  # Start at baseline
        repo = github_data.repo
        contributors = github_data.contributors
        issues = github_data.issues

        # Stars (logarithmic scale, normalized by age)
        if repo.stars > 0 and repo.created_at:
            age_years = max(1, (datetime.now(timezone.utc) - repo.created_at).days / 365)
            stars_per_year = repo.stars / age_years
            if stars_per_year > 1000:
                score += 15
            elif stars_per_year > 100:
                score += 10
            elif stars_per_year > 10:
                score += 5

        # Fork engagement (forks indicate active use)
        if repo.stars > 0:
            fork_ratio = repo.forks / repo.stars
            if fork_ratio > 0.1:
                score += 5

        # New contributors (sign of welcoming community)
        # Note: This is estimated, actual first-time contributors would need more data
        if contributors.total_contributors > 50:
            score += 5
        elif contributors.total_contributors > 10:
            score += 2

        # Good first issues (welcoming to newcomers)
        if issues.good_first_issue_count >= 5:
            score += 5
        elif issues.good_first_issue_count >= 1:
            score += 2

        # Has discussions enabled
        if repo.has_discussions:
            score += 3

        # Install/download count bonus
        if install_count:
            if install_count > 100000:
                score += 10
            elif install_count > 10000:
                score += 5

        # LLM sentiment assessment
        if llm_assessments and llm_assessments.sentiment:
            sentiment = llm_assessments.sentiment.sentiment
            frustration = llm_assessments.sentiment.frustration_level

            sentiment_adjustments = {
                "positive": 10,
                "neutral": 0,
                "mixed": -5,
                "negative": -15,
            }
            score += sentiment_adjustments.get(sentiment, 0)

            # Frustration level penalty
            if frustration >= 7:
                score -= 10
            elif frustration >= 5:
                score -= 5

        return ScoreComponent(score=max(0, min(100, score)), weight=self.WEIGHTS["community"])

    def _calculate_bus_factor_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
    ) -> ScoreComponent:
        """Calculate bus factor score (10% weight).

        Factors:
        - Number of significant contributors
        - Top contributor concentration
        - Active contributors
        - Org vs personal repo
        - LLM governance assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["bus_factor"])

        score = 50.0  # Start at midpoint
        contributors = github_data.contributors
        repo = github_data.repo
        files = github_data.files

        # Multiple significant contributors
        if contributors.contributors_over_5pct >= 3:
            score += 25
        elif contributors.contributors_over_5pct >= 2:
            score += 15
        elif contributors.contributors_over_5pct == 1:
            score -= 10

        # Top contributor concentration (penalty for high concentration)
        if contributors.top_contributor_pct > 90:
            score -= 20
        elif contributors.top_contributor_pct > 75:
            score -= 10
        elif contributors.top_contributor_pct < 50:
            score += 10

        # Active contributors recently
        if contributors.active_contributors_6mo >= 5:
            score += 10
        elif contributors.active_contributors_6mo >= 2:
            score += 5
        elif contributors.active_contributors_6mo == 1:
            score -= 10

        # Org repo (usually more sustainable)
        # Note: This is a simplification - would need to check repo.owner type
        if files.has_codeowners:
            score += 5

        if files.has_governance:
            score += 5

        # LLM governance assessment
        if llm_assessments and llm_assessments.governance:
            gov = llm_assessments.governance
            if gov.has_succession_plan:
                score += 10
            if gov.indicates_multiple_maintainers:
                score += 5
            if gov.bus_factor_risk == "high":
                score -= 15
            elif gov.bus_factor_risk == "low":
                score += 10

        return ScoreComponent(score=max(0, min(100, score)), weight=self.WEIGHTS["bus_factor"])

    def _calculate_documentation_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
    ) -> ScoreComponent:
        """Calculate documentation score (10% weight).

        Factors:
        - README presence and size
        - Docs directory
        - Examples directory
        - CHANGELOG presence
        - LLM README assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["documentation"])

        score = 0.0
        files = github_data.files

        # README (essential)
        if files.has_readme:
            score += 20
            # Size bonus (more comprehensive)
            if files.readme_size_bytes > 5000:
                score += 10
            elif files.readme_size_bytes > 1000:
                score += 5

        # Docs directory
        if files.has_docs_dir:
            score += 15

        # Examples
        if files.has_examples_dir:
            score += 15

        # CHANGELOG
        if files.has_changelog:
            score += 10

        # CONTRIBUTING guide
        if files.has_contributing:
            score += 5

        # LLM README assessment (major weight)
        if llm_assessments and llm_assessments.readme:
            readme = llm_assessments.readme
            # Average of key dimensions, scaled to 25 points
            llm_avg = (
                readme.clarity
                + readme.installation
                + readme.quick_start
                + readme.examples
            ) / 4
            score += llm_avg * 2.5

        else:
            # If no LLM assessment, baseline from file presence
            score += 25 if files.has_readme else 0

        return ScoreComponent(score=max(0, min(100, score)), weight=self.WEIGHTS["documentation"])

    def _calculate_stability_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
    ) -> ScoreComponent:
        """Calculate stability score (10% weight).

        Factors:
        - Version >= 1.0
        - Pre-release ratio
        - Has tests
        - Has CI
        - Regression issues
        - LLM changelog assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["stability"])

        score = 60.0  # Start at reasonable baseline
        releases = github_data.releases
        files = github_data.files
        issues = github_data.issues
        ci = github_data.ci

        # Version maturity
        if releases.latest_version:
            # Try to detect if >= 1.0
            version = releases.latest_version.lstrip("v")
            try:
                major = int(version.split(".")[0])
                if major >= 1:
                    score += 15
            except ValueError:
                pass

        # Pre-release ratio (too many prereleases = less stable)
        if releases.prerelease_ratio > 0.5:
            score -= 10
        elif releases.prerelease_ratio < 0.1:
            score += 5

        # Test suite
        if files.has_tests_dir:
            score += 10

        # CI/CD
        if ci.has_github_actions:
            score += 10
            # Pass rate bonus
            if ci.recent_runs_pass_rate is not None:
                if ci.recent_runs_pass_rate >= 95:
                    score += 5
                elif ci.recent_runs_pass_rate < 70:
                    score -= 10

        # Regression issues penalty
        if issues.regression_issue_count > 5:
            score -= 10
        elif issues.regression_issue_count > 0:
            score -= 5

        # LLM changelog assessment
        if llm_assessments and llm_assessments.changelog:
            changelog = llm_assessments.changelog
            if changelog.breaking_changes_marked:
                score += 5
            if changelog.has_migration_guides:
                score += 5

        return ScoreComponent(score=max(0, min(100, score)), weight=self.WEIGHTS["stability"])


def calculate_percentiles(packages: list[dict]) -> list[dict]:
    """Calculate percentile ranks for a list of packages.

    Args:
        packages: List of package dicts with 'scores' containing 'overall'.

    Returns:
        Updated packages with percentile values.
    """
    # Sort by overall score
    sorted_packages = sorted(
        packages,
        key=lambda p: p.get("scores", {}).get("overall", 0),
    )

    n = len(sorted_packages)
    for i, package in enumerate(sorted_packages):
        if "scores" in package and package["scores"]:
            percentile = (i + 1) / n * 100
            package["scores"]["percentile"] = round(percentile, 1)

    return packages
