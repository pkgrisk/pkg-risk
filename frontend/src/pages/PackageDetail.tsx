import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { GradeBadge } from '../components/GradeBadge';
import { ScoreBar } from '../components/ScoreBar';
import { CVEList } from '../components/CVEList';
import { ScoreJustification } from '../components/ScoreJustification';
import { CriticalIssuesBanner } from '../components/CriticalIssuesBanner';
import { QuickVerdict } from '../components/QuickVerdict';
import { RecommendationsCard } from '../components/RecommendationsCard';
import { loadPackageFromChunk } from '../utils/chunkLoader';
import type { PackageAnalysis } from '../types/package';

interface PackageDetailProps {
  packages: Map<string, PackageAnalysis>;
  cacheDetail: (key: string, detail: PackageAnalysis) => void;
}

function SkeletonLoading() {
  return (
    <div className="package-detail-loading">
      <div className="skeleton skeleton-back"></div>
      <div className="skeleton-header">
        <div className="skeleton-title-group">
          <div className="skeleton skeleton-grade"></div>
          <div>
            <div className="skeleton skeleton-title"></div>
            <div className="skeleton skeleton-subtitle"></div>
          </div>
        </div>
        <div className="skeleton skeleton-score-box"></div>
      </div>
      <div className="skeleton skeleton-description"></div>
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card"></div>
        <div className="skeleton skeleton-card"></div>
        <div className="skeleton skeleton-card"></div>
        <div className="skeleton skeleton-card"></div>
      </div>
    </div>
  );
}

