export type Ecosystem = 'homebrew' | 'npm' | 'pypi';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type DataAvailability = 'available' | 'no_repo' | 'repo_not_found' | 'private_repo' | 'not_github';
export type RiskTier = 'approved' | 'conditional' | 'restricted' | 'prohibited';
export type UpdateUrgency = 'critical' | 'high' | 'medium' | 'low';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ProjectAgeBand = 'new' | 'established' | 'mature' | 'legacy';

export interface ScoreComponent {
  score: number;
  weight: number;
}

export interface Scores {
  overall: number;
  grade: Grade;
  percentile: number | null;
  // Enterprise risk indicators
  risk_tier: RiskTier | null;
  update_urgency: UpdateUrgency | null;
  // Confidence and context
  confidence: ConfidenceLevel | null;
  confidence_factors: string[] | null;
  project_age_band: ProjectAgeBand | null;
  // Score components
  security: ScoreComponent;
  maintenance: ScoreComponent;
  community: ScoreComponent;
  bus_factor: ScoreComponent;
  documentation: ScoreComponent;
  stability: ScoreComponent;
}

export interface Repository {
  platform: string;
  owner: string;
  repo: string;
  subpath: string | null;
}

export interface GitHubRepo {
  owner: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  open_issues: number;
  watchers: number;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  default_branch: string;
  license: string | null;
  language: string | null;
  topics: string[];
  is_archived: boolean;
  is_fork: boolean;
  has_discussions: boolean;
}

export interface Contributors {
  total_contributors: number;
  active_contributors_6mo: number;
  top_contributor_pct: number;
  contributors_over_5pct: number;
}

export interface Commits {
  last_commit_date: string;
  commits_last_6mo: number;
  commits_last_year: number;
}

export interface Issues {
  open_issues: number;
  closed_issues_6mo: number;
  avg_response_time_hours: number | null;
  avg_close_time_hours: number | null;
  good_first_issue_count: number;
  regression_issue_count: number;
}

export interface PRs {
  open_prs: number;
  merged_prs_6mo: number;
  stale_prs: number;
  avg_merge_time_hours: number | null;
}

export interface Releases {
  total_releases: number;
  releases_last_year: number;
  last_release_date: string | null;
  latest_version: string | null;
  has_signed_releases: boolean;
  prerelease_ratio: number;
}

export type CVESeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface CVEDetail {
  id: string;
  summary: string;
  severity: CVESeverity;
  cvss_score: number | null;
  published_date: string;
  fixed_version: string | null;
  patch_release_date: string | null;
  days_to_patch: number | null;
  references: string[];
}

export interface CVEHistory {
  total_cves: number;
  cves: CVEDetail[];
  avg_days_to_patch: number | null;
  has_unpatched: boolean;
}

export interface Security {
  has_security_md: boolean;
  has_security_policy: boolean;
  signed_commits_pct: number;
  has_dependabot: boolean;
  has_codeql: boolean;
  has_security_ci: boolean;
  known_cves: number;
  vulnerable_deps: number;
  cve_history: CVEHistory | null;
}

export interface Files {
  has_readme: boolean;
  readme_size_bytes: number;
  has_license: boolean;
  has_changelog: boolean;
  has_contributing: boolean;
  has_code_of_conduct: boolean;
  has_codeowners: boolean;
  has_governance: boolean;
  has_docs_dir: boolean;
  has_examples_dir: boolean;
  has_tests_dir: boolean;
  has_ci_config: boolean;
}

export interface CI {
  has_github_actions: boolean;
  workflow_count: number;
  recent_runs_pass_rate: number | null;
}

export interface GitHubData {
  repo: GitHubRepo;
  contributors: Contributors;
  commits: Commits;
  issues: Issues;
  prs: PRs;
  releases: Releases;
  security: Security;
  files: Files;
  ci: CI;
}

export interface ReadmeAssessment {
  clarity: number;
  installation: number;
  quick_start: number;
  examples: number;
  configuration: number;
  troubleshooting: number;
  overall: number;
  summary: string;
  top_issue: string | null;
}

export interface SentimentAssessment {
  sentiment: string;
  frustration_level: number;
  maintainer_responsiveness: string;
  common_complaints: string[];
  praise_themes: string[];
  abandonment_signals: boolean;
  summary: string;
}

export interface MaintenanceAssessment {
  status: string;
  confidence: number;
  concerns: string[];
  positive_signals: string[];
  summary: string;
}

export interface LLMAssessments {
  readme: ReadmeAssessment | null;
  security: unknown | null;
  sentiment: SentimentAssessment | null;
  communication: unknown | null;
  maintenance: MaintenanceAssessment | null;
  changelog: unknown | null;
  governance: unknown | null;
}

export interface AnalysisSummary {
  maintenance_status: string;
  security_summary: string;
  doc_summary: string;
  concerns: string[];
  highlights: string[];
  community_sentiment?: string;
}

export interface PackageAnalysis {
  ecosystem: Ecosystem;
  name: string;
  description: string;
  version: string;
  homepage: string | null;
  repository: Repository | null;
  install_count_30d: number | null;
  data_availability: DataAvailability;
  unavailable_reason: string | null;
  scores: Scores | null;
  github_data: GitHubData | null;
  llm_assessments: LLMAssessments | null;
  analysis_summary: AnalysisSummary | null;
  analyzed_at: string;
  data_fetched_at: string;
}

export interface PackageSummary {
  name: string;
  version: string;
  description: string;
  install_count_30d: number | null;
  data_availability: DataAvailability;
  unavailable_reason: string | null;
  scores: Scores | null;
  analysis_summary: AnalysisSummary | null;
  repository: Repository | null;
  analyzed_at: string | null;
  // Risk indicators for dashboard
  last_commit_date: string | null;
  cve_count: number;
  has_unpatched_cves: boolean;
  top_contributor_pct: number | null;
  has_security_policy: boolean;
  has_security_tools: boolean;
  // Statistical fields
  risk_tier: RiskTier | null;
  update_urgency: UpdateUrgency | null;
  confidence: ConfidenceLevel | null;
  project_age_band: ProjectAgeBand | null;
}

// Ecosystem-level statistics
export interface ScoreDistribution {
  min: number;
  max: number;
  median: number;
  p25: number;
  p75: number;
}

export interface GradeDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

export interface EcosystemStats {
  total_packages: number;
  scored_packages: number;
  unavailable_packages: number;
  score_distribution: ScoreDistribution;
  grade_distribution: GradeDistribution;
  risk_tier_distribution: Record<RiskTier, number>;
}
