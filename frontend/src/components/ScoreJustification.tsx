import { useState } from 'react';
import type { PackageAnalysis } from '../types/package';

interface ScoreJustificationProps {
  pkg: PackageAnalysis;
}

interface Factor {
  icon: 'positive' | 'negative' | 'neutral' | 'warning';
  description: string;
  impact: string;
}

interface ScoreCategory {
  name: string;
  score: number;
  weight: number;
  factors: Factor[];
  links: { label: string; url: string }[];
}

function getGitHubUrl(pkg: PackageAnalysis, path: string): string | null {
  if (!pkg.repository) return null;
  const branch = pkg.github_data?.repo.default_branch || 'main';
  return `https://github.com/${pkg.repository.owner}/${pkg.repository.repo}/blob/${branch}/${path}`;
}

function getRepoUrl(pkg: PackageAnalysis): string | null {
  if (!pkg.repository) return null;
  return `https://github.com/${pkg.repository.owner}/${pkg.repository.repo}`;
}

function formatImpact(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return '0';
}

function calculateAgeYears(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.max(1, (now.getTime() - created.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function buildSecurityFactors(pkg: PackageAnalysis): Factor[] {
  const factors: Factor[] = [];
  const security = pkg.github_data?.security;

  if (!security) return factors;

  // CVEs
  if (security.known_cves === 0) {
    factors.push({ icon: 'positive', description: 'No known CVEs', impact: '0' });
  } else {
    const penalty = Math.min(40, security.known_cves * 10);
    factors.push({ icon: 'negative', description: `${security.known_cves} known CVE(s)`, impact: formatImpact(-penalty) });
  }

  // SECURITY.md
  if (security.has_security_md) {
    factors.push({ icon: 'positive', description: 'SECURITY.md present', impact: '0' });
  } else if (!security.has_security_policy) {
    factors.push({ icon: 'negative', description: 'No security policy', impact: '-10' });
  }

  // Dependabot
  factors.push({
    icon: security.has_dependabot ? 'positive' : 'neutral',
    description: security.has_dependabot ? 'Dependabot enabled' : 'Dependabot not configured',
    impact: '0'
  });

  // CodeQL
  factors.push({
    icon: security.has_codeql ? 'positive' : 'neutral',
    description: security.has_codeql ? 'CodeQL scanning enabled' : 'CodeQL not configured',
    impact: '0'
  });

  // Security tools bonus/penalty
  const toolCount = [security.has_dependabot, security.has_codeql, security.has_security_ci].filter(Boolean).length;
  if (toolCount === 0) {
    factors.push({ icon: 'negative', description: 'No security tools configured', impact: '-10' });
  } else if (toolCount >= 2) {
    factors.push({ icon: 'positive', description: `${toolCount} security tools active`, impact: '+5' });
  }

  // Signed commits
  if (security.signed_commits_pct >= 50) {
    factors.push({ icon: 'positive', description: `${security.signed_commits_pct.toFixed(0)}% signed commits`, impact: '+5' });
  } else if (security.signed_commits_pct > 0) {
    factors.push({ icon: 'neutral', description: `${security.signed_commits_pct.toFixed(0)}% signed commits`, impact: '0' });
  }

  return factors;
}

function buildMaintenanceFactors(pkg: PackageAnalysis): Factor[] {
  const factors: Factor[] = [];
  const commits = pkg.github_data?.commits;
  const issues = pkg.github_data?.issues;
  const prs = pkg.github_data?.prs;
  const releases = pkg.github_data?.releases;

  if (!commits) return factors;

  // Last commit recency
  if (commits.last_commit_date) {
    const daysAgo = Math.floor((Date.now() - new Date(commits.last_commit_date).getTime()) / (24 * 60 * 60 * 1000));
    if (daysAgo <= 30) {
      factors.push({ icon: 'positive', description: `Last commit ${daysAgo} days ago`, impact: '0' });
    } else if (daysAgo <= 90) {
      factors.push({ icon: 'neutral', description: `Last commit ${daysAgo} days ago`, impact: '-5' });
    } else if (daysAgo <= 180) {
      factors.push({ icon: 'warning', description: `Last commit ${daysAgo} days ago`, impact: '-15' });
    } else {
      factors.push({ icon: 'negative', description: `Last commit ${daysAgo} days ago`, impact: '-25' });
    }
  }

  // Commit frequency
  if (commits.commits_last_6mo === 0) {
    factors.push({ icon: 'negative', description: 'No commits in 6 months', impact: '-20' });
  } else if (commits.commits_last_6mo < 5) {
    factors.push({ icon: 'warning', description: `Only ${commits.commits_last_6mo} commits in 6 months`, impact: '-10' });
  } else if (commits.commits_last_6mo > 50) {
    factors.push({ icon: 'positive', description: `${commits.commits_last_6mo} commits in 6 months`, impact: '+5' });
  } else {
    factors.push({ icon: 'neutral', description: `${commits.commits_last_6mo} commits in 6 months`, impact: '0' });
  }

  // Issue close rate
  if (issues) {
    const total = issues.open_issues + issues.closed_issues_6mo;
    if (total > 0) {
      const closeRate = (issues.closed_issues_6mo / total) * 100;
      if (closeRate < 30) {
        factors.push({ icon: 'warning', description: `${closeRate.toFixed(0)}% issue close rate`, impact: '-15' });
      } else if (closeRate > 70) {
        factors.push({ icon: 'positive', description: `${closeRate.toFixed(0)}% issue close rate`, impact: '+5' });
      } else {
        factors.push({ icon: 'neutral', description: `${closeRate.toFixed(0)}% issue close rate`, impact: '0' });
      }
    }
  }

  // Stale PRs
  if (prs && prs.stale_prs > 0) {
    const penalty = Math.min(15, prs.stale_prs * 2);
    factors.push({ icon: 'warning', description: `${prs.stale_prs} stale PRs (>90 days)`, impact: formatImpact(-penalty) });
  }

  // Release frequency
  if (releases) {
    if (releases.releases_last_year === 0) {
      factors.push({ icon: 'negative', description: 'No releases in past year', impact: '-10' });
    } else if (releases.releases_last_year >= 4) {
      factors.push({ icon: 'positive', description: `${releases.releases_last_year} releases in past year`, impact: '+5' });
    } else {
      factors.push({ icon: 'neutral', description: `${releases.releases_last_year} release(s) in past year`, impact: '0' });
    }
  }

  return factors;
}

function buildCommunityFactors(pkg: PackageAnalysis): Factor[] {
  const factors: Factor[] = [];
  const repo = pkg.github_data?.repo;
  const contributors = pkg.github_data?.contributors;
  const issues = pkg.github_data?.issues;

  if (!repo) return factors;

  // Stars per year
  if (repo.created_at) {
    const ageYears = calculateAgeYears(repo.created_at);
    const starsPerYear = repo.stars / ageYears;
    if (starsPerYear > 1000) {
      factors.push({ icon: 'positive', description: `${Math.round(starsPerYear).toLocaleString()} stars/year`, impact: '+15' });
    } else if (starsPerYear > 100) {
      factors.push({ icon: 'positive', description: `${Math.round(starsPerYear).toLocaleString()} stars/year`, impact: '+10' });
    } else if (starsPerYear > 10) {
      factors.push({ icon: 'neutral', description: `${Math.round(starsPerYear).toLocaleString()} stars/year`, impact: '+5' });
    } else {
      factors.push({ icon: 'neutral', description: `${Math.round(starsPerYear).toLocaleString()} stars/year`, impact: '0' });
    }
  }

  // Fork ratio
  if (repo.stars > 0) {
    const forkRatio = repo.forks / repo.stars;
    if (forkRatio > 0.1) {
      factors.push({ icon: 'positive', description: `High fork engagement (${(forkRatio * 100).toFixed(0)}%)`, impact: '+5' });
    }
  }

  // Contributors
  if (contributors) {
    if (contributors.total_contributors > 50) {
      factors.push({ icon: 'positive', description: `${contributors.total_contributors} contributors`, impact: '+5' });
    } else if (contributors.total_contributors > 10) {
      factors.push({ icon: 'neutral', description: `${contributors.total_contributors} contributors`, impact: '+2' });
    } else {
      factors.push({ icon: 'neutral', description: `${contributors.total_contributors} contributors`, impact: '0' });
    }
  }

  // Good first issues
  if (issues && issues.good_first_issue_count >= 5) {
    factors.push({ icon: 'positive', description: `${issues.good_first_issue_count} good first issues`, impact: '+5' });
  } else if (issues && issues.good_first_issue_count >= 1) {
    factors.push({ icon: 'neutral', description: `${issues.good_first_issue_count} good first issue(s)`, impact: '+2' });
  }

  // Discussions
  if (repo.has_discussions) {
    factors.push({ icon: 'positive', description: 'GitHub Discussions enabled', impact: '+3' });
  }

  // Install count
  if (pkg.install_count_30d) {
    if (pkg.install_count_30d > 100000) {
      factors.push({ icon: 'positive', description: `${(pkg.install_count_30d / 1000).toFixed(0)}K installs/month`, impact: '+10' });
    } else if (pkg.install_count_30d > 10000) {
      factors.push({ icon: 'positive', description: `${(pkg.install_count_30d / 1000).toFixed(0)}K installs/month`, impact: '+5' });
    }
  }

  return factors;
}

function buildBusFactorFactors(pkg: PackageAnalysis): Factor[] {
  const factors: Factor[] = [];
  const contributors = pkg.github_data?.contributors;
  const files = pkg.github_data?.files;

  if (!contributors) return factors;

  // Significant contributors
  if (contributors.contributors_over_5pct >= 3) {
    factors.push({ icon: 'positive', description: `${contributors.contributors_over_5pct} significant contributors (>5%)`, impact: '+25' });
  } else if (contributors.contributors_over_5pct >= 2) {
    factors.push({ icon: 'neutral', description: `${contributors.contributors_over_5pct} significant contributors (>5%)`, impact: '+15' });
  } else {
    factors.push({ icon: 'negative', description: 'Only 1 significant contributor', impact: '-10' });
  }

  // Top contributor concentration
  if (contributors.top_contributor_pct > 90) {
    factors.push({ icon: 'negative', description: `Top contributor: ${contributors.top_contributor_pct.toFixed(0)}% of commits`, impact: '-20' });
  } else if (contributors.top_contributor_pct > 75) {
    factors.push({ icon: 'warning', description: `Top contributor: ${contributors.top_contributor_pct.toFixed(0)}% of commits`, impact: '-10' });
  } else if (contributors.top_contributor_pct < 50) {
    factors.push({ icon: 'positive', description: `Top contributor: ${contributors.top_contributor_pct.toFixed(0)}% of commits`, impact: '+10' });
  } else {
    factors.push({ icon: 'neutral', description: `Top contributor: ${contributors.top_contributor_pct.toFixed(0)}% of commits`, impact: '0' });
  }

  // Active contributors
  if (contributors.active_contributors_6mo >= 5) {
    factors.push({ icon: 'positive', description: `${contributors.active_contributors_6mo} active contributors (6mo)`, impact: '+10' });
  } else if (contributors.active_contributors_6mo >= 2) {
    factors.push({ icon: 'neutral', description: `${contributors.active_contributors_6mo} active contributors (6mo)`, impact: '+5' });
  } else {
    factors.push({ icon: 'warning', description: `Only ${contributors.active_contributors_6mo} active contributor (6mo)`, impact: '-10' });
  }

  // Governance files
  if (files) {
    if (files.has_codeowners) {
      factors.push({ icon: 'positive', description: 'CODEOWNERS file present', impact: '+5' });
    }
    if (files.has_governance) {
      factors.push({ icon: 'positive', description: 'GOVERNANCE file present', impact: '+5' });
    }
  }

  return factors;
}

function buildDocumentationFactors(pkg: PackageAnalysis): Factor[] {
  const factors: Factor[] = [];
  const files = pkg.github_data?.files;
  const readme = pkg.llm_assessments?.readme;

  if (!files) return factors;

  // README
  if (files.has_readme) {
    factors.push({ icon: 'positive', description: 'README present', impact: '+20' });
    if (files.readme_size_bytes > 5000) {
      factors.push({ icon: 'positive', description: `Comprehensive README (${(files.readme_size_bytes / 1000).toFixed(1)}KB)`, impact: '+10' });
    } else if (files.readme_size_bytes > 1000) {
      factors.push({ icon: 'neutral', description: `README size: ${(files.readme_size_bytes / 1000).toFixed(1)}KB`, impact: '+5' });
    }
  } else {
    factors.push({ icon: 'negative', description: 'No README', impact: '0' });
  }

  // Docs directory
  if (files.has_docs_dir) {
    factors.push({ icon: 'positive', description: 'Documentation directory present', impact: '+15' });
  }

  // Examples
  if (files.has_examples_dir) {
    factors.push({ icon: 'positive', description: 'Examples directory present', impact: '+15' });
  }

  // CHANGELOG
  if (files.has_changelog) {
    factors.push({ icon: 'positive', description: 'CHANGELOG present', impact: '+10' });
  }

  // CONTRIBUTING
  if (files.has_contributing) {
    factors.push({ icon: 'positive', description: 'CONTRIBUTING guide present', impact: '+5' });
  }

  // LLM assessment
  if (readme) {
    const avg = (readme.clarity + readme.installation + readme.quick_start + readme.examples) / 4;
    const points = Math.round(avg * 2.5);
    factors.push({ icon: avg >= 7 ? 'positive' : avg >= 5 ? 'neutral' : 'warning', description: `LLM quality score: ${avg.toFixed(1)}/10`, impact: `+${points}` });
  }

  return factors;
}

function buildStabilityFactors(pkg: PackageAnalysis): Factor[] {
  const factors: Factor[] = [];
  const releases = pkg.github_data?.releases;
  const files = pkg.github_data?.files;
  const ci = pkg.github_data?.ci;
  const issues = pkg.github_data?.issues;

  // Version maturity
  if (releases?.latest_version) {
    const majorVersion = parseInt(releases.latest_version.replace(/^v/, '').split('.')[0]) || 0;
    if (majorVersion >= 1) {
      factors.push({ icon: 'positive', description: `Stable version (${releases.latest_version})`, impact: '+15' });
    } else {
      factors.push({ icon: 'warning', description: `Pre-1.0 version (${releases.latest_version})`, impact: '0' });
    }
  }

  // Prerelease ratio
  if (releases) {
    if (releases.prerelease_ratio > 0.5) {
      factors.push({ icon: 'warning', description: `High prerelease ratio (${(releases.prerelease_ratio * 100).toFixed(0)}%)`, impact: '-10' });
    } else if (releases.prerelease_ratio < 0.1) {
      factors.push({ icon: 'positive', description: 'Low prerelease ratio', impact: '+5' });
    }
  }

  // Test suite
  if (files?.has_tests_dir) {
    factors.push({ icon: 'positive', description: 'Test suite present', impact: '+10' });
  } else {
    factors.push({ icon: 'warning', description: 'No test directory found', impact: '0' });
  }

  // CI/CD
  if (ci?.has_github_actions) {
    factors.push({ icon: 'positive', description: 'GitHub Actions configured', impact: '+10' });
    if (ci.recent_runs_pass_rate !== null) {
      if (ci.recent_runs_pass_rate >= 95) {
        factors.push({ icon: 'positive', description: `CI pass rate: ${ci.recent_runs_pass_rate}%`, impact: '+5' });
      } else if (ci.recent_runs_pass_rate < 70) {
        factors.push({ icon: 'negative', description: `CI pass rate: ${ci.recent_runs_pass_rate}%`, impact: '-10' });
      } else {
        factors.push({ icon: 'neutral', description: `CI pass rate: ${ci.recent_runs_pass_rate}%`, impact: '0' });
      }
    }
  }

  // Regression issues
  if (issues && issues.regression_issue_count > 5) {
    factors.push({ icon: 'negative', description: `${issues.regression_issue_count} regression issues`, impact: '-10' });
  } else if (issues && issues.regression_issue_count > 0) {
    factors.push({ icon: 'warning', description: `${issues.regression_issue_count} regression issue(s)`, impact: '-5' });
  }

  return factors;
}

function buildSecurityLinks(pkg: PackageAnalysis): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  const security = pkg.github_data?.security;

  if (security?.has_security_md) {
    const url = getGitHubUrl(pkg, 'SECURITY.md');
    if (url) links.push({ label: 'SECURITY.md', url });
  }
  if (security?.has_dependabot) {
    const url = getGitHubUrl(pkg, '.github/dependabot.yml');
    if (url) links.push({ label: 'dependabot.yml', url });
  }

  return links;
}

function buildDocLinks(pkg: PackageAnalysis): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  const files = pkg.github_data?.files;

  if (files?.has_readme) {
    const url = getGitHubUrl(pkg, 'README.md');
    if (url) links.push({ label: 'README', url });
  }
  if (files?.has_docs_dir) {
    const url = getGitHubUrl(pkg, 'docs');
    if (url) links.push({ label: 'docs/', url });
  }
  if (files?.has_changelog) {
    const url = getGitHubUrl(pkg, 'CHANGELOG.md');
    if (url) links.push({ label: 'CHANGELOG', url });
  }
  if (files?.has_contributing) {
    const url = getGitHubUrl(pkg, 'CONTRIBUTING.md');
    if (url) links.push({ label: 'CONTRIBUTING', url });
  }

  return links;
}

function buildStabilityLinks(pkg: PackageAnalysis): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  const files = pkg.github_data?.files;
  const ci = pkg.github_data?.ci;

  if (files?.has_tests_dir) {
    const url = getGitHubUrl(pkg, 'tests');
    if (url) links.push({ label: 'tests/', url });
  }
  if (ci?.has_github_actions) {
    const url = getGitHubUrl(pkg, '.github/workflows');
    if (url) links.push({ label: 'workflows/', url });
  }

  return links;
}

