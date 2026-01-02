import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GradeBadge } from '../components/GradeBadge';
import { RiskBadges } from '../components/RiskBadges';
import { RowActions } from '../components/RowActions';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import type { PackageSummary, Grade, RiskTier, EcosystemStats } from '../types/package';

type PageSize = 20 | 50 | 100;

interface PackageListProps {
  packages: PackageSummary[];
  ecosystem: string;
  stats: EcosystemStats | null;
}

type SortKey = 'name' | 'score' | 'installs' | 'percentile';
type SecurityFilter = 'all' | 'has_cves' | 'has_unpatched' | 'no_policy' | 'no_tools';
type MaintenanceFilter = 'all' | 'active' | 'stale' | 'abandoned';
type RiskTierFilter = 'all' | RiskTier;

function getDaysSinceCommit(lastCommitDate: string | null): number | null {
  if (!lastCommitDate) return null;
  const lastCommit = new Date(lastCommitDate);
  const now = new Date();
  return Math.floor((now.getTime() - lastCommit.getTime()) / (1000 * 60 * 60 * 24));
}

function getUnavailableTooltip(pkg: PackageSummary): string {
  const reasons: Record<string, string> = {
    'no_repo': 'No repository linked to this package',
    'repo_not_found': 'Repository could not be found',
    'private_repo': 'Repository is private',
    'not_github': 'Non-GitHub repository (analysis not supported)',
  };

  const base = reasons[pkg.data_availability] || 'Score unavailable';
  return pkg.unavailable_reason ? `${base}: ${pkg.unavailable_reason}` : base;
}

