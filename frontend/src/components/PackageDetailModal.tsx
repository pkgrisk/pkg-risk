import { useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { MatchedDependency } from '../types/package';
import { GradeBadge } from './GradeBadge';
import { RiskBadges } from './RiskBadges';

interface PackageDetailModalProps {
  dependency: MatchedDependency;
  ecosystem: string;
  onClose: () => void;
}

export function PackageDetailModal({ dependency, ecosystem, onClose }: PackageDetailModalProps) {
  const { parsed, scored, registry, status } = dependency;

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const displayVersion = parsed.version || scored?.version || registry?.version || '-';
  const packageLink = status === 'scored' ? `/${ecosystem}/${parsed.name}` : null;

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
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="package-detail-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="modal-header">
          <div className="modal-title-section">
            <h2>{parsed.name}</h2>
            {parsed.isDev && <span className="dev-badge">dev dependency</span>}
          </div>
          <div className="modal-meta">
            <span className="version">v{displayVersion}</span>
            <span className="ecosystem-tag">{ecosystem}</span>
          </div>
        </div>

        {status === 'scored' && scored && (
          <>
            <div className="modal-score-section">
              <div className="score-overview">
                <div className="overall-score">
                  <span className="score-value">{scored.scores?.overall?.toFixed(1) ?? '-'}</span>
                  <span className="score-label">Overall Score</span>
                </div>
                <div className="grade-display">
                  {scored.scores?.grade && <GradeBadge grade={scored.scores.grade} size="lg" />}
                </div>
              </div>

              <div className="score-breakdown">
                <h3>Score Components</h3>
                <div className="score-components">
                  <ScoreBar label="Security" value={scored.scores?.security?.score} />
                  <ScoreBar label="Maintenance" value={scored.scores?.maintenance?.score} />
                  <ScoreBar label="Community" value={scored.scores?.community?.score} />
                  <ScoreBar label="Bus Factor" value={scored.scores?.bus_factor?.score} />
                </div>
              </div>
            </div>

            {(hasUnpatchedCVEs || isProhibited || isRestricted || isAbandoned || hasHighBusFactor) && (
              <div className="modal-alerts">
                <h3>Risk Indicators</h3>
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
                          {scored.last_commit_date
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
                          {scored.top_contributor_pct?.toFixed(0)}% of contributions from a single
                          maintainer.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="modal-details">
              <h3>Package Details</h3>
              <div className="details-grid">
                <div className="detail-item">
                  <span className="detail-label">Risk Tier</span>
                  <span className={`detail-value risk-tier ${scored.scores?.risk_tier}`}>
                    {scored.scores?.risk_tier || '-'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Last Commit</span>
                  <span className="detail-value">
                    {scored.last_commit_date
                      ? new Date(scored.last_commit_date).toLocaleDateString()
                      : '-'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Top Contributor</span>
                  <span className="detail-value">
                    {scored.top_contributor_pct ? `${scored.top_contributor_pct.toFixed(0)}%` : '-'}
                  </span>
                </div>
              </div>
            </div>

            <div className="modal-badges">
              <RiskBadges pkg={scored} />
            </div>
          </>
        )}

        {status === 'unscored' && (
          <div className="modal-unscored">
            <div className="unscored-icon">?</div>
            <h3>Package Not Analyzed</h3>
            <p>
              This package is not in our analysis database. It may be new, private, or not yet
              processed.
            </p>
            {registry && (
              <div className="registry-info">
                <p>Registry information available:</p>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Version</span>
                    <span className="detail-value">{registry.version}</span>
                  </div>
                  {registry.homepage && (
                    <div className="detail-item">
                      <span className="detail-label">Homepage</span>
                      <a
                        href={registry.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="detail-value link"
                      >
                        View
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {status === 'not_found' && (
          <div className="modal-not-found">
            <div className="not-found-icon">✗</div>
            <h3>Package Not Found</h3>
            <p>
              This package could not be found in the registry. It may be a private package, typo, or
              removed from the registry.
            </p>
          </div>
        )}

        <div className="modal-actions">
          {packageLink && (
            <Link to={packageLink} className="btn btn-primary">
              View Full Details
            </Link>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface ScoreBarProps {
  label: string;
  value?: number;
}

function ScoreBar({ label, value }: ScoreBarProps) {
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
    <div className="score-bar-item">
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
