# Project: pkgrisk — Package Health Risk Dashboard

## Overview

Build a static website hosted on GitHub Pages that displays health/risk scores for software packages. I will run analysis locally on my M2 Ultra Mac Studio (192GB RAM) using local LLMs via Ollama, then publish pre-computed results as a browsable static site.

Users visit the site to check if packages they depend on are well-maintained, have good documentation, active communities, and low bus-factor risk.

**Key Design Principle**: The architecture must be extensible to support multiple package ecosystems. We start with Homebrew, but the system should easily expand to npm, PyPI, crates.io, and others.

## Goals

1. **Extensible Data Collection Pipeline**: Plugin-based scrapers for different package managers
2. **LLM-Powered Analysis**: Use local LLMs to assess qualitative factors that simple metrics can't capture
3. **Unified Scoring System**: Consistent health scores across all package ecosystems
4. **Static Site**: Beautiful, fast, searchable dashboard deployed to GitHub Pages
5. **Automation**: Daily/weekly refresh via cron + git push

## Target Domain Name Ideas
- pkgrisk.dev
- pkghealth.dev
- depscore.dev
- pkgscore.dev

## Extensible Architecture

### Package Manager Adapters

Each package manager gets an "adapter" that normalizes data into a common schema:

```
┌─────────────────────────────────────────────────────────────────┐
│                      ADAPTER INTERFACE                          │
├─────────────────────────────────────────────────────────────────┤
│  class PackageAdapter:                                          │
│    def list_packages() -> List[PackageRef]                      │
│    def get_package_metadata(name) -> PackageMetadata            │
│    def get_install_stats(name) -> InstallStats | None           │
│    def get_source_repo(name) -> RepoRef | None                  │
└─────────────────────────────────────────────────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
     ┌──────────┐         ┌──────────┐         ┌──────────┐
     │ Homebrew │         │   npm    │         │  PyPI    │
     │ Adapter  │         │ Adapter  │         │ Adapter  │
     └──────────┘         └──────────┘         └──────────┘
```

### Common Data Schema

All adapters produce data in this unified format:

```python
@dataclass
class PackageMetadata:
    ecosystem: str           # "homebrew", "npm", "pypi", "crates"
    name: str
    description: str
    version: str
    homepage: str | None
    repository_url: str | None  # GitHub/GitLab/etc URL
    license: str | None
    keywords: list[str]
    dependencies: list[str]
    
@dataclass  
class InstallStats:
    downloads_last_30d: int | None
    downloads_last_90d: int | None
    dependent_packages: int | None  # How many packages depend on this
    
@dataclass
class RepoRef:
    platform: str            # "github", "gitlab", "bitbucket"
    owner: str
    repo: str
    subpath: str | None      # For monorepos
```

## Data Sources by Ecosystem

### Homebrew (Phase 1 - MVP)
- **Package list**: https://formulae.brew.sh/api/formula.json
- **Casks**: https://formulae.brew.sh/api/cask.json
- **Per-formula**: https://formulae.brew.sh/api/formula/{name}.json
- **Analytics**: https://formulae.brew.sh/api/analytics/install/30d.json

### npm (Phase 2)
- **Package metadata**: https://registry.npmjs.org/{package}
- **Download stats**: https://api.npmjs.org/downloads/point/last-month/{package}
- **Search/list**: https://registry.npmjs.org/-/v1/search?text=*&size=250
- **Dependent packages**: via libraries.io API or npm search

### PyPI (Phase 3)
- **Package metadata**: https://pypi.org/pypi/{package}/json
- **Download stats**: https://pypistats.org/api/packages/{package}/recent
- **Package list**: https://pypi.org/simple/ (HTML index)

### crates.io (Future)
- **Package metadata**: https://crates.io/api/v1/crates/{crate}
- **Download stats**: included in metadata
- **Dependencies**: https://crates.io/api/v1/crates/{crate}/dependencies

### Common: GitHub Repository Data
Shared across all ecosystems for packages with GitHub repos:
- GitHub API: repo metadata, stars, forks, open issues, last commit
- GitHub API: contributors list (for bus factor)
- GitHub API: recent commits (velocity)
- GitHub API: README content
- GitHub API: recent issues and their labels/state
- GitHub API: pull requests (open, merged, review status)
- GitHub API: releases (tags, dates, release notes)
- GitHub API: workflow runs (CI status)
- GitHub API: SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
- GitHub API: commit signature verification status
- GitHub API: repository topics/labels