function buildBusFactorLinks(pkg: PackageAnalysis): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  const files = pkg.github_data?.files;

  if (files?.has_codeowners) {
    const url = getGitHubUrl(pkg, 'CODEOWNERS');
    if (url) links.push({ label: 'CODEOWNERS', url });
  }
  if (files?.has_governance) {
    const url = getGitHubUrl(pkg, 'GOVERNANCE.md');
    if (url) links.push({ label: 'GOVERNANCE', url });
  }

  const repoUrl = getRepoUrl(pkg);
  if (repoUrl) {
    links.push({ label: 'Contributors', url: `${repoUrl}/graphs/contributors` });
  }

  return links;
}

function ScoreCategoryCard({ category, defaultExpanded = false }: { category: ScoreCategory; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="score-category">
      <button className="score-category-header" onClick={() => setExpanded(!expanded)}>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
        <span className="category-name">{category.name}</span>
        <span className="category-score">{category.score.toFixed(1)}</span>
        <span className="category-weight">({category.weight}% weight)</span>
      </button>
      {expanded && (
        <div className="score-category-content">
          <div className="factors-list">
            {category.factors.map((factor, i) => (
              <div key={i} className={`factor-row factor-${factor.icon}`}>
                <span className="factor-icon">
                  {factor.icon === 'positive' && '✓'}
                  {factor.icon === 'negative' && '✗'}
                  {factor.icon === 'neutral' && '○'}
                  {factor.icon === 'warning' && '⚠'}
                </span>
                <span className="factor-description">{factor.description}</span>
                <span className="factor-impact">{factor.impact}</span>
              </div>
            ))}
          </div>
          {category.links.length > 0 && (
            <div className="category-links">
              <span className="links-label">View:</span>
              {category.links.map((link, i) => (
                <span key={i}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
                  {i < category.links.length - 1 && ' · '}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ScoreJustification({ pkg }: ScoreJustificationProps) {
  const [expanded, setExpanded] = useState(false);

  if (!pkg.scores || !pkg.github_data) {
    return null;
  }

  const categories: ScoreCategory[] = [
    {
      name: 'Security Score',
      score: pkg.scores.security.score,
      weight: pkg.scores.security.weight,
      factors: buildSecurityFactors(pkg),
      links: buildSecurityLinks(pkg),
    },
    {
      name: 'Maintenance Score',
      score: pkg.scores.maintenance.score,
      weight: pkg.scores.maintenance.weight,
      factors: buildMaintenanceFactors(pkg),
      links: [],
    },
    {
      name: 'Community Score',
      score: pkg.scores.community.score,
      weight: pkg.scores.community.weight,
      factors: buildCommunityFactors(pkg),
      links: [],
    },
    {
      name: 'Bus Factor Score',
      score: pkg.scores.bus_factor.score,
      weight: pkg.scores.bus_factor.weight,
      factors: buildBusFactorFactors(pkg),
      links: buildBusFactorLinks(pkg),
    },
    {
      name: 'Documentation Score',
      score: pkg.scores.documentation.score,
      weight: pkg.scores.documentation.weight,
      factors: buildDocumentationFactors(pkg),
      links: buildDocLinks(pkg),
    },
    {
      name: 'Stability Score',
      score: pkg.scores.stability.score,
      weight: pkg.scores.stability.weight,
      factors: buildStabilityFactors(pkg),
      links: buildStabilityLinks(pkg),
    },
  ];

  return (
    <section className="score-justification">
      <button className="justification-header" onClick={() => setExpanded(!expanded)}>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
        <h2>How Scores Are Calculated</h2>
      </button>
      {expanded && (
        <div className="justification-content">
          <p className="justification-intro">
            The overall score of <strong>{pkg.scores.overall.toFixed(1)}</strong> is a weighted average of six components.
            Each factor below shows its contribution to the final score.
          </p>
          {categories.map((category) => (
            <ScoreCategoryCard key={category.name} category={category} />
          ))}
        </div>
      )}
    </section>
  );
}

export default ScoreJustification;
