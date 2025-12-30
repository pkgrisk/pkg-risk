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


class ContributorStats(BaseModel):
    """Contributor statistics."""

    total_contributors: int = 0
    active_contributors_6mo: int = 0
    top_contributor_pct: float = 0.0
    contributors_over_5pct: int = 0


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


class CIStatus(BaseModel):
    """CI/CD status."""

    has_github_actions: bool = False
    workflow_count: int = 0
    recent_runs_pass_rate: float | None = None


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


class Scores(BaseModel):
    """All score components."""

    overall: float = Field(ge=0, le=100)
    grade: str  # A, B, C, D, F
    percentile: float | None = None
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

    # Summary analysis
    analysis_summary: dict | None = None

    # Timestamps
    analyzed_at: datetime = Field(default_factory=datetime.utcnow)
    data_fetched_at: datetime | None = None