### Security Data Sources
- **OSV Database**: https://api.osv.dev/v1/query - Known vulnerabilities by package
- **GitHub Advisory Database**: Via GitHub API - Security advisories
- **Libraries.io**: https://libraries.io/api - Dependency information, sourcerank

## Health Score Components

Design a 0-100 composite score with these weighted components (consistent across ecosystems):

### 1. Security Score (30%)

**Quantitative metrics** (via public APIs):
| Metric | Description | Data Source |
|--------|-------------|-------------|
| Known CVEs | Count of known vulnerabilities | OSV API, GitHub Advisory DB |
| CVE response time | Historical time-to-patch for past vulnerabilities | CVE dates vs release dates |
| Dependency depth | Max depth of transitive dependency tree | Package manifest + recursive lookup |
| Vulnerable dependencies | Count of deps with known issues | OSV API recursive check |
| SECURITY.md presence | Has security disclosure policy | GitHub API |
| Signed commits % | Percentage of commits that are GPG signed | GitHub API (commit verification) |
| Signed releases | Releases have verified signatures | GitHub Releases API |
| Lock file presence | Has package-lock.json, poetry.lock, etc. | GitHub API (file exists) |
| Dependency freshness | % of dependencies on latest major version | Compare manifest to registry APIs |
| Pinned dependencies | % of deps with exact versions vs ranges | Manifest parsing |
| Security CI presence | Uses Dependabot, CodeQL, Snyk, etc. | GitHub API (workflow files, Dependabot config) |

**LLM-assessed**:
| Analysis | Description |
|----------|-------------|
| Security policy quality | Assess SECURITY.md for clarity, response timeline, scope, disclosure process |
| Dangerous code patterns | Scan source for eval(), exec(), shell injection, SQL concatenation, hardcoded secrets |
| Input validation practices | Assess whether external inputs are validated at boundaries |
| Error information leakage | Check if errors expose stack traces, file paths, or internal details |

### 2. Maintenance Score (25%)

**Quantitative metrics**:
| Metric | Description | Data Source |
|--------|-------------|-------------|
| Days since last commit | Staleness indicator (decay curve) | GitHub API |
| Commit frequency (6mo) | Average commits per month | GitHub API |
| Issue response time | Median time to first maintainer response | GitHub API (issue comments) |
| Issue close rate | % of issues closed in past 6 months | GitHub API |
| Release frequency | Releases per year | GitHub Releases API |
| PR merge time | Median time from PR open to merge | GitHub API |
| Stale PR count | PRs open >90 days without activity | GitHub API |
| CI pass rate | % of recent workflow runs that passed | GitHub Actions API |
| Issue backlog trend | Is open issue count growing or shrinking? | GitHub API (issue timestamps) |
| Label usage | Uses labels for triage (bug, enhancement, etc.) | GitHub API |

**LLM-assessed**:
| Analysis | Description |
|----------|-------------|
| Commit message quality | Are messages descriptive? Follow conventions? |
| Release notes quality | Do release notes explain changes clearly? Document breaking changes? |
| Maintainer communication | Assess maintainer responses in issues/PRs for helpfulness and clarity |

### 3. Community Health Score (15%)

**Quantitative metrics**:
| Metric | Description | Data Source |
|--------|-------------|-------------|
| Star count (age-normalized) | Stars relative to repo age | GitHub API |
| Star velocity | Star growth rate over past 6 months | GitHub API (or star history services) |
| Fork to star ratio | Engagement indicator | GitHub API |
| GitHub Discussions activity | Posts/comments in past 90 days | GitHub API |
| First-time contributors (6mo) | New contributors in past 6 months | GitHub API (contributor stats) |
| First-PR response time | Time to first review/comment on new contributor PRs | GitHub API |
| "Good first issue" count | Labeled onboarding issues | GitHub API |
| Contributor retention | % of contributors with >1 contribution | GitHub API |
| Dependent package count | How many packages depend on this | Libraries.io API |
| Download trend | Downloads trending up or down | Ecosystem-specific APIs |

**LLM-assessed**:
| Analysis | Description |
|----------|-------------|
| Issue sentiment | Overall tone of recent issues (frustrated vs satisfied users) |
| Maintainer tone | Are maintainer responses welcoming or dismissive? |
| Code of Conduct quality | Is CODE_OF_CONDUCT.md meaningful or boilerplate? |