export function PackageDetail({ packages, cacheDetail }: PackageDetailProps) {
  const { ecosystem, name } = useParams<{ ecosystem: string; name: string }>();
  const cacheKey = `${ecosystem}/${name}`;

  // Check if we have cached data
  const cachedPkg = packages.get(cacheKey);

  const [pkg, setPkg] = useState<PackageAnalysis | null>(cachedPkg || null);
  const [loading, setLoading] = useState(!cachedPkg);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If we already have the data cached, use it
    if (cachedPkg) {
      setPkg(cachedPkg);
      setLoading(false);
      return;
    }

    // Otherwise, fetch it from chunked storage
    async function loadDetail() {
      setLoading(true);
      setError(null);

      try {
        const detail = await loadPackageFromChunk(
          ecosystem!,
          name!,
          import.meta.env.BASE_URL
        );

        if (!detail) {
          setError('not_found');
          setLoading(false);
          return;
        }

        setPkg(detail);
        cacheDetail(cacheKey, detail);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load package');
        setLoading(false);
      }
    }

    loadDetail();
  }, [ecosystem, name, cachedPkg, cacheDetail, cacheKey]);

  if (loading) {
    return <SkeletonLoading />;
  }

  if (error === 'not_found' || !pkg) {
    return (
      <div className="not-found">
        <h2>Package not found</h2>
        <Link to="/">Back to list</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error">
        <h2>Error loading package</h2>
        <p>{error}</p>
        <Link to="/">Back to list</Link>
      </div>
    );
  }

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

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="package-detail">
      <Link to="/" className="back-link">← Back to packages</Link>

      <header className="package-header">
        <div className="package-title">
          {pkg.scores && <GradeBadge grade={pkg.scores.grade} size="lg" />}
          <div>
            <h1>{pkg.name}</h1>
            <span className="version">v{pkg.version}</span>
            <span className="ecosystem-badge">{pkg.ecosystem}</span>
          </div>
        </div>
        <div className="header-right">
          {pkg.scores && (
            <div className="overall-score">
              <div className="score-value">{pkg.scores.overall.toFixed(1)}</div>
              <div className="score-label">Overall Score</div>
              {pkg.scores.percentile && (
                <div className="score-percentile">
                  Top {(100 - pkg.scores.percentile).toFixed(0)}% in ecosystem
                </div>
              )}
            </div>
          )}
          <div className="last-reviewed">
            <span className="review-label">Last reviewed</span>
            <span className="review-time" title={formatDate(pkg.analyzed_at)}>
              {formatRelativeTime(pkg.analyzed_at)}
            </span>
          </div>
        </div>
      </header>

      {pkg.scores && (pkg.scores.risk_tier || pkg.scores.update_urgency || pkg.scores.confidence) && (
        <div className="enterprise-indicators">
          {pkg.scores.risk_tier && (
            <div className={`indicator risk-tier tier-${pkg.scores.risk_tier}`}>
              <span className="indicator-label">Risk Tier</span>
              <span className="indicator-value">{pkg.scores.risk_tier}</span>
            </div>
          )}
          {pkg.scores.update_urgency && (
            <div className={`indicator update-urgency urgency-${pkg.scores.update_urgency}`}>
              <span className="indicator-label">Update Urgency</span>
              <span className="indicator-value">{pkg.scores.update_urgency}</span>
            </div>
          )}
          {pkg.scores.confidence && (
            <div className={`indicator confidence confidence-${pkg.scores.confidence}`}>
              <span className="indicator-label">Confidence</span>
              <span className="indicator-value">{pkg.scores.confidence}</span>
            </div>
          )}
          {pkg.scores.project_age_band && (
            <div className="indicator age-band">
              <span className="indicator-label">Project Age</span>
              <span className="indicator-value">{pkg.scores.project_age_band}</span>
            </div>
          )}
        </div>
      )}

      <p className="description">{pkg.description}</p>

      {pkg.data_availability !== 'available' && (
        <div className="unavailable-notice">
          <strong>Limited Data:</strong> {pkg.unavailable_reason}
        </div>
      )}

      <CriticalIssuesBanner pkg={pkg} />
      <QuickVerdict pkg={pkg} />

      <div className="detail-grid">
        <RecommendationsCard pkg={pkg} />
        {pkg.scores && (
          <section className="card scores-card">
            <h2>Score Breakdown</h2>
            <ScoreBar label="Security" score={pkg.scores.security.score} weight={pkg.scores.security.weight} />
            <ScoreBar label="Maintenance" score={pkg.scores.maintenance.score} weight={pkg.scores.maintenance.weight} />
            <ScoreBar label="Community" score={pkg.scores.community.score} weight={pkg.scores.community.weight} />
            <ScoreBar label="Bus Factor" score={pkg.scores.bus_factor.score} weight={pkg.scores.bus_factor.weight} />
            <ScoreBar label="Documentation" score={pkg.scores.documentation.score} weight={pkg.scores.documentation.weight} />
            <ScoreBar label="Stability" score={pkg.scores.stability.score} weight={pkg.scores.stability.weight} />
          </section>
        )}

        {pkg.github_data && (
          <section className="card repo-card">
            <h2>Repository</h2>
            <div className="repo-stats">
              <div className="stat">
                <span className="stat-value">{formatNumber(pkg.github_data.repo.stars)}</span>
                <span className="stat-label">Stars</span>
              </div>
              <div className="stat">
                <span className="stat-value">{formatNumber(pkg.github_data.repo.forks)}</span>
                <span className="stat-label">Forks</span>
              </div>
              <div className="stat">
                <span className="stat-value">{pkg.github_data.contributors.total_contributors}</span>
                <span className="stat-label">Contributors</span>
              </div>
              <div className="stat">
                <span className="stat-value">{pkg.github_data.issues.open_issues}</span>
                <span className="stat-label">Open Issues</span>
              </div>
            </div>
            <div className="repo-meta">
              <p><strong>Language:</strong> {pkg.github_data.repo.language}</p>
              <p><strong>License:</strong> {pkg.github_data.repo.license || 'Unknown'}</p>
              <p><strong>Last Commit:</strong> {formatDate(pkg.github_data.commits.last_commit_date)}</p>
              <p><strong>Created:</strong> {formatDate(pkg.github_data.repo.created_at)}</p>
            </div>
            {pkg.repository && (
              <a
                href={`https://github.com/${pkg.repository.owner}/${pkg.repository.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="github-link"
              >
                View on GitHub →
              </a>
            )}
          </section>
        )}

        {pkg.analysis_summary && (
          <section className="card summary-card">
            <h2>Analysis Summary</h2>
            {pkg.analysis_summary.security_summary && (
              <div className="summary-item">
                <strong>Security:</strong> {pkg.analysis_summary.security_summary}
              </div>
            )}
            {pkg.analysis_summary.doc_summary && (
              <div className="summary-item">
                <strong>Documentation:</strong> {pkg.analysis_summary.doc_summary}
              </div>
            )}
            {pkg.analysis_summary.highlights && pkg.analysis_summary.highlights.length > 0 && (
              <div className="highlights">
                <strong>Highlights:</strong>
                <ul>
                  {pkg.analysis_summary.highlights.map((h, i) => (
                    <li key={i} className="highlight-item">{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {pkg.analysis_summary.concerns && pkg.analysis_summary.concerns.length > 0 && (
              <div className="concerns">
                <strong>Concerns:</strong>
                <ul>
                  {pkg.analysis_summary.concerns.map((c, i) => (
                    <li key={i} className="concern-item">{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {pkg.github_data && (
          <section className="card activity-card">
            <h2>Activity</h2>
            <div className="activity-stats">
              <div className="activity-item">
                <span className="activity-value">{pkg.github_data.commits.commits_last_6mo}</span>
                <span className="activity-label">Commits (6mo)</span>
              </div>
              <div className="activity-item">
                <span className="activity-value">{pkg.github_data.prs.merged_prs_6mo}</span>
                <span className="activity-label">PRs Merged (6mo)</span>
              </div>
              <div className="activity-item">
                <span className="activity-value">{pkg.github_data.issues.closed_issues_6mo}</span>
                <span className="activity-label">Issues Closed (6mo)</span>
              </div>
              <div className="activity-item">
                <span className="activity-value">{pkg.github_data.releases.releases_last_year}</span>
                <span className="activity-label">Releases (1yr)</span>
              </div>
            </div>
          </section>
        )}

        {pkg.github_data?.security && (
          <section className="card security-card">
            <h2>Security Practices</h2>
            <div className="security-items">
              <div className={`security-item ${pkg.github_data.security.has_security_md ? 'positive' : 'negative'}`}>
                {pkg.github_data.security.has_security_md ? '✓' : '✗'} SECURITY.md
              </div>
              <div className={`security-item ${pkg.github_data.security.has_dependabot ? 'positive' : 'negative'}`}>
                {pkg.github_data.security.has_dependabot ? '✓' : '✗'} Dependabot
              </div>
              <div className={`security-item ${pkg.github_data.security.has_codeql ? 'positive' : 'negative'}`}>
                {pkg.github_data.security.has_codeql ? '✓' : '✗'} CodeQL
              </div>
            </div>
          </section>
        )}

        {pkg.github_data?.security?.cve_history && (
          <section className="card cve-card">
            <CVEList cveHistory={pkg.github_data.security.cve_history} />
          </section>
        )}

        {pkg.llm_assessments?.readme && (
          <section className="card readme-card">
            <h2>Documentation Quality (LLM Analysis)</h2>
            <p className="llm-summary">{pkg.llm_assessments.readme.summary}</p>
            <div className="readme-scores">
              <ScoreBar label="Clarity" score={pkg.llm_assessments.readme.clarity * 10} weight={0} showWeight={false} />
              <ScoreBar label="Installation" score={pkg.llm_assessments.readme.installation * 10} weight={0} showWeight={false} />
              <ScoreBar label="Quick Start" score={pkg.llm_assessments.readme.quick_start * 10} weight={0} showWeight={false} />
              <ScoreBar label="Examples" score={pkg.llm_assessments.readme.examples * 10} weight={0} showWeight={false} />
              <ScoreBar label="Configuration" score={pkg.llm_assessments.readme.configuration * 10} weight={0} showWeight={false} />
              <ScoreBar label="Troubleshooting" score={pkg.llm_assessments.readme.troubleshooting * 10} weight={0} showWeight={false} />
            </div>
            {pkg.llm_assessments.readme.top_issue && (
              <div className="top-issue">
                <strong>Top Issue:</strong> {pkg.llm_assessments.readme.top_issue}
              </div>
            )}
          </section>
        )}

        {pkg.llm_assessments?.maintenance && (
          <section className="card maintenance-card">
            <h2>Maintenance Status (LLM Analysis)</h2>
            <div className={`maintenance-status status-${pkg.llm_assessments.maintenance.status}`}>
              {pkg.llm_assessments.maintenance.status.replace('-', ' ')}
            </div>
            <p>{pkg.llm_assessments.maintenance.summary}</p>
            {pkg.llm_assessments.maintenance.positive_signals.length > 0 && (
              <div className="signals positive">
                <strong>Positive Signals:</strong>
                <ul>
                  {pkg.llm_assessments.maintenance.positive_signals.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {pkg.llm_assessments.maintenance.concerns.length > 0 && (
              <div className="signals negative">
                <strong>Concerns:</strong>
                <ul>
                  {pkg.llm_assessments.maintenance.concerns.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>

      {pkg.scores && (
        <ScoreJustification pkg={pkg} />
      )}

      <footer className="analysis-footer">
        <p>Analyzed: {formatDate(pkg.analyzed_at)}</p>
      </footer>
    </div>
  );
}
