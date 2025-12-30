# pkgrisk

Package health and risk scoring dashboard. Analyzes software packages from multiple ecosystems (Homebrew, npm, PyPI) and provides health/risk scores based on maintenance, security, community, and other factors.

## Features

- **Multi-ecosystem support**: Analyze packages from Homebrew, npm, PyPI, and more
- **Comprehensive scoring**: 0-100 health score based on 6 weighted components
- **LLM-powered analysis**: Uses local LLMs (Ollama) for qualitative assessments
- **Static site deployment**: Pre-computed results published to GitHub Pages

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Usage

```bash
# List top packages from an ecosystem
pkgrisk list-packages homebrew --limit 10

# Fetch data for a specific package
pkgrisk fetch ripgrep --github

# Get GitHub repository info directly
pkgrisk github-info BurntSushi ripgrep
```

## Configuration

Set `GITHUB_TOKEN` environment variable for GitHub API access:

```bash
export GITHUB_TOKEN=your_token_here
```

Or create a `.env` file in the project root.

## Scoring Components

| Component | Weight | Description |
|-----------|--------|-------------|
| Security | 30% | CVEs, dependency vulnerabilities, security policies |
| Maintenance | 25% | Commit activity, issue response, release frequency |
| Community | 15% | Stars, contributors, community engagement |
| Bus Factor | 10% | Contributor concentration, governance |
| Documentation | 10% | README quality, examples, docs presence |
| Stability | 10% | Version maturity, test coverage, CI status |

## License

MIT
