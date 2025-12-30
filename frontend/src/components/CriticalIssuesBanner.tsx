import type { PackageAnalysis } from '../types/package';

interface CriticalIssuesBannerProps {
  pkg: PackageAnalysis;
}

function getDaysSinceCommit(lastCommitDate: string | null | undefined): number | null {
  if (!lastCommitDate) return null;
  const lastCommit = new Date(lastCommitDate);
  const now = new Date();
  return Math.floor((now.getTime() - lastCommit.getTime()) / (1000 * 60 * 60 * 24));
}

interface CriticalIssue {
  severity: 'critical' | 'high';
  icon: string;
  title: string;
  description: string;
}

export function CriticalIssuesBanner({ pkg }: CriticalIssuesBannerProps) {
  const issues: CriticalIssue[] = [];

  // Check for unpatched CVEs
  const cveHistory = pkg.github_data?.security?.cve_history;
  if (cveHistory?.has_unpatched) {
    const unpatchedCount = cveHistory.cves.filter(cve => !cve.fixed_version).length;
    issues.push({
      severity: 'critical',
      icon: '🚨',
      title: `${unpatchedCount} Unpatched Vulnerabilit${unpatchedCount === 1 ? 'y' : 'ies'}`,
      description: 'This package has known security vulnerabilities without fixes.',
    });
  }

  // Check for abandoned package
  const daysSinceCommit = getDaysSinceCommit(pkg.github_data?.commits?.last_commit_date);
  if (daysSinceCommit !== null && daysSinceCommit > 365) {
    const years = Math.floor(daysSinceCommit / 365);
    issues.push({
      severity: 'critical',
      icon: '⚠️',
      title: 'Abandoned Project',
      description: `No commits in ${years > 1 ? `${years} years` : 'over a year'}. This project may be unmaintained.`,
    });
  }

  // Check for single maintainer risk
  const topContributorPct = pkg.github_data?.contributors?.top_contributor_pct;
  if (topContributorPct !== null && topContributorPct !== undefined && topContributorPct > 90) {
    issues.push({
      severity: 'high',
      icon: '👤',
      title: 'Single Maintainer',
      description: `${topContributorPct.toFixed(0)}% of commits from one person. High bus factor risk.`,
    });
  }

  // Check for stale package (6-12 months)
  if (daysSinceCommit !== null && daysSinceCommit > 180 && daysSinceCommit <= 365) {
    issues.push({
      severity: 'high',
      icon: '🕐',
      title: 'Limited Recent Activity',
      description: `Last commit was ${Math.floor(daysSinceCommit / 30)} months ago.`,
    });
  }

  if (issues.length === 0) {
    return null;
  }

  const hasCritical = issues.some(i => i.severity === 'critical');

  return (
    <div className={`critical-issues-banner ${hasCritical ? 'severity-critical' : 'severity-high'}`}>
      <div className="banner-header">
        <span className="banner-icon">{hasCritical ? '🚨' : '⚠️'}</span>
        <span className="banner-title">
          {hasCritical ? 'Critical Issues Found' : 'Issues Detected'}
        </span>
      </div>
      <ul className="issue-list">
        {issues.map((issue, i) => (
          <li key={i} className={`issue-item issue-${issue.severity}`}>
            <span className="issue-icon">{issue.icon}</span>
            <div className="issue-content">
              <strong>{issue.title}</strong>
              <span>{issue.description}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CriticalIssuesBanner;