### 4. Bus Factor Score (10%)

**Quantitative metrics**:
| Metric | Description | Data Source |
|--------|-------------|-------------|
| Contributors >5% commits | Number of significant contributors | GitHub API |
| Top contributor % | Percentage of commits by #1 contributor | GitHub API |
| Active contributors (6mo) | Contributors with commits in past 6 months | GitHub API |
| Org vs personal repo | Is this backed by an organization? | GitHub API |
| CODEOWNERS breadth | Number of distinct owners in CODEOWNERS | GitHub API |
| Contributor timezone spread | Standard deviation of commit hours (UTC) | GitHub API (commit timestamps) |

**LLM-assessed**:
| Analysis | Description |
|----------|-------------|
| Governance documentation | Assess GOVERNANCE.md for succession planning, decision-making process |
| Knowledge transfer | Do maintainers explain decisions in issues/PRs for posterity? |
| Contributor onboarding | Does CONTRIBUTING.md provide clear onboarding path? |

### 5. Documentation Score (10%)

**Quantitative metrics**:
| Metric | Description | Data Source |
|--------|-------------|-------------|
| README size | Basic presence check (too short = poor) | GitHub API |
| Docs directory exists | Has /docs, /documentation, or similar | GitHub API |
| Examples directory | Has /examples or /samples | GitHub API |
| CHANGELOG presence | Has CHANGELOG.md or similar | GitHub API |
| External docs site | Links to ReadTheDocs, GitBook, etc. | README parsing |
| README last updated | Days since README was modified | GitHub API (file commits) |

**LLM-assessed**:
| Analysis | Description |
|----------|-------------|
| README clarity | Can a new user understand what this does in 30 seconds? |
| Installation completeness | Are install instructions clear and complete? |
| Quick start quality | Is there a working quick example? |
| Example coverage | Are common use cases demonstrated? |
| Configuration docs | If configurable, is configuration explained? |
| Troubleshooting presence | Are common problems and solutions documented? |

### 6. Stability Score (10%)

**Quantitative metrics**:
| Metric | Description | Data Source |
|--------|-------------|-------------|
| Version >= 1.0 | Has reached stable version | Package registry |
| Major version churn | Major versions per year (lower = more stable) | Release history |
| Pre-release ratio | % of releases that are alpha/beta/rc | GitHub Releases API |
| Test directory exists | Has /test, /tests, /__tests__, /spec | GitHub API |
| CI config present | Has workflow files, .travis.yml, etc. | GitHub API |
| Platform compatibility | Number of supported platforms/runtimes | Package metadata, CI matrix |
| Issues labeled "regression" | Count of regression bugs | GitHub API |

**LLM-assessed**:
| Analysis | Description |
|----------|-------------|
| Changelog quality | Are breaking changes clearly marked? Are migration paths provided? |
| Deprecation handling | Does project give advance warning and alternatives for deprecations? |
| Stability commitment | Does README/docs communicate stability guarantees? |

## LLM Analysis Tasks

For each package with a source repository, run these LLM prompts:

### 1. README Quality Assessment
```
Analyze this README for a software package. Score each dimension 1-10:

1. CLARITY: Can a new user understand what this package does within 30 seconds?
2. INSTALLATION: Are installation instructions clear and complete?
3. QUICK_START: Is there a quick example showing basic usage?
4. EXAMPLES: Are there enough examples for common use cases?
5. CONFIGURATION: If configurable, is configuration documented?
6. TROUBLESHOOTING: Are common problems and solutions documented?

Package ecosystem: {ecosystem}
Package name: {package_name}
README content:
{readme_content}

Respond in JSON:
{
  "clarity": <1-10>,
  "installation": <1-10>,
  "quick_start": <1-10>,
  "examples": <1-10>,
  "configuration": <1-10>,
  "troubleshooting": <1-10>,
  "overall": <1-10>,
  "summary": "<one sentence summary of doc quality>",
  "top_issue": "<biggest documentation problem, or null if none>"
}
```

