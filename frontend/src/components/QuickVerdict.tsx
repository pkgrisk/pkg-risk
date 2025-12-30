import type { PackageAnalysis } from '../types/package';

interface QuickVerdictProps {
  pkg: PackageAnalysis;
}

type VerdictLevel = 'safe' | 'caution' | 'risk';

interface Verdict {
  level: VerdictLevel;
  icon: string;
  title: string;
  summary: string;
  action: string;
}

function getDaysSinceCommit(lastCommitDate: string | null | undefined): number | null {
  if (!lastCommitDate) return null;
  const lastCommit = new Date(lastCommitDate);
  const now = new Date();
  return Math.floor((now.getTime() - lastCommit.getTime()) / (1000 * 60 * 60 * 24));
}

function getVerdict(pkg: PackageAnalysis): Verdict {
  const cveHistory = pkg.github_data?.security?.cve_history;
  const daysSinceCommit = getDaysSinceCommit(pkg.github_data?.commits?.last_commit_date);
  const topContributorPct = pkg.github_data?.contributors?.top_contributor_pct;
  const overallScore = pkg.scores?.overall;

  // Critical issues = High risk
  if (cveHistory?.has_unpatched) {
    return {
      level: 'risk',
      icon: '✗',
      title: 'High Risk',
      summary: 'This package has unpatched security vulnerabilities.',
      action: 'Avoid use or find a patched version immediately.',
    };
  }

  if (daysSinceCommit !== null && daysSinceCommit > 365) {
    return {
      level: 'risk',
      icon: '✗',
      title: 'High Risk',
      summary: 'This project appears to be abandoned with no recent maintenance.',
      action: 'Consider alternatives with active maintenance.',
    };
  }

  // Warning issues = Use with caution
  if (cveHistory && cveHistory.total_cves > 0) {
    return {
      level: 'caution',
      icon: '⚠',
      title: 'Use with Caution',
      summary: 'This package has a history of security vulnerabilities (all patched).',
      action: 'Keep updated to the latest version and monitor for new CVEs.',
    };
  }

  if (daysSinceCommit !== null && daysSinceCommit > 180) {
    return {
      level: 'caution',
      icon: '⚠',
      title: 'Use with Caution',
      summary: 'Limited recent activity may indicate declining maintenance.',
      action: 'Monitor for updates and have a backup plan.',
    };
  }

  if (topContributorPct !== null && topContributorPct !== undefined && topContributorPct > 80) {
    return {
      level: 'caution',
      icon: '⚠',
      title: 'Use with Caution',
      summary: 'High bus factor risk with most commits from a single contributor.',
      action: 'Be aware of maintainer availability and consider alternatives.',
    };
  }

  if (overallScore !== null && overallScore !== undefined && overallScore < 50) {
    return {
      level: 'caution',
      icon: '⚠',
      title: 'Use with Caution',
      summary: 'Low overall score indicates potential quality or maintenance concerns.',
      action: 'Review specific score components before adopting.',
    };
  }

  // No issues = Safe to use
  if (overallScore !== null && overallScore !== undefined && overallScore >= 80) {
    return {
      level: 'safe',
      icon: '✓',
      title: 'Safe to Use',
      summary: 'No blocking issues detected. Strong security and maintenance practices.',
      action: 'Proceed with confidence. Follow standard dependency management practices.',
    };
  }

  return {
    level: 'safe',
    icon: '✓',
    title: 'Safe to Use',
    summary: 'No major issues detected.',
    action: 'Follow standard dependency management practices.',
  };
}

export function QuickVerdict({ pkg }: QuickVerdictProps) {
  // Don't show verdict if no score available
  if (!pkg.scores && pkg.data_availability !== 'available') {
    return null;
  }

  const verdict = getVerdict(pkg);

  return (
    <div className={`quick-verdict verdict-${verdict.level}`}>
      <div className="verdict-header">
        <span className="verdict-icon">{verdict.icon}</span>
        <span className="verdict-title">{verdict.title}</span>
      </div>
      <p className="verdict-summary">{verdict.summary}</p>
      <p className="verdict-action">
        <strong>Recommended:</strong> {verdict.action}
      </p>
    </div>
  );
}

export default QuickVerdict;
