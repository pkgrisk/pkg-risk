import { useState } from 'react';
import type { PackageSummary } from '../types/package';

interface ExportButtonProps {
  packages: PackageSummary[];
  ecosystem: string;
}

type ExportFormat = 'csv' | 'json';

function downloadFile(content: string, filename: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportToCSV(packages: PackageSummary[], ecosystem: string): void {
  const headers = [
    'Name',
    'Version',
    'Grade',
    'Score',
    'CVEs',
    'Has Unpatched CVEs',
    'Last Commit',
    'Installs (30d)',
    'Description',
  ];

  const rows = packages.map((pkg) => [
    pkg.name,
    pkg.version,
    pkg.scores?.grade ?? 'N/A',
    pkg.scores?.overall.toFixed(1) ?? 'N/A',
    pkg.cve_count.toString(),
    pkg.has_unpatched_cves ? 'Yes' : 'No',
    pkg.last_commit_date ?? 'N/A',
    pkg.install_count_30d?.toString() ?? 'N/A',
    `"${(pkg.description ?? '').replace(/"/g, '""')}"`,
  ]);

  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  downloadFile(csv, `${ecosystem}-packages-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
}

function exportToJSON(packages: PackageSummary[], ecosystem: string): void {
  const data = {
    ecosystem,
    exported_at: new Date().toISOString(),
    package_count: packages.length,
    packages: packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      grade: pkg.scores?.grade ?? null,
      score: pkg.scores?.overall ?? null,
      cve_count: pkg.cve_count,
      has_unpatched_cves: pkg.has_unpatched_cves,
      last_commit_date: pkg.last_commit_date,
      install_count_30d: pkg.install_count_30d,
      repository: pkg.repository,
    })),
  };

  downloadFile(
    JSON.stringify(data, null, 2),
    `${ecosystem}-packages-${new Date().toISOString().split('T')[0]}.json`,
    'application/json'
  );
}

export function ExportButton({ packages, ecosystem }: ExportButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  const handleExport = (format: ExportFormat) => {
    if (format === 'csv') {
      exportToCSV(packages, ecosystem);
    } else {
      exportToJSON(packages, ecosystem);
    }
    setShowDropdown(false);
  };

  return (
    <div className="export-button-container">
      <button
        className="export-button"
        onClick={() => setShowDropdown(!showDropdown)}
      >
        Export ▼
      </button>
      {showDropdown && (
        <div className="export-dropdown">
          <button onClick={() => handleExport('csv')}>
            <span className="export-icon">📊</span>
            Export as CSV
          </button>
          <button onClick={() => handleExport('json')}>
            <span className="export-icon">📄</span>
            Export as JSON
          </button>
        </div>
      )}
    </div>
  );
}

export default ExportButton;
