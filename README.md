# pkgrisk

Package health and risk scoring dashboard. Analyzes software packages from multiple ecosystems (Homebrew, npm, PyPI) and provides health/risk scores based on maintenance, security, community, and other factors.

## Features

- **Multi-ecosystem support**: Analyze packages from Homebrew (npm, PyPI coming soon)
- **Comprehensive scoring**: 0-100 health score based on 6 weighted components
- **LLM-powered analysis**: Uses local LLMs (Ollama) for qualitative assessments
- **Static site deployment**: Pre-computed results published to GitHub Pages
- **React dashboard**: Modern, responsive frontend for browsing package scores

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## CLI Usage

```bash
# Analyze a specific package
pkgrisk analyze ripgrep

# Analyze with LLM (requires Ollama running locally)
pkgrisk analyze bat --model deepseek-r1:70b

# Batch analyze top packages from an ecosystem
pkgrisk analyze-batch --limit 50 --skip-llm

# List top packages from an ecosystem
pkgrisk list-packages homebrew --limit 10

# Fetch raw data for a package
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

## Frontend Development

```bash
# Install frontend dependencies
cd frontend
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

To populate the frontend with package data:

```bash
# Generate package analysis data
pkgrisk analyze-batch --limit 100 --skip-llm

# Build frontend data files
python scripts/build_frontend_data.py
```

## Scoring Components

| Component | Weight | Description |
|-----------|--------|-------------|
| Security | 30% | CVEs, dependency vulnerabilities, security policies |
| Maintenance | 25% | Commit activity, issue response, release frequency |
| Community | 15% | Stars, contributors, community engagement |
| Bus Factor | 10% | Contributor concentration, governance |
| Documentation | 10% | README quality, examples, docs presence |
| Stability | 10% | Version maturity, test coverage, CI status |

## Project Structure

```
pkg-risk/
├── src/pkgrisk/           # Python CLI and analysis code
│   ├── adapters/          # Ecosystem adapters (Homebrew, etc.)
│   ├── analyzers/         # Analysis pipeline components
│   └── models/            # Pydantic data models
├── frontend/              # React + Vite frontend
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Page components
│   │   └── types/         # TypeScript type definitions
│   └── public/data/       # Static package data
├── data/                  # Analysis output data
│   ├── analyzed/          # Per-package analysis results
│   └── final/             # Ecosystem summaries
└── scripts/               # Utility scripts
```

## Deployment

The frontend automatically deploys to GitHub Pages on push to `main` via GitHub Actions.

## License

MIT
