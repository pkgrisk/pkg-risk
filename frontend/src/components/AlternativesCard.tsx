import { Link } from 'react-router-dom';
import { GradeBadge } from './GradeBadge';
import type { PackageAnalysis, PackageSummary } from '../types/package';

interface AlternativesCardProps {
  pkg: PackageAnalysis;
  allPackages: PackageSummary[];
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatInstalls(count: number | null): string {
  if (count === null) return '-';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

export function AlternativesCard({ pkg, allPackages }: AlternativesCardProps) {
  // Filter to same ecosystem, exclude current package, only scored packages
  const alternatives = allPackages
    .filter(
      (p) =>
        p.name !== pkg.name &&
        p.scores !== null &&
        p.scores.overall >= (pkg.scores?.overall ?? 0) - 10 // Similar or better score
    )
    .sort((a, b) => (b.scores?.overall ?? 0) - (a.scores?.overall ?? 0))
    .slice(0, 5);

  if (alternatives.length === 0) {
    return null;
  }

  return (
    <section className="card alternatives-card">
      <h2>Similar Packages</h2>
      <p className="alternatives-intro">
        Other {pkg.ecosystem} packages for comparison
      </p>
      <table className="alternatives-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Grade</th>
            <th>Score</th>
            <th>CVEs</th>
            <th>Last Commit</th>
            <th>Installs</th>
          </tr>
        </thead>
        <tbody>
          <tr className="current-package">
            <td>
              <strong>{pkg.name}</strong>
              <span className="current-label">current</span>
            </td>
            <td>
              {pkg.scores && <GradeBadge grade={pkg.scores.grade} size="sm" />}
            </td>
            <td>{pkg.scores?.overall.toFixed(1) ?? '-'}</td>
            <td>{pkg.github_data?.security?.known_cves ?? 0}</td>
            <td>{formatRelativeTime(pkg.github_data?.commits?.last_commit_date ?? null)}</td>
            <td>{formatInstalls(pkg.install_count_30d)}</td>
          </tr>
          {alternatives.map((alt) => (
            <tr key={alt.name}>
              <td>
                <Link to={`/${pkg.ecosystem}/${alt.name}`} className="alt-link">
                  {alt.name}
                </Link>
              </td>
              <td>
                {alt.scores && <GradeBadge grade={alt.scores.grade} size="sm" />}
              </td>
              <td>{alt.scores?.overall.toFixed(1) ?? '-'}</td>
              <td className={alt.cve_count > 0 ? 'has-cves' : ''}>
                {alt.cve_count}
              </td>
              <td>{formatRelativeTime(alt.last_commit_date)}</td>
              <td>{formatInstalls(alt.install_count_30d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default AlternativesCard;
