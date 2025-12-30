import type { PackageAnalysis } from '../types/package';

interface RecommendationsCardProps {
  pkg: PackageAnalysis;
}

interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  icon: string;
  text: string;
}

function getDaysSinceCommit(lastCommitDate: string | null | undefined): number | null {
  if (!lastCommitDate) return null;
  const lastCommit = new Date(lastCommitDate);
  const now = new Date();
  return Math.floor((now.getTime() - lastCommit.getTime()) / (1000 * 60 * 60 * 24));
}

function getRecommendations(pkg: PackageAnalysis): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const security = pkg.github_data?.security;
  const cveHistory = security?.cve_history;
  const daysSinceCommit = getDaysSinceCommit(pkg.github_data?.commits?.last_commit_date);

  // Critical: Unpatched CVEs
  if (cveHistory?.has_unpatched) {
    recommendations.push({
      priority: 'critical',
      icon: '🚨',
      text: 'Immediate action required: Unpatched vulnerabilities present. Check if newer version exists or find an alternative.',
    });
  }

  // Critical: Abandoned
  if (daysSinceCommit !== null && daysSinceCommit > 730) {
    recommendations.push({
      priority: 'critical',
      icon: '⛔',
      text: 'Project abandoned for 2+ years. Strongly recommend migrating to an actively maintained alternative.',
    });
  } else if (daysSinceCommit !== null && daysSinceCommit > 365) {
    recommendations.push({
      priority: 'high',
      icon: '⚠️',
      text: 'Project inactive for 1+ year. Plan for potential migration to an alternative.',
    });
  }

  // High: Has patched CVEs
  if (cveHistory && cveHistory.total_cves > 0 && !cveHistory.has_unpatched) {
    recommendations.push({
      priority: 'high',
      icon: '🔄',
      text: `Update to latest version. This package has ${cveHistory.total_cves} known CVE(s) that have been patched.`,
    });
  }

  // High: No security policy
  if (security && !security.has_security_md && !security.has_security_policy) {
    recommendations.push({
      priority: 'medium',
      icon: '📋',
      text: 'No security policy. Vulnerabilities may not have a clear reporting channel.',
    });
  }

  // Medium: No security scanning
  if (security && !security.has_dependabot && !security.has_codeql) {
    recommendations.push({
      priority: 'medium',
      icon: '🔍',
      text: 'Enable Dependabot alerts in your project to track vulnerabilities in this dependency.',
    });
  }

  // Medium: Stale
  if (daysSinceCommit !== null && daysSinceCommit > 180 && daysSinceCommit <= 365) {
    recommendations.push({
      priority: 'medium',
      icon: '⏰',
      text: 'Limited recent activity. Pin to a stable version and monitor for updates.',
    });
  }

  // Medium: Bus factor
  const topPct = pkg.github_data?.contributors?.top_contributor_pct;
  if (topPct !== null && topPct !== undefined && topPct > 80) {
    recommendations.push({
      priority: 'medium',
      icon: '👤',
      text: 'Single maintainer dependency. Identify alternatives in case of maintainer unavailability.',
    });
  }

  // Low: Version pinning
  if (pkg.version) {
    recommendations.push({
      priority: 'low',
      icon: '📌',
      text: `Pin to version ${pkg.version} in lockfiles to ensure reproducible builds.`,
    });
  }

  // Low: Good practices acknowledgment
  if (security?.has_dependabot && security?.has_codeql) {
    recommendations.push({
      priority: 'low',
      icon: '✅',
      text: 'Good security practices detected. Continue monitoring for updates.',
    });
  }

  return recommendations;
}

export function RecommendationsCard({ pkg }: RecommendationsCardProps) {
  const recommendations = getRecommendations(pkg);

  if (recommendations.length === 0) {
    return null;
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...recommendations].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  return (
    <section className="card recommendations-card">
      <h2>Recommendations</h2>
      <ul className="recommendations-list">
        {sorted.map((rec, i) => (
          <li key={i} className={`recommendation-item priority-${rec.priority}`}>
            <span className="rec-icon">{rec.icon}</span>
            <span className="rec-text">{rec.text}</span>
            <span className={`rec-priority priority-${rec.priority}`}>
              {rec.priority.toUpperCase()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default RecommendationsCard;
