import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getStoredAnalysis, getStoredPackage } from '../hooks/useAnalysisStorage';
import { GradeBadge } from '../components/GradeBadge';
import { RiskBadges } from '../components/RiskBadges';
import { ScoreBar } from '../components/ScoreBar';
import type { MatchedDependency, ProjectAnalysis } from '../types/package';

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

  // Calculate risk indicators
  const hasUnpatchedCVEs = scored?.has_unpatched_cves;
  const isProhibited = scored?.scores?.risk_tier === 'prohibited';
  const isRestricted = scored?.scores?.risk_tier === 'restricted';
  const isAbandoned = (() => {
    if (!scored?.last_commit_date) return false;
    const lastCommit = new Date(scored.last_commit_date);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return lastCommit < twoYearsAgo;
  })();
  const hasHighBusFactor = (scored?.top_contributor_pct ?? 0) > 80;

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

      {/* Description */}
      {scored?.description && (
        <p className="description">{scored.description}</p>
      )}

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

      {/* Data Availability Notice */}
      {scored?.data_availability !== 'available' && scored?.unavailable_reason && (
        <div className="unavailable-notice">
          <strong>Limited Data:</strong> {scored.unavailable_reason}
        </div>
      )}

      {/* Status Banner */}
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

      {/* Risk Alerts */}
      {(hasUnpatchedCVEs || isProhibited || isRestricted || isAbandoned || hasHighBusFactor) && (
        <div className="risk-alerts">
          <h2>Risk Indicators</h2>
          <div className="alert-list">
            {hasUnpatchedCVEs && (
              <div className="alert-item danger">
                <span className="alert-icon">!</span>
                <div className="alert-content">
                  <strong>Unpatched CVEs ({scored?.cve_count || 0} known)</strong>
                  <p>This package has known vulnerabilities that haven't been patched.</p>
                </div>
              </div>
            )}
            {isProhibited && (
              <div className="alert-item danger">
                <span className="alert-icon">X</span>
                <div className="alert-content">
                  <strong>Prohibited Package</strong>
                  <p>This package is classified as prohibited and should not be used.</p>
                </div>
              </div>
            )}
            {isRestricted && (
              <div className="alert-item warning">
                <span className="alert-icon">!</span>
                <div className="alert-content">
                  <strong>Restricted Package</strong>
                  <p>This package requires review before use in production.</p>
                </div>
              </div>
            )}
            {isAbandoned && (
              <div className="alert-item warning">
                <span className="alert-icon">...</span>
                <div className="alert-content">
                  <strong>Potentially Abandoned</strong>
                  <p>
                    Last commit was{' '}
                    {scored?.last_commit_date
                      ? formatDate(scored.last_commit_date)
                      : 'unknown'}
                    . Consider alternatives.
                  </p>
                </div>
              </div>
            )}
            {hasHighBusFactor && (
              <div className="alert-item info">
                <span className="alert-icon">i</span>
                <div className="alert-content">
                  <strong>High Bus Factor Risk</strong>
                  <p>
                    {scored?.top_contributor_pct?.toFixed(0)}% of contributions from a single
                    maintainer.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Score Breakdown */}
      {scored?.scores && (
        <div className="detail-grid">
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
