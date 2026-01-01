import { useParams, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getStoredAnalysis, getStoredPackage } from '../hooks/useAnalysisStorage';
import { GradeBadge } from '../components/GradeBadge';
import { RiskBadges } from '../components/RiskBadges';
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
          <Link to="/upload" className="back-link">← Back to Upload</Link>
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
          <button onClick={() => navigate(-1)} className="back-link">← Back to Analysis</button>
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

  return (
    <div className="upload-package-detail">
      <button onClick={() => navigate(-1)} className="back-link">
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
            </div>
          </div>
        )}
      </header>

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
                  <strong>Unpatched CVEs</strong>
                  <p>This package has known vulnerabilities that haven't been patched.</p>
                </div>
              </div>
            )}
            {isProhibited && (
              <div className="alert-item danger">
                <span className="alert-icon">⛔</span>
                <div className="alert-content">
                  <strong>Prohibited Package</strong>
                  <p>This package is classified as prohibited and should not be used.</p>
                </div>
              </div>
            )}
            {isRestricted && (
              <div className="alert-item warning">
                <span className="alert-icon">⚠</span>
                <div className="alert-content">
                  <strong>Restricted Package</strong>
                  <p>This package requires review before use in production.</p>
                </div>
              </div>
            )}
            {isAbandoned && (
              <div className="alert-item warning">
                <span className="alert-icon">⏰</span>
                <div className="alert-content">
                  <strong>Potentially Abandoned</strong>
                  <p>
                    Last commit was{' '}
                    {scored?.last_commit_date
                      ? new Date(scored.last_commit_date).toLocaleDateString()
                      : 'unknown'}
                    . Consider alternatives.
                  </p>
                </div>
              </div>
            )}
            {hasHighBusFactor && (
              <div className="alert-item info">
                <span className="alert-icon">👤</span>
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
            <div className="score-bars">
              <ScoreBarSimple label="Security" value={scored.scores.security?.score} />
              <ScoreBarSimple label="Maintenance" value={scored.scores.maintenance?.score} />
              <ScoreBarSimple label="Community" value={scored.scores.community?.score} />
              <ScoreBarSimple label="Bus Factor" value={scored.scores.bus_factor?.score} />
            </div>
          </section>

          <section className="card info-card">
            <h2>Package Info</h2>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Risk Tier</span>
                <span className={`info-value risk-tier ${scored.scores.risk_tier}`}>
                  {scored.scores.risk_tier || '-'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Last Commit</span>
                <span className="info-value">
                  {scored.last_commit_date
                    ? new Date(scored.last_commit_date).toLocaleDateString()
                    : '-'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Top Contributor</span>
                <span className="info-value">
                  {scored.top_contributor_pct ? `${scored.top_contributor_pct.toFixed(0)}%` : '-'}
                </span>
              </div>
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

interface ScoreBarSimpleProps {
  label: string;
  value?: number;
}

function ScoreBarSimple({ label, value }: ScoreBarSimpleProps) {
  const percentage = value ?? 0;
  const color =
    percentage >= 80
      ? '#22c55e'
      : percentage >= 60
        ? '#84cc16'
        : percentage >= 40
          ? '#eab308'
          : percentage >= 20
            ? '#f97316'
            : '#ef4444';

  return (
    <div className="score-bar-simple">
      <div className="score-bar-header">
        <span className="score-bar-label">{label}</span>
        <span className="score-bar-value">{value?.toFixed(0) ?? '-'}</span>
      </div>
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
