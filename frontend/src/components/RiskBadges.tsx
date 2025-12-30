import type { ReactNode } from 'react';
import type { PackageSummary } from '../types/package';

interface RiskBadgesProps {
  pkg: PackageSummary;
}

function getDaysSinceCommit(lastCommitDate: string | null): number | null {
  if (!lastCommitDate) return null;
  const lastCommit = new Date(lastCommitDate);
  const now = new Date();
  return Math.floor((now.getTime() - lastCommit.getTime()) / (1000 * 60 * 60 * 24));
}

export function RiskBadges({ pkg }: RiskBadgesProps) {
  const badges: ReactNode[] = [];

  // CVE badges (highest priority)
  if (pkg.has_unpatched_cves) {
    badges.push(
      <span key="cve" className="risk-badge risk-badge-critical" title="Has unpatched vulnerabilities">
        {pkg.cve_count} CVE{pkg.cve_count !== 1 ? 's' : ''}
      </span>
    );
  } else if (pkg.cve_count > 0) {
    badges.push(
      <span key="cve" className="risk-badge risk-badge-warning" title="Has known CVEs (all patched)">
        {pkg.cve_count} CVE{pkg.cve_count !== 1 ? 's' : ''}
      </span>
    );
  }

  // Stale/abandoned badge
  const daysSinceCommit = getDaysSinceCommit(pkg.last_commit_date);
  if (daysSinceCommit !== null) {
    if (daysSinceCommit > 365) {
      badges.push(
        <span key="stale" className="risk-badge risk-badge-critical" title={`No commits in ${Math.floor(daysSinceCommit / 30)} months`}>
          ABANDONED
        </span>
      );
    } else if (daysSinceCommit > 180) {
      badges.push(
        <span key="stale" className="risk-badge risk-badge-warning" title={`Last commit ${Math.floor(daysSinceCommit / 30)} months ago`}>
          STALE
        </span>
      );
    }
  }

  // Bus factor badge
  if (pkg.top_contributor_pct !== null && pkg.top_contributor_pct > 80) {
    badges.push(
      <span key="bus" className="risk-badge risk-badge-warning" title={`${pkg.top_contributor_pct.toFixed(0)}% of commits from one person`}>
        BUS RISK
      </span>
    );
  }

  // No security policy badge
  if (pkg.scores && !pkg.has_security_policy && !pkg.has_security_tools) {
    badges.push(
      <span key="nosec" className="risk-badge risk-badge-info" title="No security policy or tools configured">
        NO SEC
      </span>
    );
  }

  // If no issues, show a subtle checkmark
  if (badges.length === 0 && pkg.scores) {
    return (
      <span className="risk-badge risk-badge-ok" title="No issues detected">
        ✓
      </span>
    );
  }

  return <div className="risk-badges">{badges}</div>;
}

export default RiskBadges;
