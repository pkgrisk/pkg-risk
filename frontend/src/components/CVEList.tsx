import type { CVEHistory, CVEDetail, CVESeverity } from '../types/package';

interface CVEListProps {
  cveHistory: CVEHistory;
}

const severityColors: Record<CVESeverity, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#ca8a04',
  LOW: '#2563eb',
  UNKNOWN: '#6b7280',
};

const severityLabels: Record<CVESeverity, string> = {
  CRITICAL: 'CRIT',
  HIGH: 'HIGH',
  MEDIUM: 'MED',
  LOW: 'LOW',
  UNKNOWN: '???',
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getCVEUrl(id: string): string {
  if (id.startsWith('CVE-')) {
    return `https://nvd.nist.gov/vuln/detail/${id}`;
  }
  if (id.startsWith('GHSA-')) {
    return `https://github.com/advisories/${id}`;
  }
  // OSV format
  return `https://osv.dev/vulnerability/${id}`;
}

function CVEItem({ cve }: { cve: CVEDetail }) {
  const severityColor = severityColors[cve.severity] || severityColors.UNKNOWN;
  const severityLabel = severityLabels[cve.severity] || '???';

  return (
    <div className="cve-item">
      <div className="cve-header">
        <span
          className="cve-severity"
          style={{ backgroundColor: severityColor }}
        >
          {severityLabel}
        </span>
        <a
          href={getCVEUrl(cve.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="cve-id"
        >
          {cve.id}
        </a>
        {cve.cvss_score !== null && (
          <span className="cve-cvss">CVSS: {cve.cvss_score.toFixed(1)}</span>
        )}
      </div>
      <div className="cve-summary">{cve.summary}</div>
      <div className="cve-details">
        <span className="cve-date">
          Published: {formatDate(cve.published_date)}
        </span>
        {cve.fixed_version ? (
          <span className="cve-patch">
            Fixed in {cve.fixed_version}
            {cve.days_to_patch !== null && (
              <span className="patch-time"> ({cve.days_to_patch} days)</span>
            )}
          </span>
        ) : (
          <span className="cve-unpatched">UNPATCHED</span>
        )}
      </div>
    </div>
  );
}

export function CVEList({ cveHistory }: CVEListProps) {
  if (cveHistory.total_cves === 0) {
    return (
      <div className="cve-list empty">
        <div className="cve-list-header">
          <h3>Security Vulnerabilities</h3>
          <span className="cve-count good">No known CVEs</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cve-list">
      <div className="cve-list-header">
        <h3>Security Vulnerabilities</h3>
        <span className={`cve-count ${cveHistory.has_unpatched ? 'warning' : ''}`}>
          {cveHistory.total_cves} CVE{cveHistory.total_cves !== 1 ? 's' : ''}
        </span>
      </div>
      {cveHistory.avg_days_to_patch !== null && (
        <div className="cve-avg-patch">
          Avg. time to patch: {Math.round(cveHistory.avg_days_to_patch)} days
        </div>
      )}
      {cveHistory.has_unpatched && (
        <div className="cve-warning">
          This package has unpatched vulnerabilities
        </div>
      )}
      <div className="cve-items">
        {cveHistory.cves.map((cve) => (
          <CVEItem key={cve.id} cve={cve} />
        ))}
      </div>
    </div>
  );
}

export default CVEList;