### 2. Security Code Review
```
Analyze this code sample for security concerns. This is from the {ecosystem} package "{package_name}".

Focus on:
1. INJECTION_RISKS: eval(), exec(), shell commands with user input, SQL string concatenation, template injection
2. INPUT_VALIDATION: Are external inputs validated/sanitized before use?
3. SECRETS_HANDLING: Hardcoded credentials, API keys, tokens, passwords?
4. ERROR_EXPOSURE: Do error handlers expose stack traces, file paths, or internal details?
5. DANGEROUS_DEFAULTS: Insecure default configurations (e.g., disabled SSL verification)?

Code files:
{code_samples}

Respond in JSON:
{
  "injection_risks": [{"file": "...", "line": <n>, "severity": "high|medium|low", "description": "..."}],
  "input_validation_score": <1-10>,
  "input_validation_issues": ["..."],
  "secrets_found": [{"file": "...", "line": <n>, "type": "..."}],
  "error_exposure_score": <1-10>,
  "dangerous_defaults": ["..."],
  "overall_security_score": <1-10>,
  "critical_findings": ["..."],
  "summary": "<one sentence security assessment>"
}
```

### 3. Security Policy Assessment
```
Analyze this security policy (SECURITY.md) for the {ecosystem} package "{package_name}".

Assess:
1. DISCLOSURE_PROCESS: Is there a clear way to report vulnerabilities?
2. RESPONSE_TIMELINE: Does it specify expected response time?
3. SCOPE: Is it clear what is/isn't in scope?
4. CONTACT: Is there a security contact (email, HackerOne, etc.)?
5. HISTORY: Does it mention past security issues and how they were handled?

SECURITY.md content:
{security_md_content}

Respond in JSON:
{
  "has_disclosure_process": <true|false>,
  "has_response_timeline": <true|false>,
  "response_timeline_days": <number or null>,
  "has_clear_scope": <true|false>,
  "has_contact": <true|false>,
  "contact_method": "<email|hackerone|github|other|none>",
  "mentions_history": <true|false>,
  "overall_score": <1-10>,
  "summary": "<one sentence assessment>"
}
```

### 4. Issue Sentiment Analysis
```
Analyze these recent GitHub issues for a software project. Assess overall community health.

Package: {package_name} ({ecosystem})
Issues:
{issues_json}

Respond in JSON:
{
  "sentiment": "<positive|neutral|negative|mixed>",
  "frustration_level": <1-10>,
  "maintainer_responsiveness": "<active|moderate|slow|unresponsive>",
  "common_complaints": ["<issue1>", "<issue2>"],
  "praise_themes": ["<theme1>", "<theme2>"],
  "abandonment_signals": <true|false>,
  "summary": "<one sentence community health summary>"
}
```

### 5. Maintainer Communication Assessment
```
Analyze these maintainer responses in GitHub issues and pull requests.

Package: {package_name} ({ecosystem})
Maintainer comments:
{maintainer_comments}

Assess:
1. HELPFULNESS: Do responses actually help resolve issues?
2. CLARITY: Are explanations clear to users of varying skill levels?
3. PATIENCE: How are repeated or basic questions handled?
4. TECHNICAL_DEPTH: Do they explain the "why" behind decisions?
5. WELCOMINGNESS: Are new contributors encouraged?

Respond in JSON:
{
  "helpfulness": <1-10>,
  "clarity": <1-10>,
  "patience": <1-10>,
  "technical_depth": <1-10>,
  "welcomingness": <1-10>,
  "communication_style": "<exemplary|good|adequate|poor|hostile>",
  "red_flags": ["..."],
  "summary": "<one sentence assessment>"
}
```

### 6. Maintenance Status Assessment
```
Based on this GitHub activity data, assess the maintenance status:

Package: {package_name} ({ecosystem})
Last commit: {last_commit_date}
Commits past 6 months: {commit_count}
Open issues: {open_issues}
Closed issues past 6 months: {closed_issues}
Open PRs: {open_prs}
Merged PRs past 6 months: {merged_prs}
Last release: {last_release_date}
Contributors active past 6 months: {active_contributors}

Respond in JSON:
{
  "status": "<actively-maintained|maintained|minimal-maintenance|stale|abandoned>",
  "confidence": <1-10>,
  "concerns": ["<concern1>", "<concern2>"],
  "positive_signals": ["<signal1>", "<signal2>"],
  "summary": "<one sentence maintenance assessment>"
}
```

