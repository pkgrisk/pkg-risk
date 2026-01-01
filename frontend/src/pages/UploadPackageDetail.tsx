import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getStoredAnalysis, getStoredPackage } from '../hooks/useAnalysisStorage';
import { GradeBadge } from '../components/GradeBadge';
import { RiskBadges } from '../components/RiskBadges';
import { ScoreBar } from '../components/ScoreBar';
import type { MatchedDependency, ProjectAnalysis, PackageSummary } from '../types/package';

// Helper function
function getDaysSinceCommit(lastCommitDate: string | null | undefined): number | null {
  if (!lastCommitDate) return null;
  const lastCommit = new Date(lastCommitDate);
  const now = new Date();
  return Math.floor((now.getTime() - lastCommit.getTime()) / (1000 * 60 * 60 * 24));
}

// Critical Issues Banner - adapted for PackageSummary
interface CriticalIssue {
  severity: 'critical' | 'high';
  icon: string;
  title: string;
  description: string;
}

function SummaryCriticalIssuesBanner({ pkg }: { pkg: PackageSummary }) {
  const issues: CriticalIssue[] = [];

  // Check for unpatched CVEs
  if (pkg.has_unpatched_cves) {
    issues.push({
      severity: 'critical',
      icon: '!',
      title: `${pkg.cve_count || 'Known'} Unpatched Vulnerabilit${pkg.cve_count === 1 ? 'y' : 'ies'}`,
      description: 'This package has known security vulnerabilities without fixes.',
    });
  }

  // Check for abandoned package
  const daysSinceCommit = getDaysSinceCommit(pkg.last_commit_date);
  if (daysSinceCommit !== null && daysSinceCommit > 365) {
    const years = Math.floor(daysSinceCommit / 365);
    issues.push({
      severity: 'critical',
      icon: '!',
      title: 'Abandoned Project',
      description: `No commits in ${years > 1 ? `${years} years` : 'over a year'}. This project may be unmaintained.`,
    });
  }

  // Check for single maintainer risk
  const topContributorPct = pkg.top_contributor_pct;
  if (topContributorPct !== null && topContributorPct !== undefined && topContributorPct > 90) {
    issues.push({
      severity: 'high',
      icon: 'i',
      title: 'Single Maintainer',
      description: `${topContributorPct.toFixed(0)}% of commits from one person. High bus factor risk.`,
    });
  }

  // Check for stale package (6-12 months)
  if (daysSinceCommit !== null && daysSinceCommit > 180 && daysSinceCommit <= 365) {
    issues.push({
      severity: 'high',
      icon: '...',
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
        <span className="banner-icon">{hasCritical ? '!' : '!'}</span>
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

// Quick Verdict - adapted for PackageSummary
type VerdictLevel = 'safe' | 'caution' | 'risk';

interface Verdict {
  level: VerdictLevel;
  icon: string;
  title: string;
  summary: string;
  action: string;
}

function getVerdictFromSummary(pkg: PackageSummary): Verdict {
  const daysSinceCommit = getDaysSinceCommit(pkg.last_commit_date);
  const topContributorPct = pkg.top_contributor_pct;
  const overallScore = pkg.scores?.overall;

  // Critical issues = High risk
  if (pkg.has_unpatched_cves) {
    return {
      level: 'risk',
      icon: 'X',
      title: 'High Risk',
      summary: 'This package has unpatched security vulnerabilities.',
      action: 'Avoid use or find a patched version immediately.',
    };
  }

  if (daysSinceCommit !== null && daysSinceCommit > 365) {
    return {
      level: 'risk',
      icon: 'X',
      title: 'High Risk',
      summary: 'This project appears to be abandoned with no recent maintenance.',
      action: 'Consider alternatives with active maintenance.',
    };
  }

  // Warning issues = Use with caution
  if (pkg.cve_count && pkg.cve_count > 0 && !pkg.has_unpatched_cves) {
    return {
      level: 'caution',
      icon: '!',
      title: 'Use with Caution',
      summary: 'This package has a history of security vulnerabilities (all patched).',
      action: 'Keep updated to the latest version and monitor for new CVEs.',
    };
  }

  if (daysSinceCommit !== null && daysSinceCommit > 180) {
    return {
      level: 'caution',
      icon: '!',
      title: 'Use with Caution',
      summary: 'Limited recent activity may indicate declining maintenance.',
      action: 'Monitor for updates and have a backup plan.',
    };
  }

  if (topContributorPct !== null && topContributorPct !== undefined && topContributorPct > 80) {
    return {
      level: 'caution',
      icon: '!',
      title: 'Use with Caution',
      summary: 'High bus factor risk with most commits from a single contributor.',
      action: 'Be aware of maintainer availability and consider alternatives.',
    };
  }

  if (overallScore !== null && overallScore !== undefined && overallScore < 50) {
    return {
      level: 'caution',
      icon: '!',
      title: 'Use with Caution',
      summary: 'Low overall score indicates potential quality or maintenance concerns.',
      action: 'Review specific score components before adopting.',
    };
  }

  // No issues = Safe to use
  if (overallScore !== null && overallScore !== undefined && overallScore >= 80) {
    return {
      level: 'safe',
      icon: 'OK',
      title: 'Safe to Use',
      summary: 'No blocking issues detected. Strong security and maintenance practices.',
      action: 'Proceed with confidence. Follow standard dependency management practices.',
    };
  }

  return {
    level: 'safe',
    icon: 'OK',
    title: 'Safe to Use',
    summary: 'No major issues detected.',
    action: 'Follow standard dependency management practices.',
  };
}

function SummaryQuickVerdict({ pkg }: { pkg: PackageSummary }) {
  if (!pkg.scores && pkg.data_availability !== 'available') {
    return null;
  }

  const verdict = getVerdictFromSummary(pkg);

  return (
    <div className={`quick-verdict verdict-${verdict.level}`}>
      <div className="verdict-header">
        <span className="verdict-icon">{verdict.icon}</span>
        <span className="verdict-title">{verdict.title}</span>
      </div>
      <p className="verdict-summary">{verdict.summary}</p>
      <p className="verdict-action">
        <strong>Recommended:</strong> {verdict.action}
      </p>
    </div>
  );
}

// Recommendations Card - adapted for PackageSummary
interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  icon: string;
  text: string;
}

function getRecommendationsFromSummary(pkg: PackageSummary): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const daysSinceCommit = getDaysSinceCommit(pkg.last_commit_date);

  // Critical: Unpatched CVEs
  if (pkg.has_unpatched_cves) {
    recommendations.push({
      priority: 'critical',
      icon: '!',
      text: 'Immediate action required: Unpatched vulnerabilities present. Check if newer version exists or find an alternative.',
    });
  }

  // Critical: Abandoned
  if (daysSinceCommit !== null && daysSinceCommit > 730) {
    recommendations.push({
      priority: 'critical',
      icon: 'X',
      text: 'Project abandoned for 2+ years. Strongly recommend migrating to an actively maintained alternative.',
    });
  } else if (daysSinceCommit !== null && daysSinceCommit > 365) {
    recommendations.push({
      priority: 'high',
      icon: '!',
      text: 'Project inactive for 1+ year. Plan for potential migration to an alternative.',
    });
  }

  // High: Has patched CVEs
  if (pkg.cve_count && pkg.cve_count > 0 && !pkg.has_unpatched_cves) {
    recommendations.push({
      priority: 'high',
      icon: '->',
      text: `Update to latest version. This package has ${pkg.cve_count} known CVE(s) that have been patched.`,
    });
  }

  // High: No security policy
  if (!pkg.has_security_policy) {
    recommendations.push({
      priority: 'medium',
      icon: 'i',
      text: 'No security policy. Vulnerabilities may not have a clear reporting channel.',
    });
  }

  // Medium: No security scanning
  if (!pkg.has_security_tools) {
    recommendations.push({
      priority: 'medium',
      icon: '?',
      text: 'Enable Dependabot alerts in your project to track vulnerabilities in this dependency.',
    });
  }

  // Medium: Stale
  if (daysSinceCommit !== null && daysSinceCommit > 180 && daysSinceCommit <= 365) {
    recommendations.push({
      priority: 'medium',
      icon: '...',
      text: 'Limited recent activity. Pin to a stable version and monitor for updates.',
    });
  }

  // Medium: Bus factor
  const topPct = pkg.top_contributor_pct;
  if (topPct !== null && topPct !== undefined && topPct > 80) {
    recommendations.push({
      priority: 'medium',
      icon: 'i',
      text: 'Single maintainer dependency. Identify alternatives in case of maintainer unavailability.',
    });
  }

  // Low: Version pinning
  if (pkg.version) {
    recommendations.push({
      priority: 'low',
      icon: '#',
      text: `Pin to version ${pkg.version} in lockfiles to ensure reproducible builds.`,
    });
  }

  // Low: Good practices acknowledgment
  if (pkg.has_security_policy && pkg.has_security_tools) {
    recommendations.push({
      priority: 'low',
      icon: 'OK',
      text: 'Good security practices detected. Continue monitoring for updates.',
    });
  }

  return recommendations;
}

function SummaryRecommendationsCard({ pkg }: { pkg: PackageSummary }) {
  const recommendations = getRecommendationsFromSummary(pkg);

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

export function UploadPackageDetail() {
  const { analysisId, packageName } = useParams<{ analysisId: string; packageName: string }>();
  const navigate = useNavigate();
  const [pkg, setPkg] = useState<MatchedDependency | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!analysisId || !packageName) {
      setLoading(false);
      return;
    }

    const storedAnalysis = getStoredAnalysis(analysisId);
    const storedPkg = getStoredPackage(analysisId, packageName);

    setAnalysis(storedAnalysis);
    setPkg(storedPkg);
    setLoading(false);
  }, [analysisId, packageName]);

  if (loading) {
    return (
      <div className="upload-package-detail">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="upload-package-detail">
        <div className="not-found">
          <h2>Analysis Not Found</h2>
          <p>This analysis may have expired or been deleted.</p>
          <button onClick={() => navigate('/upload')} className="back-link">
            ← Back to Upload
          </button>
        </div>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="upload-package-detail">
        <div className="not-found">
          <h2>Package Not Found</h2>
          <p>This package was not found in the analysis.</p>
          <button onClick={() => navigate(`/upload/analysis/${analysisId}`)} className="back-link">
            ← Back to Analysis
          </button>
        </div>
      </div>
    );
  }

  const { parsed, scored, registry, status } = pkg;
  const displayVersion = parsed.version || scored?.version || registry?.version || '-';

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  return (
    <div className="upload-package-detail">
      <button onClick={() => navigate(`/upload/analysis/${analysisId}`)} className="back-link">
        ← Back to {analysis.filename}
      </button>

      <header className="package-header">
        <div className="package-title">
          {scored?.scores?.grade && <GradeBadge grade={scored.scores.grade} size="lg" />}
          <div>
            <h1>{parsed.name}</h1>
            <span className="version">v{displayVersion}</span>
            <span className="ecosystem-badge">{parsed.ecosystem}</span>
            {parsed.isDev && <span className="dev-badge">dev dependency</span>}
          </div>
        </div>
        {scored?.scores && (
          <div className="header-right">
            <div className="overall-score">
              <div className="score-value">{scored.scores.overall?.toFixed(1) ?? '-'}</div>
              <div className="score-label">Overall Score</div>
              {scored.scores.percentile && (
                <div className="score-percentile">
                  Top {(100 - scored.scores.percentile).toFixed(0)}% in ecosystem
                </div>
              )}
            </div>
            {scored.analyzed_at && (
              <div className="last-reviewed">
                <span className="review-label">Analyzed</span>
                <span className="review-time" title={formatDate(scored.analyzed_at)}>
                  {formatRelativeTime(scored.analyzed_at)}
                </span>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Enterprise Indicators */}
      {scored?.scores && (scored.scores.risk_tier || scored.scores.update_urgency || scored.scores.confidence) && (
        <div className="enterprise-indicators">
          {scored.scores.risk_tier && (
            <div className={`indicator risk-tier tier-${scored.scores.risk_tier}`}>
              <span className="indicator-label">Risk Tier</span>
              <span className="indicator-value">{scored.scores.risk_tier}</span>
            </div>
          )}
          {scored.scores.update_urgency && (
            <div className={`indicator update-urgency urgency-${scored.scores.update_urgency}`}>
              <span className="indicator-label">Update Urgency</span>
              <span className="indicator-value">{scored.scores.update_urgency}</span>
            </div>
          )}
          {scored.scores.confidence && (
            <div className={`indicator confidence confidence-${scored.scores.confidence}`}>
              <span className="indicator-label">Confidence</span>
              <span className="indicator-value">{scored.scores.confidence}</span>
            </div>
          )}
          {scored.scores.project_age_band && (
            <div className="indicator age-band">
              <span className="indicator-label">Project Age</span>
              <span className="indicator-value">{scored.scores.project_age_band}</span>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {scored?.description && (
        <p className="description">{scored.description}</p>
      )}

      {/* Data Availability Notice */}
      {scored?.data_availability !== 'available' && scored?.unavailable_reason && (
        <div className="unavailable-notice">
          <strong>Limited Data:</strong> {scored.unavailable_reason}
        </div>
      )}

      {/* Status Banner for unscored packages */}
      {status !== 'scored' && (
        <div className={`status-banner status-${status}`}>
          {status === 'unscored' && (
            <>
              <strong>Not in Database</strong>
              <p>This package is not in our analysis database. It may be new, private, or not yet processed.</p>
            </>
          )}
          {status === 'not_found' && (
            <>
              <strong>Package Not Found</strong>
              <p>This package could not be found in the registry. It may be a typo or a private package.</p>
            </>
          )}
        </div>
      )}

      {/* Critical Issues Banner */}
      {scored && <SummaryCriticalIssuesBanner pkg={scored} />}

      {/* Quick Verdict */}
      {scored && <SummaryQuickVerdict pkg={scored} />}

      {/* Main content grid */}
      {scored?.scores && (
        <div className="detail-grid">
          {/* Recommendations Card */}
          <SummaryRecommendationsCard pkg={scored} />

          {/* Score Breakdown */}
          <section className="card scores-card">
            <h2>Score Breakdown</h2>
            <ScoreBar label="Security" score={scored.scores.security.score} weight={scored.scores.security.weight} />
            <ScoreBar label="Maintenance" score={scored.scores.maintenance.score} weight={scored.scores.maintenance.weight} />
            <ScoreBar label="Community" score={scored.scores.community.score} weight={scored.scores.community.weight} />
            <ScoreBar label="Bus Factor" score={scored.scores.bus_factor.score} weight={scored.scores.bus_factor.weight} />
            <ScoreBar label="Documentation" score={scored.scores.documentation.score} weight={scored.scores.documentation.weight} />
            <ScoreBar label="Stability" score={scored.scores.stability.score} weight={scored.scores.stability.weight} />
          </section>

          {/* Analysis Summary */}
          {scored.analysis_summary && (
            <section className="card summary-card">
              <h2>Analysis Summary</h2>
              {scored.analysis_summary.security_summary && (
                <div className="summary-item">
                  <strong>Security:</strong> {scored.analysis_summary.security_summary}
                </div>
              )}
              {scored.analysis_summary.maintenance_status && (
                <div className="summary-item">
                  <strong>Maintenance:</strong> {scored.analysis_summary.maintenance_status}
                </div>
              )}
              {scored.analysis_summary.doc_summary && (
                <div className="summary-item">
                  <strong>Documentation:</strong> {scored.analysis_summary.doc_summary}
                </div>
              )}
              {scored.analysis_summary.highlights && scored.analysis_summary.highlights.length > 0 && (
                <div className="highlights">
                  <strong>Highlights:</strong>
                  <ul>
                    {scored.analysis_summary.highlights.map((h, i) => (
                      <li key={i} className="highlight-item">{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {scored.analysis_summary.concerns && scored.analysis_summary.concerns.length > 0 && (
                <div className="concerns">
                  <strong>Concerns:</strong>
                  <ul>
                    {scored.analysis_summary.concerns.map((c, i) => (
                      <li key={i} className="concern-item">{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Package Info */}
          <section className="card info-card">
            <h2>Package Info</h2>
            <div className="info-grid">
              {scored.scores.risk_tier && (
                <div className="info-item">
                  <span className="info-label">Risk Tier</span>
                  <span className={`info-value risk-tier ${scored.scores.risk_tier}`}>
                    {scored.scores.risk_tier}
                  </span>
                </div>
              )}
              <div className="info-item">
                <span className="info-label">Last Commit</span>
                <span className="info-value">
                  {scored.last_commit_date
                    ? formatDate(scored.last_commit_date)
                    : '-'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Top Contributor</span>
                <span className="info-value">
                  {scored.top_contributor_pct ? `${scored.top_contributor_pct.toFixed(0)}%` : '-'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Known CVEs</span>
                <span className="info-value">{scored.cve_count ?? 0}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Security Policy</span>
                <span className="info-value">{scored.has_security_policy ? 'Yes' : 'No'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Security Tools</span>
                <span className="info-value">{scored.has_security_tools ? 'Yes' : 'No'}</span>
              </div>
              {scored.repository && (
                <div className="info-item full-width">
                  <span className="info-label">Repository</span>
                  <a
                    href={`https://github.com/${scored.repository.owner}/${scored.repository.repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="info-link"
                  >
                    {scored.repository.owner}/{scored.repository.repo} →
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Risk Badges */}
          <section className="card badges-card">
            <h2>Risk Badges</h2>
            <div className="badges-container">
              <RiskBadges pkg={scored} />
            </div>
          </section>
        </div>
      )}

      {/* Registry Info for Unscored */}
      {status === 'unscored' && registry && (
        <section className="card registry-card">
          <h2>Registry Information</h2>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Version</span>
              <span className="info-value">{registry.version}</span>
            </div>
            {registry.description && (
              <div className="info-item full-width">
                <span className="info-label">Description</span>
                <span className="info-value">{registry.description}</span>
              </div>
            )}
            {registry.license && (
              <div className="info-item">
                <span className="info-label">License</span>
                <span className="info-value">{registry.license}</span>
              </div>
            )}
            {registry.homepage && (
              <div className="info-item">
                <span className="info-label">Homepage</span>
                <a
                  href={registry.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="info-link"
                >
                  View →
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="analysis-footer">
        <p>
          From analysis of <strong>{analysis.filename}</strong> •{' '}
          {new Date(analysis.uploadedAt).toLocaleString()}
        </p>
        <p className="expiration-notice">
          Analysis data expires after 7 days
        </p>
      </footer>
    </div>
  );
}
