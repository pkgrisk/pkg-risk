"""Pydantic models for package data."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Platform(str, Enum):
    """Source code hosting platforms."""

    GITHUB = "github"
    GITLAB = "gitlab"
    BITBUCKET = "bitbucket"
    OTHER = "other"


class Ecosystem(str, Enum):
    """Package ecosystems."""

    HOMEBREW = "homebrew"
    NPM = "npm"
    PYPI = "pypi"
    CRATES = "crates"


class DataAvailability(str, Enum):
    """Data availability status for a package."""

    AVAILABLE = "available"  # Full data available, scores calculated
    NO_REPO = "no_repo"  # No source repository found
    REPO_NOT_FOUND = "repo_not_found"  # Repo URL exists but repo not accessible
    PRIVATE_REPO = "private_repo"  # Repository is private
    NOT_GITHUB = "not_github"  # Repo exists but not on GitHub (GitLab, etc.) - limited data
    PARTIAL_FORGE = "partial_forge"  # Non-GitHub with partial data via deps.dev/aggregators


class RepoRef(BaseModel):
    """Reference to a source code repository."""

    platform: Platform
    owner: str
    repo: str
    subpath: str | None = None

    @property
    def url(self) -> str:
        """Get the full repository URL."""
        base_urls = {
            Platform.GITHUB: "https://github.com",
            Platform.GITLAB: "https://gitlab.com",
            Platform.BITBUCKET: "https://bitbucket.org",
        }
        base = base_urls.get(self.platform, "")
        return f"{base}/{self.owner}/{self.repo}"


class PackageMetadata(BaseModel):
    """Core package metadata from any ecosystem."""

    ecosystem: Ecosystem
    name: str
    description: str = ""
    version: str
    homepage: str | None = None
    repository_url: str | None = None
    license: str | None = None
    keywords: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    # NPM-specific fields
    npm_maintainers: list[str] | None = None
    npm_maintainer_count: int | None = None
    has_types: bool | None = None  # TypeScript types in package.json
    is_scoped: bool | None = None  # @org/package format
    # PyPI-specific fields
    pypi_author: str | None = None
    pypi_author_email: str | None = None
    pypi_requires_python: str | None = None


class InstallStats(BaseModel):
    """Installation/download statistics."""

    downloads_last_30d: int | None = None
    downloads_last_90d: int | None = None
    downloads_last_365d: int | None = None
    dependent_packages: int | None = None


# --- GitHub Data Models ---


class GitHubRepoData(BaseModel):
    """Basic GitHub repository data."""

    owner: str
    name: str
    description: str | None = None
    stars: int = 0
    forks: int = 0
    open_issues: int = 0
    watchers: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    pushed_at: datetime | None = None
    default_branch: str = "main"
    license: str | None = None
    language: str | None = None
    topics: list[str] = Field(default_factory=list)
    is_archived: bool = False
    is_fork: bool = False
    has_discussions: bool = False
    is_deprecated: bool = False  # Detected from README/description


class ContributorStats(BaseModel):
    """Contributor statistics."""

    total_contributors: int = 0
    active_contributors_6mo: int = 0
    top_contributor_pct: float = 0.0
    contributors_over_5pct: int = 0
    # Contributor growth trajectory
    contributors_prev_6mo: int = 0  # Contributors active 6-12 months ago
    contributor_trend: str = "stable"  # growing, stable, declining
    first_time_contributors_6mo: int = 0
    # Bus factor entropy (higher = better distribution)
    contributor_entropy: float | None = None  # Shannon entropy of contributions


class CommitActivity(BaseModel):
    """Commit activity statistics."""

    last_commit_date: datetime | None = None
    commits_last_6mo: int = 0
    commits_last_year: int = 0


class IssueStats(BaseModel):
    """Issue statistics."""

    open_issues: int = 0
    closed_issues_6mo: int = 0
    avg_response_time_hours: float | None = None
    avg_close_time_hours: float | None = None
    good_first_issue_count: int = 0
    regression_issue_count: int = 0


class PRStats(BaseModel):
    """Pull request statistics."""

    open_prs: int = 0
    merged_prs_6mo: int = 0
    closed_prs_6mo: int = 0  # For projects that merge via CLI (merged_at not populated)
    stale_prs: int = 0  # Open > 90 days
    avg_merge_time_hours: float | None = None


class ReleaseStats(BaseModel):
    """Release statistics."""

    total_releases: int = 0
    releases_last_year: int = 0
    last_release_date: datetime | None = None
    latest_version: str | None = None
    has_signed_releases: bool = False
    prerelease_ratio: float = 0.0


class CVEDetail(BaseModel):
    """Individual CVE/vulnerability information."""

    id: str  # CVE-2024-1234 or GHSA-xxxx
    summary: str
    severity: str  # CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN
    cvss_score: float | None = None
    published_date: datetime
    fixed_version: str | None = None
    patch_release_date: datetime | None = None
    days_to_patch: int | None = None  # Calculated: patch_release_date - published_date
    references: list[str] = Field(default_factory=list)


class CVEHistory(BaseModel):
    """CVE history for a package."""

    total_cves: int = 0
    cves: list[CVEDetail] = Field(default_factory=list)
    avg_days_to_patch: float | None = None
    has_unpatched: bool = False


class SecurityData(BaseModel):
    """Security-related data."""

    has_security_md: bool = False
    has_security_policy: bool = False
    signed_commits_pct: float = 0.0
    has_dependabot: bool = False
    has_codeql: bool = False
    has_security_ci: bool = False
    # Expanded security tool detection
    has_snyk: bool = False
    has_renovate: bool = False
    has_trivy: bool = False
    has_semgrep: bool = False
    # Supply chain security signals
    slsa_level: int | None = None  # 1-4, None if not detected
    has_sigstore: bool = False
    has_sbom: bool = False
    has_reproducible_builds: bool = False
    # CVE data
    known_cves: int = 0
    vulnerable_deps: int = 0
    cve_history: CVEHistory | None = None


class RepoFiles(BaseModel):
    """Presence of key repository files."""

    has_readme: bool = False
    readme_size_bytes: int = 0
    has_license: bool = False
    has_changelog: bool = False
    has_contributing: bool = False
    has_code_of_conduct: bool = False
    has_codeowners: bool = False
    has_governance: bool = False
    has_docs_dir: bool = False
    has_examples_dir: bool = False
    has_tests_dir: bool = False
    has_ci_config: bool = False
    # Community health indicators
    has_issue_templates: bool = False
    has_pr_template: bool = False
    has_funding: bool = False  # FUNDING.yml present


class CIStatus(BaseModel):
    """CI/CD status."""

    has_github_actions: bool = False
    workflow_count: int = 0
    recent_runs_pass_rate: float | None = None
    # CI/CD depth assessment fields
    has_tests_workflow: bool = False
    has_lint_workflow: bool = False
    has_security_workflow: bool = False
    has_release_workflow: bool = False
    has_multi_platform: bool = False  # Tests on multiple OS/platforms


class GitHubData(BaseModel):
    """Aggregated GitHub repository data."""

    repo: GitHubRepoData
    contributors: ContributorStats = Field(default_factory=ContributorStats)
    commits: CommitActivity = Field(default_factory=CommitActivity)
    issues: IssueStats = Field(default_factory=IssueStats)
    prs: PRStats = Field(default_factory=PRStats)
    releases: ReleaseStats = Field(default_factory=ReleaseStats)
    security: SecurityData = Field(default_factory=SecurityData)
    files: RepoFiles = Field(default_factory=RepoFiles)
    ci: CIStatus = Field(default_factory=CIStatus)


# --- Scoring Models ---


class ScoreComponent(BaseModel):
    """Individual score component."""

    score: float = Field(ge=0, le=100)
    weight: int  # Percentage weight (e.g., 30 for 30%)


class RiskTier(str, Enum):
    """Risk tier classification for enterprise decision-making."""

    APPROVED = "approved"  # Tier 1: Score ≥80, no unpatched CVEs, active maintenance
    CONDITIONAL = "conditional"  # Tier 2: Score 60-79, or minor concerns
    RESTRICTED = "restricted"  # Tier 3: Score <60, or critical issues
    PROHIBITED = "prohibited"  # Tier 4: Unpatched critical CVEs, abandoned, known malicious


class UpdateUrgency(str, Enum):
    """Update urgency indicator."""

    CRITICAL = "critical"  # Unpatched CVE, update immediately
    HIGH = "high"  # Patched CVE in newer version, update soon
    MEDIUM = "medium"  # Maintenance concerns, plan update
    LOW = "low"  # Current version acceptable, update opportunistically


class Scores(BaseModel):
    """All score components."""

    overall: float = Field(ge=0, le=100)
    grade: str  # A, B, C, D, F
    percentile: float | None = None
    # Enterprise risk indicators
    risk_tier: RiskTier | None = None
    update_urgency: UpdateUrgency | None = None
    # Score confidence based on data completeness
    confidence: str = "high"  # high, medium, low
    confidence_factors: list[str] = Field(default_factory=list)  # Reasons for lower confidence
    # Age-based adjustments
    project_age_band: str | None = None  # new (<1yr), established (1-3yr), mature (3-7yr), legacy (7+yr)
    # Category scores
    security: ScoreComponent
    maintenance: ScoreComponent
    community: ScoreComponent
    bus_factor: ScoreComponent
    documentation: ScoreComponent
    stability: ScoreComponent


# --- LLM Assessment Models ---


class ReadmeAssessment(BaseModel):
    """LLM assessment of README quality."""

    clarity: int = Field(ge=1, le=10)
    installation: int = Field(ge=1, le=10)
    quick_start: int = Field(ge=1, le=10)
    examples: int = Field(ge=1, le=10)
    configuration: int = Field(ge=1, le=10)
    troubleshooting: int = Field(ge=1, le=10)
    overall: int = Field(ge=1, le=10)
    summary: str = ""
    top_issue: str | None = None


class SecurityAssessment(BaseModel):
    """LLM assessment of code security."""

    overall_score: int = Field(ge=1, le=10)
    injection_risks: list[dict] = Field(default_factory=list)
    input_validation_score: int = Field(ge=1, le=10, default=5)
    secrets_found: list[dict] = Field(default_factory=list)
    critical_findings: list[str] = Field(default_factory=list)
    summary: str = ""


class SentimentAssessment(BaseModel):
    """LLM assessment of issue sentiment."""

    sentiment: str  # positive, neutral, negative, mixed
    frustration_level: int = Field(ge=1, le=10)
    maintainer_responsiveness: str  # active, moderate, slow, unresponsive
    common_complaints: list[str] = Field(default_factory=list)
    praise_themes: list[str] = Field(default_factory=list)
    abandonment_signals: bool = False
    summary: str = ""


class CommunicationAssessment(BaseModel):
    """LLM assessment of maintainer communication."""

    helpfulness: int = Field(ge=1, le=10)
    clarity: int = Field(ge=1, le=10)
    patience: int = Field(ge=1, le=10)
    technical_depth: int = Field(ge=1, le=10)
    welcomingness: int = Field(ge=1, le=10)
    communication_style: str  # exemplary, good, adequate, poor, hostile
    red_flags: list[str] = Field(default_factory=list)
    summary: str = ""


class MaintenanceAssessment(BaseModel):
    """LLM assessment of maintenance status."""

    status: str  # actively-maintained, maintained, minimal-maintenance, stale, abandoned
    confidence: int = Field(ge=1, le=10)
    concerns: list[str] = Field(default_factory=list)
    positive_signals: list[str] = Field(default_factory=list)
    summary: str = ""


class ChangelogAssessment(BaseModel):
    """LLM assessment of changelog quality."""

    breaking_changes_marked: bool = False
    has_migration_guides: bool = False
    well_categorized: bool = False
    appears_complete: bool = False
    clarity_score: int = Field(ge=1, le=10, default=5)
    overall_score: int = Field(ge=1, le=10, default=5)
    summary: str = ""


class GovernanceAssessment(BaseModel):
    """LLM assessment of project governance."""

    has_succession_plan: bool = False
    decision_process_documented: bool = False
    contributor_ladder_exists: bool = False
    indicates_multiple_maintainers: bool = False
    bus_factor_risk: str = "unknown"  # low, medium, high
    summary: str = ""


class LLMAssessments(BaseModel):
    """All LLM assessments for a package."""

    readme: ReadmeAssessment | None = None
    security: SecurityAssessment | None = None
    sentiment: SentimentAssessment | None = None
    communication: CommunicationAssessment | None = None
    maintenance: MaintenanceAssessment | None = None
    changelog: ChangelogAssessment | None = None
    governance: GovernanceAssessment | None = None


# --- Supply Chain Security Models ---


class SuspiciousPattern(BaseModel):
    """A detected suspicious pattern in package code."""

    pattern_type: str  # obfuscation, network_call, credential_access, process_spawn, etc.
    severity: str  # critical, high, medium, low
    location: str  # file:line or script name
    matched_content: str  # The actual content that matched
    description: str  # Human-readable explanation


class LifecycleScriptRisk(BaseModel):
    """Analysis of package.json lifecycle scripts (preinstall, postinstall, etc.)."""

    has_preinstall: bool = False
    has_postinstall: bool = False
    has_prepare: bool = False
    has_prepublish: bool = False
    has_install: bool = False

    # Script contents (name -> command)
    scripts: dict[str, str] = Field(default_factory=dict)

    # Detected suspicious patterns
    suspicious_patterns: list[SuspiciousPattern] = Field(default_factory=list)

    # Risk assessment
    risk_score: int = Field(ge=0, le=100, default=0)  # 0 = safe, 100 = extremely risky
    risk_factors: list[str] = Field(default_factory=list)

    # Specific detections
    has_obfuscation: bool = False
    has_network_calls: bool = False
    has_file_system_access: bool = False
    has_process_spawn: bool = False
    has_credential_access: bool = False
    has_env_access: bool = False
    installs_runtime: bool = False  # Bun, Deno, etc.


class TarballFile(BaseModel):
    """A file found in the published tarball."""

    path: str
    size_bytes: int
    is_executable: bool = False
    is_binary: bool = False


class TarballAnalysis(BaseModel):
    """Analysis of the published npm tarball vs repository source."""

    tarball_url: str | None = None
    tarball_size_bytes: int = 0
    file_count: int = 0

    # Files analysis
    files: list[TarballFile] = Field(default_factory=list)

    # Discrepancy detection
    files_not_in_repo: list[str] = Field(default_factory=list)  # Files in tarball but not in repo
    suspicious_files: list[str] = Field(default_factory=list)  # e.g., setup_bun.js

    # Content analysis
    has_native_code: bool = False  # .node, .so, .dll files
    has_minified_js: bool = False
    minified_files: list[str] = Field(default_factory=list)

    # Suspicious patterns found in tarball files
    suspicious_patterns: list[SuspiciousPattern] = Field(default_factory=list)

    # Risk score for tarball-specific issues
    risk_score: int = Field(ge=0, le=100, default=0)


class VersionDiff(BaseModel):
    """Comparison between current and previous version."""

    current_version: str
    previous_version: str | None = None
    comparison_available: bool = False

    # Changes detected
    files_added: list[str] = Field(default_factory=list)
    files_removed: list[str] = Field(default_factory=list)
    files_modified: list[str] = Field(default_factory=list)

    # Specific change types
    scripts_changed: bool = False
    scripts_added: list[str] = Field(default_factory=list)  # New lifecycle scripts
    dependencies_added: list[str] = Field(default_factory=list)
    dependencies_removed: list[str] = Field(default_factory=list)

    # Size changes
    size_change_bytes: int = 0
    size_change_percent: float = 0.0

    # Version jump analysis
    is_major_bump: bool = False
    is_minor_bump: bool = False
    is_patch_bump: bool = False
    version_jump_suspicious: bool = False  # e.g., 1.0.0 -> 10.0.0

    # Time-based anomalies
    days_since_previous: int | None = None
    published_without_repo_commits: bool = False  # Version bumped without corresponding commits

    # Risk assessment
    risk_score: int = Field(ge=0, le=100, default=0)
    risk_factors: list[str] = Field(default_factory=list)


class PublishingInfo(BaseModel):
    """Information about package publishing and maintainer security."""

    # npm provenance (sigstore attestation)
    has_provenance: bool = False
    provenance_verified: bool = False

    # Publisher information
    publisher_username: str | None = None
    publisher_is_listed_maintainer: bool = True

    # Maintainer analysis
    maintainer_count: int = 0
    maintainers: list[str] = Field(default_factory=list)

    # Account changes
    recent_maintainer_change: bool = False  # New maintainer added recently
    new_maintainers: list[str] = Field(default_factory=list)

    # Publishing patterns
    first_publish_by_user: bool = False  # Publisher's first time publishing this package
    publish_frequency_anomaly: bool = False  # Unusual publishing pattern

    # Risk assessment
    risk_score: int = Field(ge=0, le=100, default=0)
    risk_factors: list[str] = Field(default_factory=list)


class SupplyChainData(BaseModel):
    """Aggregated supply chain security analysis."""

    # Component analyses
    lifecycle_scripts: LifecycleScriptRisk = Field(default_factory=LifecycleScriptRisk)
    tarball: TarballAnalysis | None = None
    version_diff: VersionDiff | None = None
    publishing: PublishingInfo = Field(default_factory=PublishingInfo)

    # Overall supply chain risk
    overall_risk_score: int = Field(ge=0, le=100, default=0)
    risk_level: str = "low"  # low, medium, high, critical

    # Summary of all detected issues
    all_suspicious_patterns: list[SuspiciousPattern] = Field(default_factory=list)
    critical_findings: list[str] = Field(default_factory=list)

    # Behavioral heuristics results
    behavioral_flags: list[str] = Field(default_factory=list)


# --- Aggregator Data (deps.dev, OpenSSF Scorecard) ---


class ScorecardData(BaseModel):
    """OpenSSF Scorecard results from deps.dev.

    Scorecard analyzes open source projects for security best practices.
    See: https://securityscorecards.dev/
    """

    overall_score: float = Field(ge=0, le=10)  # 0-10 scale
    score_date: datetime | None = None
    checks: dict[str, float] = Field(default_factory=dict)  # check_name -> score

    # Key security practice scores (convenience fields)
    code_review_score: float | None = None
    maintained_score: float | None = None
    branch_protection_score: float | None = None
    dangerous_workflow_score: float | None = None
    token_permissions_score: float | None = None

    # Boolean flags for important practices
    fuzzing_enabled: bool = False
    sast_enabled: bool = False
    cii_badge: bool = False  # CII Best Practices badge


class DependencyGraphSummary(BaseModel):
    """Summary of dependency graph analysis from deps.dev."""

    direct_count: int = 0
    transitive_count: int = 0
    vulnerable_direct: int = 0
    vulnerable_transitive: int = 0
    max_depth: int = 0

    @property
    def total_count(self) -> int:
        """Total number of dependencies (direct + transitive)."""
        return self.direct_count + self.transitive_count

    @property
    def total_vulnerable(self) -> int:
        """Total number of vulnerable dependencies."""
        return self.vulnerable_direct + self.vulnerable_transitive


class BasicProjectMetrics(BaseModel):
    """Basic project metrics from deps.dev for non-GitHub forges.

    deps.dev provides these metrics for GitLab/Bitbucket projects
    even when Scorecard data is not available.
    """

    stars: int | None = None
    forks: int | None = None
    open_issues: int | None = None
    license: str | None = None
    description: str | None = None
    # OSS-Fuzz coverage (if available)
    oss_fuzz_line_count: int | None = None
    oss_fuzz_line_cover_count: int | None = None


class AggregatorData(BaseModel):
    """Data from third-party aggregator services (deps.dev, etc.).

    This provides cross-forge intelligence for packages on any platform.
    """

    # OpenSSF Scorecard data (GitHub only)
    scorecard: ScorecardData | None = None

    # Basic project metrics (for GitLab/Bitbucket when Scorecard unavailable)
    project_metrics: BasicProjectMetrics | None = None

    # Dependency graph analysis
    dependency_graph: DependencyGraphSummary | None = None

    # SLSA provenance attestations
    slsa_attestation: bool = False
    slsa_level: int | None = None  # 1-4

    # Metadata
    fetched_at: datetime | None = None
    sources_available: list[str] = Field(default_factory=list)

    @property
    def has_project_data(self) -> bool:
        """Check if we have any project-level data (Scorecard or basic metrics)."""
        return self.scorecard is not None or self.project_metrics is not None


# --- Final Package Analysis ---


class PackageAnalysis(BaseModel):
    """Complete analysis of a package."""

    # Core metadata
    ecosystem: Ecosystem
    name: str
    description: str = ""
    version: str
    homepage: str | None = None
    repository: RepoRef | None = None
    install_count_30d: int | None = None

    # Data availability status
    data_availability: DataAvailability = DataAvailability.AVAILABLE
    unavailable_reason: str | None = None

    # Scores (None if data not available)
    scores: Scores | None = None

    # Raw metrics from GitHub
    github_data: GitHubData | None = None

    # LLM assessments
    llm_assessments: LLMAssessments | None = None

    # Supply chain security analysis
    supply_chain: SupplyChainData | None = None

    # Aggregator data (deps.dev, OpenSSF Scorecard)
    aggregator_data: AggregatorData | None = None

    # Summary analysis
    analysis_summary: dict | None = None

    # Timestamps
    analyzed_at: datetime = Field(default_factory=datetime.utcnow)
    data_fetched_at: datetime | None = None