### 7. Changelog Quality Assessment
```
Analyze this changelog for the {ecosystem} package "{package_name}".

Assess:
1. BREAKING_CHANGES: Are breaking changes clearly marked?
2. MIGRATION_GUIDES: Are upgrade paths explained?
3. CATEGORIZATION: Are changes grouped (features, fixes, etc.)?
4. COMPLETENESS: Does it appear comprehensive?
5. CLARITY: Is it understandable to users?

CHANGELOG content (most recent entries):
{changelog_content}

Respond in JSON:
{
  "breaking_changes_marked": <true|false>,
  "has_migration_guides": <true|false>,
  "well_categorized": <true|false>,
  "appears_complete": <true|false>,
  "clarity_score": <1-10>,
  "overall_score": <1-10>,
  "summary": "<one sentence assessment>"
}
```

### 8. Governance Assessment
```
Analyze the governance documentation for the {ecosystem} package "{package_name}".

Documents provided:
{governance_docs}

Assess:
1. SUCCESSION: Is there a plan if primary maintainer leaves?
2. DECISION_MAKING: Is the decision process documented?
3. CONTRIBUTOR_PATH: Is there a path from contributor to maintainer?
4. MULTIPLE_MAINTAINERS: Does it indicate multiple people with merge rights?

Respond in JSON:
{
  "has_succession_plan": <true|false>,
  "decision_process_documented": <true|false>,
  "contributor_ladder_exists": <true|false>,
  "indicates_multiple_maintainers": <true|false>,
  "bus_factor_risk": "<low|medium|high>",
  "summary": "<one sentence assessment>"
}
```

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LOCAL (M2 Ultra)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    ADAPTERS LAYER                            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │   │
│  │  │ Homebrew │  │   npm    │  │  PyPI    │  │  crates  │    │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │   │
│  └───────┼─────────────┼─────────────┼─────────────┼───────────┘   │
│          └─────────────┴──────┬──────┴─────────────┘               │
│                               ▼                                     │
│                    ┌─────────────────────┐                         │
│                    │  Unified Raw Data   │                         │
│                    │   (common schema)   │                         │
│                    └──────────┬──────────┘                         │
│                               ▼                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│  │   GitHub    │───►│  Analyzer   │───►│  Generator  │            │
│  │   Fetcher   │    │(Python+LLM) │    │   (Vite)    │            │
│  └─────────────┘    └─────────────┘    └─────────────┘            │
│                            │                   │                    │
│                            ▼                   ▼                    │
│                     ┌───────────┐      ┌────────────┐              │
│                     │ analyzed/ │      │   dist/    │              │
│                     │  *.json   │      │  (static)  │              │
│                     └───────────┘      └────────────┘              │
│                                              │                      │
└──────────────────────────────────────────────│──────────────────────┘
                                               │
                                          git push
                                               │
                                               ▼
                                    ┌─────────────────┐
                                    │  GitHub Pages   │
                                    │   pkgrisk.dev   │
                                    └─────────────────┘
```

## Directory Structure

```
pkgrisk/
├── README.md
├── pyproject.toml                 # Python project config
├── src/
│   └── pkgrisk/
│       ├── __init__.py
│       ├── adapters/              # Package manager adapters
│       │   ├── __init__.py
│       │   ├── base.py            # Abstract base adapter
│       │   ├── homebrew.py
│       │   ├── npm.py             # Phase 2
│       │   └── pypi.py            # Phase 3
│       ├── analyzers/
│       │   ├── __init__.py
│       │   ├── github.py          # GitHub data fetcher
│       │   ├── llm.py             # LLM analysis runner
│       │   └── scorer.py          # Score calculator
│       ├── models/
│       │   ├── __init__.py
│       │   └── schemas.py         # Pydantic models for all data
│       └── cli.py                 # CLI entry point
├── scripts/
│   ├── run_pipeline.sh            # Run full pipeline
│   └── run_ecosystem.sh           # Run single ecosystem
├── data/
│   ├── raw/
│   │   ├── homebrew/
│   │   │   ├── formulas.json
│   │   │   └── github/
│   │   │       └── {package_name}.json
│   │   ├── npm/                   # Phase 2
│   │   └── pypi/                  # Phase 3
│   ├── analyzed/
│   │   ├── homebrew/
│   │   │   └── {package_name}.json
│   │   ├── npm/
│   │   └── pypi/
│   └── final/
│       ├── homebrew.json          # All homebrew packages
│       ├── npm.json               # All npm packages
│       ├── pypi.json              # All pypi packages
│       ├── all_packages.json      # Combined (for cross-ecosystem search)
│       ├── stats.json             # Aggregate statistics per ecosystem
│       └── updated_at.json        # Last update timestamps
├── site/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── PackageList.jsx
│   │   │   ├── PackageCard.jsx
│   │   │   ├── ScoreBreakdown.jsx
│   │   │   ├── SearchFilter.jsx
│   │   │   ├── EcosystemPicker.jsx   # Switch between ecosystems
│   │   │   └── StatsOverview.jsx
│   │   └── styles/
│   │       └── main.css
│   └── public/
│       └── data/                  # Symlink or copy from data/final/
└── .github/
    └── workflows/
        └── deploy.yml             # GitHub Actions for Pages deployment
