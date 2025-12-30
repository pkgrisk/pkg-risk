import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { GradeBadge } from '../components/GradeBadge';
import type { PackageSummary, Grade } from '../types/package';

interface PackageListProps {
  packages: PackageSummary[];
  ecosystem: string;
}

type SortKey = 'name' | 'score' | 'installs';

export function PackageList({ packages, ecosystem }: PackageListProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('installs');
  const [sortAsc, setSortAsc] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all'>('all');

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
  }, [packages, search, sortKey, sortAsc, gradeFilter]);

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
      </div>

      <div className="stats-row">
        <span>{filteredAndSorted.length} packages</span>
        <span>
          {filteredAndSorted.filter((p) => p.data_availability === 'available').length} with data
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
            <th onClick={() => handleSort('installs')} className="sortable">
              Installs/30d {sortKey === 'installs' && (sortAsc ? '↑' : '↓')}
            </th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filteredAndSorted.map((pkg) => (
            <tr key={pkg.name}>
              <td>
                {pkg.scores ? (
                  <GradeBadge grade={pkg.scores.grade} size="sm" />
                ) : (
                  <span className="no-grade">-</span>
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
              <td>{formatInstalls(pkg.install_count_30d)}</td>
              <td>
                {pkg.data_availability === 'available' ? (
                  <span className="status-available">Available</span>
                ) : (
                  <span className="status-unavailable" title={pkg.unavailable_reason || ''}>
                    {pkg.data_availability.replace('_', ' ')}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
