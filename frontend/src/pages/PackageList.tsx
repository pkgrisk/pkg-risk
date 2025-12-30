import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { GradeBadge } from '../components/GradeBadge';
import { RiskBadges } from '../components/RiskBadges';
import type { PackageSummary, Grade } from '../types/package';

interface PackageListProps {
  packages: PackageSummary[];
  ecosystem: string;
}

type SortKey = 'name' | 'score' | 'installs';
type SecurityFilter = 'all' | 'has_cves' | 'has_unpatched' | 'no_policy' | 'no_tools';
type MaintenanceFilter = 'all' | 'active' | 'stale' | 'abandoned';

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

export function PackageList({ packages, ecosystem }: PackageListProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('installs');
  const [sortAsc, setSortAsc] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all'>('all');
  const [securityFilter, setSecurityFilter] = useState<SecurityFilter>('all');
  const [maintenanceFilter, setMaintenanceFilter] = useState<MaintenanceFilter>('all');
  const [showUnscored, setShowUnscored] = useState(false);

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
        case 'installs':
          cmp = (a.install_count_30d ?? 0) - (b.install_count_30d ?? 0);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return result;
  }, [packages, search, sortKey, sortAsc, gradeFilter, securityFilter, maintenanceFilter, showUnscored]);

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

  return (
    <div>
      <div className="filters">
        <input
          type="text"
          placeholder="Search packages..."
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
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={showUnscored}
            onChange={(e) => setShowUnscored(e.target.checked)}
          />
          Show unscored packages
        </label>
      </div>

      <div className="stats-row">
        <span>
          {filteredAndSorted.length} packages
          {!showUnscored && (
            <span className="hidden-count">
              {' '}({packages.filter((p) => p.scores === null).length} hidden)
            </span>
          )}
        </span>
        <span>
          {filteredAndSorted.filter((p) => p.scores !== null).length} with scores
        </span>
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
          </tr>
        </thead>
        <tbody>
          {filteredAndSorted.map((pkg) => (
            <tr key={pkg.name}>
              <td>
                {pkg.scores ? (
                  <GradeBadge grade={pkg.scores.grade} size="sm" />
                ) : (
                  <span className="no-score-warning" title={getUnavailableTooltip(pkg)}>
                    ⚠
                  </span>
                )}
              </td>
              <td>
                <Link to={`/${ecosystem}/${pkg.name}`} className="package-link">
                  <strong>{pkg.name}</strong>
                  <span className="version">v{pkg.version}</span>
                </Link>
                <div className="description">{pkg.description}</div>
              </td>
              <td className="score-cell">
                {pkg.scores ? (
                  <span className="score">{pkg.scores.overall.toFixed(1)}</span>
                ) : (
                  <span className="unavailable">N/A</span>
                )}
              </td>
              <td className="issues-cell">
                <RiskBadges pkg={pkg} />
              </td>
              <td className="commit-cell">
                {formatRelativeTime(pkg.last_commit_date)}
              </td>
              <td>{formatInstalls(pkg.install_count_30d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