```

## Implementation Phases

### Phase 1: Homebrew MVP
1. Build abstract adapter interface (`adapters/base.py`)
2. Implement Homebrew adapter
3. Build GitHub data fetcher (shared across ecosystems)
4. Implement LLM analysis pipeline
5. Build scoring system
6. Create React frontend with ecosystem picker (defaulting to Homebrew)
7. Deploy to GitHub Pages

### Phase 2: npm Support
1. Implement npm adapter
2. Add npm-specific metrics (weekly downloads, dependent count)
3. Handle npm-specific quirks (scoped packages, monorepos)
4. Extend frontend to show npm packages
5. Add cross-ecosystem comparison features

### Phase 3: PyPI Support
1. Implement PyPI adapter
2. Add PyPI-specific metrics
3. Extend frontend

### Phase 4: Additional Ecosystems
- crates.io (Rust)
- Go modules
- Maven/Gradle (Java)
- NuGet (.NET)

## Key Technical Decisions

1. **LLM Model Choice**: Balance between quality and speed
   - Fast option: llama3.1:8b (~30 tok/s on M2 Ultra)
   - Quality option: llama3.1:70b-q4 (~5 tok/s but much better reasoning)
   - Recommendation: Use 70b for analysis, 8b for simple classification

2. **Scope for MVP**: 
   - Homebrew: Top 500 most-installed formulas
   - npm: Top 1000 by weekly downloads (Phase 2)
   - PyPI: Top 1000 by downloads (Phase 3)

3. **Update Frequency**: Weekly full refresh, daily delta for changed repos

4. **GitHub Token**: Need a personal access token for API rate limits

5. **Frontend Framework**: React + Vite for rich interactivity

6. **Python Version**: 3.11+ for modern typing features

## Sample Package Output Schema

```json
{
  "ecosystem": "homebrew",
  "name": "ripgrep",
  "description": "Search tool like grep and The Silver Searcher",
  "version": "14.1.0",
  "homepage": "https://github.com/BurntSushi/ripgrep",
  "repository": {
    "platform": "github",
    "owner": "BurntSushi",
    "repo": "ripgrep"
  },
  "install_count_30d": 245000,

  "scores": {
    "overall": 91,
    "grade": "A",
    "percentile": 96,
    "components": {
      "security": { "score": 95, "weight": 30 },
      "maintenance": { "score": 96, "weight": 25 },
      "community": { "score": 92, "weight": 15 },
      "bus_factor": { "score": 68, "weight": 10 },
      "documentation": { "score": 94, "weight": 10 },
      "stability": { "score": 90, "weight": 10 }
    }
  },

  "analysis": {
    "maintenance_status": "actively-maintained",
    "maintenance_confidence": 9,
    "security_summary": "No known CVEs, signed releases, has SECURITY.md with clear disclosure process",
    "security_concerns": [],
    "doc_summary": "Excellent documentation with clear examples and comprehensive options reference",
    "doc_top_issue": null,
    "community_sentiment": "positive",
    "maintainer_communication": "exemplary",
    "governance_risk": "medium",
    "concerns": ["Single primary maintainer (78% of commits)"],
    "highlights": ["Very responsive to issues", "Regular releases", "Strong security posture", "Active community"]
  },

  "metrics": {
    "security": {
      "known_cves": 0,
      "vulnerable_deps": 0,
      "has_security_md": true,
      "signed_commits_pct": 100,
      "signed_releases": true,
      "has_security_ci": true,
      "dependency_depth": 3
    },
    "maintenance": {
      "last_commit_days_ago": 3,
      "commits_6mo": 47,
      "issue_response_time_hours": 12,
      "issue_close_rate_pct": 78,
      "releases_per_year": 8,
      "pr_merge_time_hours": 48,
      "stale_prs": 2,
      "ci_pass_rate_pct": 98
    },
    "community": {
      "stars": 42000,
      "stars_per_month": 450,
      "forks": 1850,
      "dependent_packages": 3420,
      "first_time_contributors_6mo": 12,
      "good_first_issues": 5
    },
    "bus_factor": {
      "contributors_total": 312,
      "contributors_active_6mo": 8,
      "top_contributor_pct": 78,
      "contributors_over_5pct": 2,
      "is_org_repo": false
    },
    "documentation": {
      "readme_bytes": 15420,
      "has_docs_dir": true,
      "has_examples": true,
      "has_changelog": true
    },
    "stability": {
      "version_major": 14,
      "is_stable": true,
      "major_releases_per_year": 1.2,
      "has_tests": true,
      "has_ci": true,
      "regression_issues": 2
    }
  },

  "llm_assessments": {
    "readme_quality": {
      "clarity": 9,
      "installation": 10,
      "quick_start": 9,
      "examples": 8,
      "configuration": 9,
      "troubleshooting": 7,
      "overall": 9
    },
    "security_review": {
      "overall_score": 9,
      "injection_risks": [],
      "critical_findings": []
    },
    "issue_sentiment": {
      "sentiment": "positive",
      "frustration_level": 2,
      "maintainer_responsiveness": "active"
    },
    "maintainer_communication": {
      "helpfulness": 9,
      "clarity": 9,
      "patience": 8,
      "communication_style": "exemplary"
    },
    "changelog_quality": {
      "breaking_changes_marked": true,
      "has_migration_guides": true,
      "overall_score": 9
    }
  },

  "updated_at": "2024-12-29T10:00:00Z"
}
```

## Adapter Implementation Guide

When adding a new ecosystem, implement these methods:

```python
from abc import ABC, abstractmethod
from pkgrisk.models.schemas import PackageMetadata, InstallStats, RepoRef

