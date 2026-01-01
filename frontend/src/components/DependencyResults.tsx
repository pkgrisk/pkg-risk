import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MatchedDependency, Grade, RiskTier } from '../types/package';
import { GradeBadge } from './GradeBadge';
import { RiskBadges } from './RiskBadges';

type SortField = 'name' | 'score' | 'grade' | 'status';
type SortDirection = 'asc' | 'desc';

type FilterStatus = 'all' | 'scored' | 'unscored' | 'not_found';
type FilterGrade = 'all' | Grade;
type FilterRisk = 'all' | RiskTier;
export type QuickFilter = 'all' | 'needs_action' | 'has_cves' | 'prohibited' | 'outdated' | 'unscored';

interface DependencyResultsProps {
  dependencies: MatchedDependency[];
  analysisId: string;
  initialSearchQuery?: string;
  initialQuickFilter?: QuickFilter;
}

export function DependencyResults({ dependencies, analysisId, initialSearchQuery = '', initialQuickFilter = 'all' }: DependencyResultsProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterGrade, setFilterGrade] = useState<FilterGrade>('all');
  const [filterRisk, setFilterRisk] = useState<FilterRisk>('all');
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [showDevDeps, setShowDevDeps] = useState(true);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialQuickFilter);

  // Update search query when initialSearchQuery changes (from action items click)
  useEffect(() => {
    if (initialSearchQuery) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Update quick filter when initialQuickFilter changes (from summary click)
  useEffect(() => {
    setQuickFilter(initialQuickFilter);
  }, [initialQuickFilter]);

  // Calculate counts for quick filters
  const quickFilterCounts = useMemo(() => {
    const needsAction = dependencies.filter(
      (d) =>
        d.scored?.has_unpatched_cves ||
        d.scored?.scores?.risk_tier === 'prohibited' ||
        d.scored?.scores?.risk_tier === 'restricted'
    ).length;
    const hasCVEs = dependencies.filter((d) => d.scored?.has_unpatched_cves).length;
    const prohibited = dependencies.filter(
      (d) => d.scored?.scores?.risk_tier === 'prohibited'
    ).length;
    const outdated = dependencies.filter((d) => {
      if (!d.scored?.last_commit_date) return false;
      const lastCommit = new Date(d.scored.last_commit_date);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      return lastCommit < twoYearsAgo;
    }).length;
    const unscored = dependencies.filter(
      (d) => d.status === 'unscored' || d.status === 'not_found'
    ).length;

    return { needsAction, hasCVEs, prohibited, outdated, unscored };
  }, [dependencies]);

  // Handle quick filter changes - reset other filters when quick filter is used
  const handleQuickFilter = (filter: QuickFilter) => {
    setQuickFilter(filter);
    // Reset detailed filters when using quick filter
    if (filter !== 'all') {
      setFilterStatus('all');
      setFilterGrade('all');
      setFilterRisk('all');
    }
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...dependencies];

    // Filter by dev deps
    if (!showDevDeps) {
      result = result.filter((d) => !d.parsed.isDev);
    }

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((d) => d.parsed.name.toLowerCase().includes(query));
    }

    // Apply quick filter
    if (quickFilter !== 'all') {
      switch (quickFilter) {
        case 'needs_action':
          result = result.filter(
            (d) =>
              d.scored?.has_unpatched_cves ||
              d.scored?.scores?.risk_tier === 'prohibited' ||
              d.scored?.scores?.risk_tier === 'restricted'
          );
          break;
        case 'has_cves':
          result = result.filter((d) => d.scored?.has_unpatched_cves);
          break;
        case 'prohibited':
          result = result.filter(
            (d) => d.scored?.scores?.risk_tier === 'prohibited'
          );
          break;
        case 'outdated':
          result = result.filter((d) => {
            if (!d.scored?.last_commit_date) return false;
            const lastCommit = new Date(d.scored.last_commit_date);
            const twoYearsAgo = new Date();
            twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
            return lastCommit < twoYearsAgo;
          });
          break;
        case 'unscored':
          result = result.filter(
            (d) => d.status === 'unscored' || d.status === 'not_found'
          );
          break;
      }
    }

    // Filter by status (only if quick filter is 'all')
    if (quickFilter === 'all' && filterStatus !== 'all') {
      result = result.filter((d) => d.status === filterStatus);
    }

    // Filter by grade (only if quick filter is 'all')
    if (quickFilter === 'all' && filterGrade !== 'all') {
      result = result.filter((d) => d.scored?.scores?.grade === filterGrade);
    }

    // Filter by risk tier (only if quick filter is 'all')
    if (quickFilter === 'all' && filterRisk !== 'all') {
      result = result.filter((d) => d.scored?.scores?.risk_tier === filterRisk);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = a.parsed.name.localeCompare(b.parsed.name);
          break;
        case 'score':
          const scoreA = a.scored?.scores?.overall ?? -1;
          const scoreB = b.scored?.scores?.overall ?? -1;
          comparison = scoreA - scoreB;
          break;
        case 'grade': {
          const gradeOrder: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
          const gradeA = a.scored?.scores?.grade ? gradeOrder[a.scored.scores.grade] : 0;
          const gradeB = b.scored?.scores?.grade ? gradeOrder[b.scored.scores.grade] : 0;
          comparison = gradeA - gradeB;
          break;
        }
        case 'status': {
          const statusOrder = { scored: 3, unscored: 2, not_found: 1, loading: 0 };
          comparison = statusOrder[a.status] - statusOrder[b.status];
          break;
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [dependencies, sortField, sortDirection, filterStatus, filterGrade, filterRisk, searchQuery, showDevDeps, quickFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  const devCount = dependencies.filter((d) => d.parsed.isDev).length;

  return (
    <div className="dependency-results">
      <div className="quick-filters">
        <button
          className={`quick-filter-chip ${quickFilter === 'all' ? 'active' : ''}`}
          onClick={() => handleQuickFilter('all')}
        >
          All ({dependencies.length})
        </button>
        {quickFilterCounts.needsAction > 0 && (
          <button
            className={`quick-filter-chip danger ${quickFilter === 'needs_action' ? 'active' : ''}`}
            onClick={() => handleQuickFilter('needs_action')}
          >
            Needs Action ({quickFilterCounts.needsAction})
          </button>
        )}
        {quickFilterCounts.hasCVEs > 0 && (
          <button
            className={`quick-filter-chip danger ${quickFilter === 'has_cves' ? 'active' : ''}`}
            onClick={() => handleQuickFilter('has_cves')}
          >
            Has CVEs ({quickFilterCounts.hasCVEs})
          </button>
        )}
        {quickFilterCounts.prohibited > 0 && (
          <button
            className={`quick-filter-chip danger ${quickFilter === 'prohibited' ? 'active' : ''}`}
            onClick={() => handleQuickFilter('prohibited')}
          >
            Prohibited ({quickFilterCounts.prohibited})
          </button>
        )}
        {quickFilterCounts.outdated > 0 && (
          <button
            className={`quick-filter-chip warning ${quickFilter === 'outdated' ? 'active' : ''}`}
            onClick={() => handleQuickFilter('outdated')}
          >
            Outdated ({quickFilterCounts.outdated})
          </button>
        )}
        {quickFilterCounts.unscored > 0 && (
          <button
            className={`quick-filter-chip info ${quickFilter === 'unscored' ? 'active' : ''}`}
            onClick={() => handleQuickFilter('unscored')}
          >
            Unscored ({quickFilterCounts.unscored})
          </button>
        )}
      </div>

      <div className="results-filters">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search packages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-group">
          <label>Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            disabled={quickFilter !== 'all'}
          >
            <option value="all">All</option>
            <option value="scored">Scored</option>
            <option value="unscored">Unscored</option>
            <option value="not_found">Not Found</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Grade:</label>
          <select
            value={filterGrade}
            onChange={(e) => setFilterGrade(e.target.value as FilterGrade)}
            disabled={quickFilter !== 'all'}
          >
            <option value="all">All</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="F">F</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Risk:</label>
          <select
            value={filterRisk}
            onChange={(e) => setFilterRisk(e.target.value as FilterRisk)}
            disabled={quickFilter !== 'all'}
          >
            <option value="all">All</option>
            <option value="approved">Approved</option>
            <option value="conditional">Conditional</option>
            <option value="restricted">Restricted</option>
            <option value="prohibited">Prohibited</option>
          </select>
        </div>

        {devCount > 0 && (
          <label className="checkbox-filter">
            <input
              type="checkbox"
              checked={showDevDeps}
              onChange={(e) => setShowDevDeps(e.target.checked)}
            />
            Show dev dependencies ({devCount})
          </label>
        )}
      </div>

      <div className="results-count">
        Showing {filteredAndSorted.length} of {dependencies.length} packages
      </div>

      <table className="results-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('name')} className="sortable">
              Package{getSortIndicator('name')}
            </th>
            <th>Version</th>
            <th onClick={() => handleSort('score')} className="sortable">
              Score{getSortIndicator('score')}
            </th>
            <th onClick={() => handleSort('grade')} className="sortable">
              Grade{getSortIndicator('grade')}
            </th>
            <th onClick={() => handleSort('status')} className="sortable">
              Status{getSortIndicator('status')}
            </th>
            <th>Risk Indicators</th>
          </tr>
        </thead>
        <tbody>
          {filteredAndSorted.map((dep) => (
            <DependencyRow
              key={dep.parsed.name}
              dependency={dep}
              onRowClick={() => navigate(`/upload/analysis/${analysisId}/package/${encodeURIComponent(dep.parsed.name)}`)}
            />
          ))}
        </tbody>
      </table>

      {filteredAndSorted.length === 0 && (
        <div className="no-results">
          No packages match the current filters.
        </div>
      )}
    </div>
  );
}

interface DependencyRowProps {
  dependency: MatchedDependency;
  onRowClick: () => void;
}

function DependencyRow({ dependency, onRowClick }: DependencyRowProps) {
  const { parsed, scored, registry, status } = dependency;

  const displayVersion = parsed.version || scored?.version || registry?.version || '-';
  const score = scored?.scores?.overall;
  const grade = scored?.scores?.grade;

  const getStatusBadge = () => {
    switch (status) {
      case 'scored':
        return <span className="status-badge scored">Analyzed</span>;
      case 'unscored':
        return <span className="status-badge unscored">Not Analyzed</span>;
      case 'not_found':
        return <span className="status-badge not-found">Not Found</span>;
      case 'loading':
        return <span className="status-badge loading">Loading...</span>;
    }
  };

  return (
    <tr
      className={`dependency-row clickable ${parsed.isDev ? 'dev-dep' : ''}`}
      onClick={onRowClick}
    >
      <td className="package-name">
        <span className="package-name-text">{parsed.name}</span>
        {parsed.isDev && <span className="dev-badge">dev</span>}
      </td>
      <td className="version">{displayVersion}</td>
      <td className="score">
        {score !== undefined ? (
          <span className={`score-value score-${getScoreClass(score)}`}>
            {score.toFixed(1)}
          </span>
        ) : (
          <span className="score-na">-</span>
        )}
      </td>
      <td className="grade">
        {grade ? <GradeBadge grade={grade} size="sm" /> : <span className="grade-na">-</span>}
      </td>
      <td className="status">{getStatusBadge()}</td>
      <td className="risk-indicators">
        {scored && <RiskBadges pkg={scored} />}
      </td>
    </tr>
  );
}

function getScoreClass(score: number): string {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium-high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'medium-low';
  return 'low';
}