export function PackageList({ packages, ecosystem, stats }: PackageListProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('installs');
  const [sortAsc, setSortAsc] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all'>('all');
  const [securityFilter, setSecurityFilter] = useState<SecurityFilter>('all');
  const [maintenanceFilter, setMaintenanceFilter] = useState<MaintenanceFilter>('all');
  const [riskTierFilter, setRiskTierFilter] = useState<RiskTierFilter>('all');
  const [showUnscored, setShowUnscored] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredAndSorted = useMemo(() => {
    let result = [...packages];

    // Search filter
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          p.description?.toLowerCase().includes(lower)
      );
    }

    // Grade filter
    if (gradeFilter !== 'all') {
      result = result.filter((p) => p.scores?.grade === gradeFilter);
    }

    // Security filter
    if (securityFilter !== 'all') {
      result = result.filter((p) => {
        switch (securityFilter) {
          case 'has_cves':
            return p.cve_count > 0;
          case 'has_unpatched':
            return p.has_unpatched_cves;
          case 'no_policy':
            return p.scores && !p.has_security_policy;
          case 'no_tools':
            return p.scores && !p.has_security_tools;
          default:
            return true;
        }
      });
    }

    // Maintenance filter
    if (maintenanceFilter !== 'all') {
      result = result.filter((p) => {
        const days = getDaysSinceCommit(p.last_commit_date);
        if (days === null) return false;
        switch (maintenanceFilter) {
          case 'active':
            return days <= 90;
          case 'stale':
            return days > 180 && days <= 365;
          case 'abandoned':
            return days > 365;
          default:
            return true;
        }
      });
    }

    // Risk tier filter
    if (riskTierFilter !== 'all') {
      result = result.filter((p) => p.risk_tier === riskTierFilter);
    }

    // Hide unscored packages unless toggled on
    if (!showUnscored) {
      result = result.filter((p) => p.scores !== null);
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'score':
          cmp = (a.scores?.overall ?? -1) - (b.scores?.overall ?? -1);
          break;
        case 'percentile':
          cmp = (a.scores?.percentile ?? -1) - (b.scores?.percentile ?? -1);
          break;
        case 'installs':
          cmp = (a.install_count_30d ?? 0) - (b.install_count_30d ?? 0);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return result;
  }, [packages, search, sortKey, sortAsc, gradeFilter, securityFilter, maintenanceFilter, riskTierFilter, showUnscored]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, gradeFilter, securityFilter, maintenanceFilter, riskTierFilter, showUnscored]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredAndSorted.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = filteredAndSorted.slice(startIndex, endIndex);

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('ellipsis');

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) pages.push(i);

      if (currentPage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const formatInstalls = (count: number | null) => {
    if (count === null) return '-';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const formatRelativeTime = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  const handleNavigate = useCallback(
    (index: number) => {
      const pkg = paginatedResults[index];
      if (pkg) {
        navigate(`/${ecosystem}/${pkg.name}`);
      }
    },
    [paginatedResults, ecosystem, navigate]
  );

  const handleEscape = useCallback(() => {
    setSearch('');
    setSelectedIndex(-1);
  }, []);

  useKeyboardNavigation({
    itemCount: paginatedResults.length,
    selectedIndex,
    onSelect: setSelectedIndex,
    onEnter: handleNavigate,
    searchInputRef,
    onEscape: handleEscape,
  });

  return (
    <div>
      {stats && (
        <div className="ecosystem-stats">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.scored_packages}</div>
              <div className="stat-label">Scored Packages</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.score_distribution.median.toFixed(0)}</div>
              <div className="stat-label">Median Score</div>
            </div>
            <div className="stat-card grade-dist">
              <div className="grade-bars">
                <div
                  className={`grade-bar grade-a${gradeFilter === 'A' ? ' active' : ''}`}
                  style={{ flexGrow: stats.grade_distribution.A }}
                  onClick={() => setGradeFilter(gradeFilter === 'A' ? 'all' : 'A')}
                  title={`${stats.grade_distribution.A} packages with Grade A - Click to filter`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setGradeFilter(gradeFilter === 'A' ? 'all' : 'A')}
                >
                  <span className="grade-count">{stats.grade_distribution.A} A</span>
                </div>
                <div
                  className={`grade-bar grade-b${gradeFilter === 'B' ? ' active' : ''}`}
                  style={{ flexGrow: stats.grade_distribution.B }}
                  onClick={() => setGradeFilter(gradeFilter === 'B' ? 'all' : 'B')}
                  title={`${stats.grade_distribution.B} packages with Grade B - Click to filter`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setGradeFilter(gradeFilter === 'B' ? 'all' : 'B')}
                >
                  <span className="grade-count">{stats.grade_distribution.B} B</span>
                </div>
                <div
                  className={`grade-bar grade-c${gradeFilter === 'C' ? ' active' : ''}`}
                  style={{ flexGrow: stats.grade_distribution.C }}
                  onClick={() => setGradeFilter(gradeFilter === 'C' ? 'all' : 'C')}
                  title={`${stats.grade_distribution.C} packages with Grade C - Click to filter`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setGradeFilter(gradeFilter === 'C' ? 'all' : 'C')}
                >
                  <span className="grade-count">{stats.grade_distribution.C} C</span>
                </div>
                <div
                  className={`grade-bar grade-d${gradeFilter === 'D' ? ' active' : ''}`}
                  style={{ flexGrow: stats.grade_distribution.D }}
                  onClick={() => setGradeFilter(gradeFilter === 'D' ? 'all' : 'D')}
                  title={`${stats.grade_distribution.D} packages with Grade D - Click to filter`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setGradeFilter(gradeFilter === 'D' ? 'all' : 'D')}
                >
                  <span className="grade-count">{stats.grade_distribution.D} D</span>
                </div>
                <div
                  className={`grade-bar grade-f${gradeFilter === 'F' ? ' active' : ''}`}
                  style={{ flexGrow: stats.grade_distribution.F }}
                  onClick={() => setGradeFilter(gradeFilter === 'F' ? 'all' : 'F')}
                  title={`${stats.grade_distribution.F} packages with Grade F - Click to filter`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setGradeFilter(gradeFilter === 'F' ? 'all' : 'F')}
                >
                  <span className="grade-count">{stats.grade_distribution.F} F</span>
                </div>
              </div>
              <div className="stat-label">Grade Distribution</div>
            </div>
            <div className="stat-card">
              <div className="stat-value range">
                {stats.score_distribution.min.toFixed(0)} - {stats.score_distribution.max.toFixed(0)}
              </div>
              <div className="stat-label">Score Range</div>
            </div>
          </div>
        </div>
      )}

      <div className="filters">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search packages... (press / to focus)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value as Grade | 'all')}
          className="grade-filter"
        >
          <option value="all">All Grades</option>
          <option value="A">Grade A</option>
          <option value="B">Grade B</option>
          <option value="C">Grade C</option>
          <option value="D">Grade D</option>
          <option value="F">Grade F</option>
        </select>
        <select
          value={securityFilter}
          onChange={(e) => setSecurityFilter(e.target.value as SecurityFilter)}
          className="security-filter"
        >
          <option value="all">All Security</option>
          <option value="has_cves">Has CVEs</option>
          <option value="has_unpatched">Unpatched CVEs</option>
          <option value="no_policy">No Security Policy</option>
          <option value="no_tools">No Security Tools</option>
        </select>
        <select
          value={maintenanceFilter}
          onChange={(e) => setMaintenanceFilter(e.target.value as MaintenanceFilter)}
          className="maintenance-filter"
        >
          <option value="all">All Maintenance</option>
          <option value="active">Active (&lt;3 months)</option>
          <option value="stale">Stale (6-12 months)</option>
          <option value="abandoned">Abandoned (&gt;1 year)</option>
        </select>
        <select
          value={riskTierFilter}
          onChange={(e) => setRiskTierFilter(e.target.value as RiskTierFilter)}
          className="risk-tier-filter"
        >
          <option value="all">All Risk Tiers</option>
          <option value="approved">✓ Approved</option>
          <option value="conditional">⚠ Conditional</option>
          <option value="restricted">✗ Restricted</option>
          <option value="prohibited">⛔ Prohibited</option>
        </select>
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={showUnscored}
            onChange={(e) => setShowUnscored(e.target.checked)}
          />
          Show unscored packages
        </label>
      </div>

      <div className="results-summary">
        <span className="results-count">
          Showing <strong>{filteredAndSorted.length.toLocaleString()}</strong> of{' '}
          <strong>{packages.length.toLocaleString()}</strong> packages
        </span>
        {!showUnscored && packages.filter((p) => p.scores === null).length > 0 && (
          <span className="results-detail">
            {packages.filter((p) => p.scores === null).length.toLocaleString()} unscored hidden
          </span>
        )}
        {showUnscored && (
          <span className="results-detail">
            {filteredAndSorted.filter((p) => p.scores !== null).length.toLocaleString()} scored
            {filteredAndSorted.filter((p) => p.scores === null).length > 0 && (
              <>, {filteredAndSorted.filter((p) => p.scores === null).length.toLocaleString()} unscored</>
            )}
          </span>
        )}
      </div>

      <table className="package-table">
        <thead>
          <tr>
            <th>Grade</th>
            <th onClick={() => handleSort('name')} className="sortable">
              Package {sortKey === 'name' && (sortAsc ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('score')} className="sortable">
              Score {sortKey === 'score' && (sortAsc ? '↑' : '↓')}
            </th>
            <th>Issues</th>
            <th>Last Commit</th>
            <th onClick={() => handleSort('installs')} className="sortable">
              Installs/30d {sortKey === 'installs' && (sortAsc ? '↑' : '↓')}
            </th>
            <th className="actions-header"></th>
          </tr>
        </thead>
        <tbody>
          {paginatedResults.map((pkg, index) => (
            <tr
              key={pkg.name}
              className={index === selectedIndex ? 'selected' : ''}
              onClick={() => navigate(`/${ecosystem}/${pkg.name}`)}
            >
              <td data-label="Grade">
                {pkg.scores ? (
                  <GradeBadge grade={pkg.scores.grade} size="sm" />
                ) : (
                  <span className="no-score-warning" title={getUnavailableTooltip(pkg)}>
                    ⚠
                  </span>
                )}
              </td>
              <td data-label="Package">
                <Link to={`/${ecosystem}/${pkg.name}`} className="package-link">
                  <strong className="package-name">{pkg.name}</strong>
                  <span className="version">v{pkg.version}</span>
                </Link>
                <div className="description">{pkg.description}</div>
              </td>
              <td data-label="Score" className="score-cell">
                {pkg.scores ? (
                  <div className="score-with-percentile">
                    <span className="score">{pkg.scores.overall.toFixed(1)}</span>
                    {pkg.scores.percentile && (
                      <span className="percentile" title="Percentile within ecosystem">
                        Top {(100 - pkg.scores.percentile).toFixed(0)}%
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="unavailable">N/A</span>
                )}
              </td>
              <td data-label="Issues" className="issues-cell">
                <RiskBadges pkg={pkg} />
              </td>
              <td data-label="Last Commit" className="commit-cell">
                {formatRelativeTime(pkg.last_commit_date)}
              </td>
              <td data-label="Installs/30d">{formatInstalls(pkg.install_count_30d)}</td>
              <td data-label="" className="actions-cell">
                <RowActions pkg={pkg} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <div className="pagination-info">
            Showing {startIndex + 1}–{Math.min(endIndex, filteredAndSorted.length)} of{' '}
            {filteredAndSorted.length.toLocaleString()}
          </div>

          <div className="pagination-controls">
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              title="First page"
            >
              ««
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              title="Previous page"
            >
              «
            </button>

            <div className="pagination-pages">
              {getPageNumbers().map((page, i) =>
                page === 'ellipsis' ? (
                  <span key={`ellipsis-${i}`} className="pagination-ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`pagination-page ${currentPage === page ? 'active' : ''}`}
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </button>
                )
              )}
            </div>

            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              title="Next page"
            >
              »
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              title="Last page"
            >
              »»
            </button>
          </div>

          <div className="pagination-size">
            <label>
              Per page:
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) as PageSize);
                  setCurrentPage(1);
                }}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