class BaseAdapter(ABC):
    """Base class for package manager adapters."""
    
    @property
    @abstractmethod
    def ecosystem_name(self) -> str:
        """Return ecosystem identifier (e.g., 'homebrew', 'npm')."""
        pass
    
    @abstractmethod
    async def list_packages(self, limit: int | None = None) -> list[str]:
        """Return list of package names to analyze."""
        pass
    
    @abstractmethod
    async def get_package_metadata(self, name: str) -> PackageMetadata:
        """Fetch metadata for a single package."""
        pass
    
    @abstractmethod
    async def get_install_stats(self, name: str) -> InstallStats | None:
        """Fetch install/download statistics. Returns None if unavailable."""
        pass
    
    def get_source_repo(self, metadata: PackageMetadata) -> RepoRef | None:
        """Extract source repository reference from metadata.
        
        Default implementation parses common URL patterns.
        Override for ecosystem-specific logic.
        """
        return parse_repo_url(metadata.repository_url or metadata.homepage)
```

## Questions to Resolve During Implementation

1. How to handle packages without source repos? (Assign partial scores, mark as "limited data")
2. How to handle monorepos? (e.g., Babel packages in npm)
3. How to normalize scores across ecosystems with different metrics?
4. How to handle packages that are intentionally "done"? (stable, no commits needed)
5. What's the minimum data threshold to show a score?
6. How to handle namespaced packages? (@org/pkg in npm, org.group:artifact in Maven)

## Success Metrics

- [ ] Analyze top 500 Homebrew formulas (Phase 1)
- [ ] Analyze top 1000 npm packages (Phase 2)
- [ ] < 30 second page load for full package list per ecosystem
- [ ] Search/filter response < 100ms
- [ ] Each package detail page loads in < 500ms
- [ ] Lighthouse score > 90
- [ ] Works fully offline after initial load
- [ ] Easy to add new ecosystem in < 1 day of work

## Let's Start

Begin with Phase 1: Create the core infrastructure and Homebrew adapter.

1. Set up Python project structure with `pyproject.toml`
2. Create `adapters/base.py` with abstract base class
3. Create `models/schemas.py` with Pydantic models
4. Implement `adapters/homebrew.py`
5. Test by fetching and printing top 10 Homebrew formulas

Then we'll iterate from there.
