import type { ProjectAnalysis, Grade, RiskTier } from '../types/package';
import { GradeBadge } from './GradeBadge';
import type { QuickFilter } from './DependencyResults';

interface ProjectSummaryProps {
  analysis: ProjectAnalysis;
  onQuickFilterClick?: (filter: QuickFilter) => void;
  onPackageClick?: (packageName: string) => void;
}

export function ProjectSummary({ analysis, onQuickFilterClick, onPackageClick }: ProjectSummaryProps) {
  const { summary, dependencies, ecosystem } = analysis;

  // Calculate risk metrics
  const prohibitedCount = summary.riskTierDistribution.prohibited || 0;
  const restrictedCount = summary.riskTierDistribution.restricted || 0;
  const cveCount = dependencies.filter((d) => d.scored?.has_unpatched_cves).length;

  const abandonedPackages = dependencies.filter((d) => {
    if (!d.scored?.last_commit_date) return false;
    const lastCommit = new Date(d.scored.last_commit_date);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return lastCommit < twoYearsAgo;
  });

  const highBusFactorPackages = dependencies.filter(
    (d) => d.scored?.top_contributor_pct && d.scored.top_contributor_pct > 80
  );

  // Find critical packages for detail list
  const criticalPackages = dependencies.filter(
    (d) =>
      d.scored?.has_unpatched_cves ||
      d.scored?.scores?.risk_tier === 'prohibited' ||
      d.scored?.scores?.risk_tier === 'restricted'
  );

  const hasRiskIssues = prohibitedCount > 0 || restrictedCount > 0 || cveCount > 0 || abandonedPackages.length > 0;

  return (
    <div className="project-summary risk-first">
      <div className="summary-header">
        <h2>Project Health Summary</h2>
        <span className="ecosystem-badge">{ecosystem}</span>
      </div>

      <div className="summary-layout">
        {/* Risk Summary - Primary Focus */}
        <div className="risk-summary-section">
          <h3 className="section-title">Risk Overview</h3>
          <div className="risk-metrics">
            <div
              className={`risk-metric ${prohibitedCount > 0 ? 'danger clickable' : ''}`}
              onClick={() => prohibitedCount > 0 && onQuickFilterClick?.('prohibited')}
              title={prohibitedCount > 0 ? 'View prohibited packages' : undefined}
            >
              <span className="metric-value">{prohibitedCount}</span>
              <span className="metric-label">Prohibited</span>
            </div>
            <div
              className={`risk-metric ${restrictedCount > 0 ? 'warning clickable' : ''}`}
              onClick={() => restrictedCount > 0 && onQuickFilterClick?.('needs_action')}
              title={restrictedCount > 0 ? 'View restricted packages' : undefined}
            >
              <span className="metric-value">{restrictedCount}</span>
              <span className="metric-label">Restricted</span>
            </div>
            <div
              className={`risk-metric ${cveCount > 0 ? 'danger clickable' : ''}`}
              onClick={() => cveCount > 0 && onQuickFilterClick?.('has_cves')}
              title={cveCount > 0 ? 'View packages with CVEs' : undefined}
            >
              <span className="metric-value">{cveCount}</span>
              <span className="metric-label">Unpatched CVEs</span>
            </div>
            <div
              className={`risk-metric ${abandonedPackages.length > 0 ? 'info clickable' : ''}`}
              onClick={() => abandonedPackages.length > 0 && onQuickFilterClick?.('outdated')}
              title={abandonedPackages.length > 0 ? 'View outdated packages' : undefined}
            >
              <span className="metric-value">{abandonedPackages.length}</span>
              <span className="metric-label">Outdated</span>
            </div>
          </div>

          {!hasRiskIssues && (
            <div className="no-risk-issues">
              <span className="check-icon">✓</span>
              No critical risk issues detected
            </div>
          )}
        </div>

        {/* Project Stats - Secondary */}
        <div className="stats-section">
          <h3 className="section-title">Project Stats</h3>
          <div className="compact-stats">
            <div
              className="compact-stat clickable"
              onClick={() => onQuickFilterClick?.('all')}
              title="View all dependencies"
            >
              <span className="stat-number">{summary.total}</span>
              <span className="stat-text">total deps</span>
            </div>
            <div className="compact-stat">
              <span className="stat-number">{summary.scored}</span>
              <span className="stat-text">analyzed</span>
            </div>
            <div
              className={`compact-stat ${summary.unscored > 0 ? 'clickable' : ''}`}
              onClick={() => summary.unscored > 0 && onQuickFilterClick?.('unscored')}
              title={summary.unscored > 0 ? 'View unscored packages' : undefined}
            >
              <span className="stat-number">{summary.unscored}</span>
              <span className="stat-text">unscored</span>
            </div>
            <div className="compact-stat">
              <span className="stat-number">
                {summary.avgScore !== null ? summary.avgScore.toFixed(0) : '-'}
              </span>
              <span className="stat-text">avg score</span>
            </div>
          </div>
        </div>
      </div>

      {/* Distributions */}
      <div className="summary-distributions">
        <div className="distribution-card">
          <h3>Grade Distribution</h3>
          <GradeDistributionChart distribution={summary.gradeDistribution} total={summary.scored} />
        </div>

        <div className="distribution-card">
          <h3>Risk Tier Distribution</h3>
          <RiskTierChart distribution={summary.riskTierDistribution} total={summary.scored} />
        </div>
      </div>

      {/* Detailed Issue Lists */}
      {(criticalPackages.length > 0 ||
        abandonedPackages.length > 0 ||
        highBusFactorPackages.length > 0) && (
        <div className="critical-issues">
          <h3>Issues Requiring Attention</h3>

          {criticalPackages.length > 0 && (
            <div className="issue-section critical">
              <div
                className="issue-header clickable"
                onClick={() => onQuickFilterClick?.('needs_action')}
                title="Filter to critical packages"
              >
                <span className="issue-icon">!</span>
                <span className="issue-title">Critical Risk Packages ({criticalPackages.length})</span>
              </div>
              <ul className="issue-list">
                {criticalPackages.map((pkg) => (
                  <li
                    key={pkg.parsed.name}
                    className="clickable"
                    onClick={() => onPackageClick?.(pkg.parsed.name)}
                  >
                    <strong>{pkg.parsed.name}</strong>
                    {pkg.scored?.has_unpatched_cves && (
                      <span className="issue-tag cve">Unpatched CVEs</span>
                    )}
                    {pkg.scored?.scores?.risk_tier === 'prohibited' && (
                      <span className="issue-tag prohibited">Prohibited</span>
                    )}
                    {pkg.scored?.scores?.risk_tier === 'restricted' && (
                      <span className="issue-tag restricted">Restricted</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {abandonedPackages.length > 0 && (
            <div className="issue-section warning">
              <div
                className="issue-header clickable"
                onClick={() => onQuickFilterClick?.('outdated')}
                title="Filter to outdated packages"
              >
                <span className="issue-icon">⚠</span>
                <span className="issue-title">
                  Potentially Abandoned ({abandonedPackages.length})
                </span>
              </div>
              <ul className="issue-list">
                {abandonedPackages.map((pkg) => (
                  <li
                    key={pkg.parsed.name}
                    className="clickable"
                    onClick={() => onPackageClick?.(pkg.parsed.name)}
                  >
                    <strong>{pkg.parsed.name}</strong>
                    <span className="issue-detail">
                      Last commit:{' '}
                      {pkg.scored?.last_commit_date
                        ? new Date(pkg.scored.last_commit_date).toLocaleDateString()
                        : 'Unknown'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {highBusFactorPackages.length > 0 && (
            <div className="issue-section info">
              <div className="issue-header">
                <span className="issue-icon">i</span>
                <span className="issue-title">
                  High Bus Factor Risk ({highBusFactorPackages.length})
                </span>
              </div>
              <ul className="issue-list">
                {highBusFactorPackages.map((pkg) => (
                  <li
                    key={pkg.parsed.name}
                    className="clickable"
                    onClick={() => onPackageClick?.(pkg.parsed.name)}
                  >
                    <strong>{pkg.parsed.name}</strong>
                    <span className="issue-detail">
                      {pkg.scored?.top_contributor_pct?.toFixed(0)}% from top contributor
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface GradeDistributionChartProps {
  distribution: Record<Grade, number>;
  total: number;
}

function GradeDistributionChart({ distribution, total }: GradeDistributionChartProps) {
  const grades: Grade[] = ['A', 'B', 'C', 'D', 'F'];

  if (total === 0) {
    return <div className="no-data">No scored packages</div>;
  }

  return (
    <div className="grade-distribution">
      {grades.map((grade) => {
        const count = distribution[grade] || 0;
        const percentage = total > 0 ? (count / total) * 100 : 0;

        return (
          <div key={grade} className="grade-bar-row">
            <GradeBadge grade={grade} size="sm" />
            <div className="bar-container">
              <div
                className={`bar grade-${grade.toLowerCase()}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <span className="count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

interface RiskTierChartProps {
  distribution: Record<RiskTier, number>;
  total: number;
}

function RiskTierChart({ distribution, total }: RiskTierChartProps) {
  const tiers: Array<{ key: RiskTier; label: string; color: string }> = [
    { key: 'approved', label: 'Approved', color: '#22c55e' },
    { key: 'conditional', label: 'Conditional', color: '#eab308' },
    { key: 'restricted', label: 'Restricted', color: '#f97316' },
    { key: 'prohibited', label: 'Prohibited', color: '#ef4444' },
  ];

  if (total === 0) {
    return <div className="no-data">No scored packages</div>;
  }

  return (
    <div className="risk-distribution">
      {tiers.map(({ key, label, color }) => {
        const count = distribution[key] || 0;
        const percentage = total > 0 ? (count / total) * 100 : 0;

        return (
          <div key={key} className="risk-bar-row">
            <span className="tier-label" style={{ color }}>
              {label}
            </span>
            <div className="bar-container">
              <div className="bar" style={{ width: `${percentage}%`, backgroundColor: color }} />
            </div>
            <span className="count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
