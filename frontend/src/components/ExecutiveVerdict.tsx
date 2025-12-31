import type { ProjectAnalysis, MatchedDependency } from '../types/package';

export type VerdictLevel = 'approved' | 'review' | 'critical';

interface ExecutiveVerdictProps {
  analysis: ProjectAnalysis;
  onViewActionItems?: () => void;
  onExport?: () => void;
}

interface VerdictDetails {
  level: VerdictLevel;
  title: string;
  icon: string;
  issues: string[];
}

function calculateVerdict(analysis: ProjectAnalysis): VerdictDetails {
  const { dependencies, summary } = analysis;
  const issues: string[] = [];

  // Count critical issues
  const prohibitedCount = summary.riskTierDistribution.prohibited || 0;
  const restrictedCount = summary.riskTierDistribution.restricted || 0;
  const packagesWithCVEs = dependencies.filter(
    (d) => d.scored?.has_unpatched_cves
  ).length;
  const abandonedCount = dependencies.filter((d) => {
    if (!d.scored?.last_commit_date) return false;
    const lastCommit = new Date(d.scored.last_commit_date);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return lastCommit < twoYearsAgo;
  }).length;
  const highBusFactorCount = dependencies.filter(
    (d) => d.scored?.top_contributor_pct && d.scored.top_contributor_pct > 80
  ).length;

  // Build issues list
  if (prohibitedCount > 0) {
    issues.push(
      `${prohibitedCount} prohibited package${prohibitedCount > 1 ? 's' : ''}`
    );
  }
  if (packagesWithCVEs > 0) {
    issues.push(
      `${packagesWithCVEs} unpatched CVE${packagesWithCVEs > 1 ? 's' : ''}`
    );
  }
  if (restrictedCount > 0) {
    issues.push(
      `${restrictedCount} restricted package${restrictedCount > 1 ? 's' : ''}`
    );
  }
  if (abandonedCount > 0) {
    issues.push(
      `${abandonedCount} potentially abandoned`
    );
  }
  if (highBusFactorCount > 0) {
    issues.push(
      `${highBusFactorCount} with high bus factor`
    );
  }
  if (summary.unscored > 0) {
    issues.push(`${summary.unscored} not analyzed`);
  }

  // Determine verdict level
  let level: VerdictLevel;
  let title: string;
  let icon: string;

  if (prohibitedCount > 0 || packagesWithCVEs > 0) {
    level = 'critical';
    title = 'CRITICAL ISSUES FOUND';
    icon = '🚨';
  } else if (
    restrictedCount > 0 ||
    abandonedCount > 3 ||
    highBusFactorCount > 5 ||
    (summary.avgScore !== null && summary.avgScore < 60)
  ) {
    level = 'review';
    title = 'REVIEW REQUIRED';
    icon = '⚠️';
  } else {
    level = 'approved';
    title = 'APPROVED';
    icon = '✅';
  }

  return { level, title, icon, issues };
}

export function ExecutiveVerdict({
  analysis,
  onViewActionItems,
  onExport,
}: ExecutiveVerdictProps) {
  const verdict = calculateVerdict(analysis);

  return (
    <div className={`executive-verdict verdict-${verdict.level}`}>
      <div className="verdict-content">
        <div className="verdict-header">
          <span className="verdict-icon">{verdict.icon}</span>
          <h2 className="verdict-title">{verdict.title}</h2>
        </div>

        {verdict.issues.length > 0 && (
          <p className="verdict-summary">{verdict.issues.join(' • ')}</p>
        )}

        {verdict.level === 'approved' && verdict.issues.length === 0 && (
          <p className="verdict-summary">
            No critical security issues detected. All packages meet quality standards.
          </p>
        )}
      </div>

      <div className="verdict-actions">
        {verdict.level !== 'approved' && onViewActionItems && (
          <button className="verdict-btn primary" onClick={onViewActionItems}>
            View Action Items
          </button>
        )}
        {onExport && (
          <button className="verdict-btn secondary" onClick={onExport}>
            Export Report
          </button>
        )}
      </div>
    </div>
  );
}

// Helper to get counts for filter integration
export function getVerdictCounts(dependencies: MatchedDependency[]) {
  const prohibitedCount = dependencies.filter(
    (d) => d.scored?.scores?.risk_tier === 'prohibited'
  ).length;
  const restrictedCount = dependencies.filter(
    (d) => d.scored?.scores?.risk_tier === 'restricted'
  ).length;
  const cveCount = dependencies.filter(
    (d) => d.scored?.has_unpatched_cves
  ).length;
  const abandonedCount = dependencies.filter((d) => {
    if (!d.scored?.last_commit_date) return false;
    const lastCommit = new Date(d.scored.last_commit_date);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return lastCommit < twoYearsAgo;
  }).length;
  const highBusFactorCount = dependencies.filter(
    (d) => d.scored?.top_contributor_pct && d.scored.top_contributor_pct > 80
  ).length;

  return {
    prohibited: prohibitedCount,
    restricted: restrictedCount,
    cves: cveCount,
    abandoned: abandonedCount,
    highBusFactor: highBusFactorCount,
    needsAction: prohibitedCount + restrictedCount + cveCount,
  };
}
