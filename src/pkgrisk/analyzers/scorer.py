"""Score calculator for package health metrics."""

import math
from datetime import datetime, timezone

from pkgrisk.models.schemas import (
    GitHubData,
    LLMAssessments,
    RiskTier,
    ScoreComponent,
    Scores,
    UpdateUrgency,
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

    # CVE severity penalties (replaces flat -10 per CVE)
    CVE_SEVERITY_PENALTIES = {
        "CRITICAL": -20,
        "HIGH": -15,
        "MEDIUM": -8,
        "LOW": -3,
        "UNKNOWN": -10,
    }
    CVE_MAX_PENALTY = -60  # Max total CVE penalty (up from -40)

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

        # Calculate enterprise risk indicators
        risk_tier = self._calculate_risk_tier(overall, security.score, github_data)
        update_urgency = self._calculate_update_urgency(github_data)

        # Calculate confidence based on data completeness
        confidence, confidence_factors = self._calculate_confidence(
            github_data, llm_assessments
        )

        # Determine project age band
        project_age_band = self._get_project_age_band(github_data)

        return Scores(
            overall=round(overall, 1),
            grade=grade,
            percentile=None,  # Calculated later when we have all packages
            risk_tier=risk_tier,
            update_urgency=update_urgency,
            confidence=confidence,
            confidence_factors=confidence_factors,
            project_age_band=project_age_band,
            security=security,
            maintenance=maintenance,
            community=community,
            bus_factor=bus_factor,
            documentation=documentation,
            stability=stability,
        )

    def _calculate_risk_tier(
        self, overall: float, security_score: float, github_data: GitHubData | None
    ) -> RiskTier:
        """Calculate enterprise risk tier classification.

        Tier 1 (Approved): Score ≥80, no unpatched CVEs, active maintenance
        Tier 2 (Conditional): Score 60-79, or minor concerns
        Tier 3 (Restricted): Score <60, or critical issues
        Tier 4 (Prohibited): Unpatched critical CVEs, abandoned, known malicious
        """
        # Check for prohibition conditions
        if github_data:
            security = github_data.security
            repo = github_data.repo

            # Tier 4: Prohibited
            if repo.is_archived:
                return RiskTier.PROHIBITED
            if security.cve_history and security.cve_history.has_unpatched:
                for cve in security.cve_history.cves:
                    if cve.severity and cve.severity.upper() == "CRITICAL" and not cve.fixed_version:
                        return RiskTier.PROHIBITED

            # Check for critical security issues
            if security_score < 40:
                return RiskTier.RESTRICTED

        # Score-based tiers
        if overall >= 80 and security_score >= 70:
            return RiskTier.APPROVED
        elif overall >= 60:
            return RiskTier.CONDITIONAL
        else:
            return RiskTier.RESTRICTED

    def _calculate_update_urgency(self, github_data: GitHubData | None) -> UpdateUrgency:
        """Calculate update urgency indicator.

        Critical: Unpatched CVE, update immediately
        High: Patched CVE in newer version, update soon
        Medium: Maintenance concerns, plan update
        Low: Current version acceptable, update opportunistically
        """
        if not github_data:
            return UpdateUrgency.LOW

        security = github_data.security
        repo = github_data.repo

        # Critical: Unpatched vulnerabilities
        if security.cve_history and security.cve_history.has_unpatched:
            return UpdateUrgency.CRITICAL

        # High: Has patched vulnerabilities (newer version available)
        if security.cve_history and security.cve_history.total_cves > 0:
            if any(cve.fixed_version for cve in security.cve_history.cves):
                return UpdateUrgency.HIGH

        # Medium: Deprecated or archived
        if repo.is_archived or getattr(repo, 'is_deprecated', False):
            return UpdateUrgency.MEDIUM

        # Medium: Low maintenance activity
        commits = github_data.commits
        if commits.commits_last_6mo == 0:
            return UpdateUrgency.MEDIUM

        return UpdateUrgency.LOW

    def _calculate_confidence(
        self, github_data: GitHubData | None, llm_assessments: LLMAssessments | None
    ) -> tuple[str, list[str]]:
        """Calculate score confidence based on data completeness.

        Returns:
            Tuple of (confidence_level, list_of_factors_reducing_confidence)
        """
        factors = []

        if not github_data:
            return "low", ["No GitHub data available"]

        # Check for missing data sources
        if not llm_assessments:
            factors.append("No LLM assessment available")

        repo = github_data.repo

        # Check for very new packages (< 6 months)
        if repo.created_at:
            age_days = (datetime.now(timezone.utc) - repo.created_at).days
            if age_days < 180:
                factors.append("Very new package (<6 months)")

        # Check for limited contributor data
        if github_data.contributors.total_contributors < 2:
            factors.append("Limited contributor data")

        # Check for limited issue/PR history
        if github_data.issues.open_issues + github_data.issues.closed_issues_6mo < 5:
            factors.append("Limited issue history")

        # Determine confidence level
        if len(factors) == 0:
            return "high", []
        elif len(factors) <= 2:
            return "medium", factors
        else:
            return "low", factors

    def _get_project_age_band(self, github_data: GitHubData | None) -> str | None:
        """Determine project age band for normalization context.

        Age bands:
        - new: < 1 year
        - established: 1-3 years
        - mature: 3-7 years
        - legacy: 7+ years
        """
        if not github_data or not github_data.repo.created_at:
            return None

        age_days = (datetime.now(timezone.utc) - github_data.repo.created_at).days
        age_years = age_days / 365

        if age_years < 1:
            return "new"
        elif age_years < 3:
            return "established"
        elif age_years < 7:
            return "mature"
        else:
            return "legacy"

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
        - Known CVEs (severity-weighted penalties)
        - Time-to-patch responsiveness
        - SECURITY.md presence
        - Security CI tools (Dependabot, CodeQL, Snyk, etc.)
        - Signed commits/releases
        - Supply chain security signals
        - LLM security assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["security"])

        score = 100.0
        security = github_data.security

        # CVE severity-weighted penalties
        cve_penalty = self._calculate_cve_penalty(security)
        score += cve_penalty

        # Time-to-patch scoring
        patch_adjustment = self._calculate_patch_time_score(security)
        score += patch_adjustment

        # Vulnerable dependencies penalty
        if security.vulnerable_deps > 0:
            score -= min(20, security.vulnerable_deps * 5)

        # Security policy presence (bonus)
        if not security.has_security_md and not security.has_security_policy:
            score -= 10

        # Security CI tools (expanded detection)
        security_tools = sum([
            security.has_dependabot,
            security.has_codeql,
            security.has_security_ci,
            getattr(security, 'has_snyk', False),
            getattr(security, 'has_renovate', False),
            getattr(security, 'has_trivy', False),
            getattr(security, 'has_semgrep', False),
        ])
        if security_tools == 0:
            score -= 10
        elif security_tools >= 3:
            score += 10
        elif security_tools >= 2:
            score += 5

        # Signed commits (tiered bonus)
        if security.signed_commits_pct >= 80:
            score += 10
        elif security.signed_commits_pct >= 50:
            score += 5

        # Supply chain security signals
        supply_chain_bonus = self._calculate_supply_chain_score(security)
        score += supply_chain_bonus

        # LLM security assessment
        if llm_assessments and llm_assessments.security:
            llm_score = llm_assessments.security.overall_score
            # Weight LLM assessment at 20% of security score
            score = score * 0.8 + (llm_score * 10) * 0.2

            # Critical findings penalty
            if llm_assessments.security.critical_findings:
                score -= min(20, len(llm_assessments.security.critical_findings) * 10)

        return ScoreComponent(score=max(0, min(100, score)), weight=self.WEIGHTS["security"])

    def _calculate_cve_penalty(self, security: "SecurityData") -> float:
        """Calculate CVE penalty based on severity.

        Uses severity-weighted penalties instead of flat -10 per CVE.
        CRITICAL: -20, HIGH: -15, MEDIUM: -8, LOW: -3, UNKNOWN: -10
        """
        if not security.cve_history or not security.cve_history.cves:
            # Fall back to old method if no detailed CVE data
            if security.known_cves > 0:
                return max(self.CVE_MAX_PENALTY, -security.known_cves * 10)
            return 0.0

        total_penalty = 0.0
        for cve in security.cve_history.cves:
            severity = cve.severity.upper() if cve.severity else "UNKNOWN"
            penalty = self.CVE_SEVERITY_PENALTIES.get(severity, -10)
            total_penalty += penalty

        return max(self.CVE_MAX_PENALTY, total_penalty)

    def _calculate_patch_time_score(self, security: "SecurityData") -> float:
        """Calculate score adjustment based on patch responsiveness.

        Rewards quick patching, penalizes slow response:
        - Avg patch time < 7 days: +10 bonus
        - Avg patch time < 30 days: +5 bonus
        - Avg patch time > 90 days: -10 penalty
        - Has unpatched CVEs > 30 days: -15 additional penalty
        """
        if not security.cve_history:
            return 0.0

        adjustment = 0.0

        # Reward fast average patch time
        if security.cve_history.avg_days_to_patch is not None:
            avg_days = security.cve_history.avg_days_to_patch
            if avg_days < 7:
                adjustment += 10
            elif avg_days < 30:
                adjustment += 5
            elif avg_days > 90:
                adjustment -= 10

        # Penalize unpatched vulnerabilities
        if security.cve_history.has_unpatched:
            # Check for old unpatched CVEs
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            for cve in security.cve_history.cves:
                if cve.fixed_version is None:
                    days_unpatched = (now - cve.published_date).days
                    if days_unpatched > 30:
                        adjustment -= 15
                        break  # Only apply once

        return adjustment

    def _calculate_supply_chain_score(self, security: "SecurityData") -> float:
        """Calculate supply chain security bonus.

        Awards points for supply chain security practices:
        - SLSA compliance: +5 to +15 based on level
        - Sigstore/cosign signing: +10
        - SBOM publication: +5
        - Reproducible builds: +5
        """
        bonus = 0.0

        # Check for supply chain security attributes (added via schema extension)
        slsa_level = getattr(security, 'slsa_level', None)
        if slsa_level:
            slsa_bonuses = {1: 5, 2: 10, 3: 15, 4: 15}
            bonus += slsa_bonuses.get(slsa_level, 0)

        if getattr(security, 'has_sigstore', False):
            bonus += 10

        if getattr(security, 'has_sbom', False):
            bonus += 5

        if getattr(security, 'has_reproducible_builds', False):
            bonus += 5

        return bonus

    def _calculate_maintenance_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
    ) -> ScoreComponent:
        """Calculate maintenance score (25% weight).

        Factors:
        - Commit recency (decay curve)
        - Commit presence (normalized, not raw volume)
        - Issue response time and close rate
        - PR merge time
        - Release cadence (sweet spot scoring)
        - Deprecation/archived status
        - LLM maintenance assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["maintenance"])

        score = 100.0
        commits = github_data.commits
        issues = github_data.issues
        prs = github_data.prs
        releases = github_data.releases
        repo = github_data.repo

        # Deprecation/archived detection (major penalty)
        if repo.is_archived:
            score -= 40
        if getattr(repo, 'is_deprecated', False):
            score -= 30

        # Commit recency (exponential decay)
        if commits.last_commit_date:
            days_ago = (datetime.now(timezone.utc) - commits.last_commit_date).days
            # 50% decay at 90 days, 75% at 180 days, 90% at 365 days
            recency_factor = math.exp(-days_ago / 180)
            score *= (0.3 + 0.7 * recency_factor)  # Minimum 30% of score from recency

        # Commit presence-based scoring (normalized approach)
        # Instead of rewarding raw commit volume, focus on activity presence
        if commits.commits_last_6mo == 0:
            score -= 20  # No activity is concerning
        elif commits.commits_last_6mo >= 1:
            score += 5  # Has recent activity - good sign
            # Small bonus for consistent activity, but not proportional to volume
            if commits.commits_last_6mo >= 10:
                score += 3  # Sustained activity

        # Issue response time scoring
        response_adjustment = self._calculate_issue_response_score(issues)
        score += response_adjustment

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

        # Release cadence (sweet spot scoring)
        score += self._calculate_release_cadence_score(releases, commits)

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

    def _calculate_issue_response_score(self, issues: "IssueStats") -> float:
        """Calculate score adjustment based on issue response times.

        Rewards quick responses:
        - First response < 48 hours (median): +10
        - First response < 7 days: +5
        - First response > 30 days: -10
        - Close time < 30 days (median): +5
        """
        adjustment = 0.0

        # Response time scoring
        if issues.avg_response_time_hours is not None:
            hours = issues.avg_response_time_hours
            if hours < 48:
                adjustment += 10
            elif hours < 168:  # 7 days
                adjustment += 5
            elif hours > 720:  # 30 days
                adjustment -= 10

        # Close time scoring
        if issues.avg_close_time_hours is not None:
            hours = issues.avg_close_time_hours
            if hours < 720:  # 30 days
                adjustment += 5

        return adjustment

    def _calculate_release_cadence_score(
        self, releases: "ReleaseStats", commits: "CommitActivity"
    ) -> float:
        """Calculate score based on release cadence sweet spot.

        Optimal release frequency:
        - 4-12 releases/year: +10 (sweet spot)
        - 1-3 releases/year: +5 (stable, deliberate)
        - 0 releases but active commits: -5 (no release discipline)
        - >24 releases/year: neutral (may be too frequent)
        """
        releases_year = releases.releases_last_year

        if 4 <= releases_year <= 12:
            return 10  # Sweet spot
        elif 1 <= releases_year <= 3:
            return 5  # Stable, deliberate
        elif releases_year == 0:
            # No releases - check if there's commit activity
            if commits.commits_last_6mo > 0:
                return -5  # Active but no release discipline
            return -10  # Truly inactive
        elif releases_year > 24:
            return 0  # Very frequent - neutral
        else:
            return 0  # 13-24 releases - neutral

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
        - Contributor growth trajectory
        - First-time contributors
        - Good first issues
        - Community health indicators (templates, CoC)
        - Download/install count
        - LLM sentiment assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["community"])

        score = 70.0  # Start at baseline
        repo = github_data.repo
        contributors = github_data.contributors
        issues = github_data.issues
        files = github_data.files

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

        # Contributor growth trajectory
        trend = getattr(contributors, 'contributor_trend', 'stable')
        if trend == "growing":
            score += 10
        elif trend == "declining":
            score -= 15

        # First-time contributors in last 6 months (welcoming community)
        first_time = getattr(contributors, 'first_time_contributors_6mo', 0)
        if first_time >= 5:
            score += 5
        elif first_time >= 1:
            score += 2

        # Good first issues (welcoming to newcomers)
        if issues.good_first_issue_count >= 5:
            score += 5
        elif issues.good_first_issue_count >= 1:
            score += 2

        # Community health indicators
        score += self._calculate_community_health_score(files, repo)

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

    def _calculate_community_health_score(
        self, files: "RepoFiles", repo: "GitHubRepoData"
    ) -> float:
        """Calculate community health indicators bonus.

        Awards points for welcoming community signals:
        - CONTRIBUTING.md with clear process: +5
        - Issue templates configured: +3
        - PR templates configured: +3
        - Code of Conduct present: +3
        - Active discussions/Q&A: +5
        """
        bonus = 0.0

        if files.has_contributing:
            bonus += 5
        if getattr(files, 'has_issue_templates', False):
            bonus += 3
        if getattr(files, 'has_pr_template', False):
            bonus += 3
        if files.has_code_of_conduct:
            bonus += 3
        if repo.has_discussions:
            bonus += 5

        return bonus

    def _calculate_bus_factor_score(
        self,
        github_data: GitHubData | None,
        llm_assessments: LLMAssessments | None,
    ) -> ScoreComponent:
        """Calculate bus factor score (10% weight).

        Factors:
        - Shannon entropy of contributor distribution
        - Top contributor concentration
        - Active contributors
        - Contributor trend
        - Governance files (CODEOWNERS, GOVERNANCE.md)
        - LLM governance assessment
        """
        if not github_data:
            return ScoreComponent(score=50.0, weight=self.WEIGHTS["bus_factor"])

        score = 50.0  # Start at midpoint
        contributors = github_data.contributors
        files = github_data.files

        # Shannon entropy-based bus factor score
        # Higher entropy = better distribution = lower bus factor risk
        entropy = getattr(contributors, 'contributor_entropy', None)
        if entropy is not None:
            # Entropy of 0 = single contributor, 3+ = well distributed
            # Normalize to 0-25 point range
            entropy_score = min(25, entropy * 8)  # ~3 entropy = 24 points
            score += entropy_score
        else:
            # Fall back to contributors_over_5pct method
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

        # Contributor trend affects bus factor
        trend = getattr(contributors, 'contributor_trend', 'stable')
        if trend == "growing":
            score += 5  # Growing contributor base reduces risk
        elif trend == "declining":
            score -= 10  # Declining contributors increases risk

        # Governance files
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
        - CI/CD depth (tests, lint, security, release, multi-platform)
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

        # Test suite presence
        if files.has_tests_dir:
            score += 5

        # CI/CD depth assessment
        ci_depth_score = self._calculate_ci_depth_score(ci)
        score += ci_depth_score

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

    def _calculate_ci_depth_score(self, ci: "CIStatus") -> float:
        """Calculate CI/CD depth score.

        Awards points for CI maturity:
        - Has tests workflow: +5
        - Has lint/format workflow: +3
        - Has security scanning workflow: +5
        - Has release automation: +3
        - Multiple OS/platform testing: +5
        - High pass rate: +5
        """
        if not ci.has_github_actions:
            return -5  # No CI is a negative signal

        score = 5.0  # Base score for having CI

        # CI depth components
        if ci.has_tests_workflow:
            score += 5
        if ci.has_lint_workflow:
            score += 3
        if ci.has_security_workflow:
            score += 5
        if ci.has_release_workflow:
            score += 3
        if ci.has_multi_platform:
            score += 5

        # Pass rate adjustment
        if ci.recent_runs_pass_rate is not None:
            if ci.recent_runs_pass_rate >= 95:
                score += 5
            elif ci.recent_runs_pass_rate < 70:
                score -= 10

        return score


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
