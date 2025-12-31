import type { ProjectAnalysis, MatchedDependency } from '../types/package';

// CSV Export
export function exportToCSV(analysis: ProjectAnalysis): void {
  const headers = [
    'Package',
    'Version',
    'Status',
    'Score',
    'Grade',
    'Risk Tier',
    'Has CVEs',
    'Last Commit',
    'Top Contributor %',
    'Is Dev Dependency',
    'Issues',
  ];

  const rows = analysis.dependencies.map((dep) => {
    const issues: string[] = [];
    if (dep.scored?.has_unpatched_cves) issues.push('Unpatched CVEs');
    if (dep.scored?.scores?.risk_tier === 'prohibited') issues.push('Prohibited');
    if (dep.scored?.scores?.risk_tier === 'restricted') issues.push('Restricted');
    if (isAbandoned(dep)) issues.push('Potentially Abandoned');
    if (hasHighBusFactor(dep)) issues.push('High Bus Factor');

    return [
      dep.parsed.name,
      dep.parsed.version || dep.scored?.version || dep.registry?.version || '',
      dep.status,
      dep.scored?.scores?.overall?.toFixed(1) || '',
      dep.scored?.scores?.grade || '',
      dep.scored?.scores?.risk_tier || '',
      dep.scored?.has_unpatched_cves ? 'Yes' : 'No',
      dep.scored?.last_commit_date
        ? new Date(dep.scored.last_commit_date).toISOString().split('T')[0]
        : '',
      dep.scored?.top_contributor_pct?.toFixed(0) || '',
      dep.parsed.isDev ? 'Yes' : 'No',
      issues.join('; '),
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row.map((cell) => {
        // Escape cells that contain commas or quotes
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ),
  ].join('\n');

  downloadFile(csvContent, `${analysis.filename}-analysis.csv`, 'text/csv');
}

// JSON Export
export function exportToJSON(analysis: ProjectAnalysis): void {
  const exportData = {
    meta: {
      filename: analysis.filename,
      ecosystem: analysis.ecosystem,
      analyzedAt: analysis.uploadedAt,
      exportedAt: new Date().toISOString(),
    },
    summary: {
      total: analysis.summary.total,
      scored: analysis.summary.scored,
      unscored: analysis.summary.unscored,
      notFound: analysis.summary.notFound,
      averageScore: analysis.summary.avgScore,
      gradeDistribution: analysis.summary.gradeDistribution,
      riskTierDistribution: analysis.summary.riskTierDistribution,
      criticalIssues: analysis.summary.criticalIssues,
    },
    issues: {
      prohibited: analysis.dependencies
        .filter((d) => d.scored?.scores?.risk_tier === 'prohibited')
        .map((d) => d.parsed.name),
      restricted: analysis.dependencies
        .filter((d) => d.scored?.scores?.risk_tier === 'restricted')
        .map((d) => d.parsed.name),
      unpatchedCVEs: analysis.dependencies
        .filter((d) => d.scored?.has_unpatched_cves)
        .map((d) => d.parsed.name),
      abandoned: analysis.dependencies
        .filter(isAbandoned)
        .map((d) => d.parsed.name),
      highBusFactor: analysis.dependencies
        .filter(hasHighBusFactor)
        .map((d) => d.parsed.name),
    },
    dependencies: analysis.dependencies.map((dep) => ({
      name: dep.parsed.name,
      version: dep.parsed.version || dep.scored?.version || dep.registry?.version || null,
      isDev: dep.parsed.isDev || false,
      status: dep.status,
      score: dep.scored?.scores?.overall || null,
      grade: dep.scored?.scores?.grade || null,
      riskTier: dep.scored?.scores?.risk_tier || null,
      hasUnpatchedCVEs: dep.scored?.has_unpatched_cves || false,
      lastCommit: dep.scored?.last_commit_date || null,
      topContributorPct: dep.scored?.top_contributor_pct || null,
    })),
  };

  const jsonContent = JSON.stringify(exportData, null, 2);
  downloadFile(jsonContent, `${analysis.filename}-analysis.json`, 'application/json');
}

// Helper functions
function isAbandoned(dep: MatchedDependency): boolean {
  if (!dep.scored?.last_commit_date) return false;
  const lastCommit = new Date(dep.scored.last_commit_date);
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  return lastCommit < twoYearsAgo;
}

function hasHighBusFactor(dep: MatchedDependency): boolean {
  return (dep.scored?.top_contributor_pct ?? 0) > 80;
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Export dropdown component helper
export interface ExportOption {
  label: string;
  format: 'csv' | 'json';
  icon: string;
  description: string;
}

export const exportOptions: ExportOption[] = [
  {
    label: 'Export CSV',
    format: 'csv',
    icon: '📊',
    description: 'For spreadsheets and ticket creation',
  },
  {
    label: 'Export JSON',
    format: 'json',
    icon: '{ }',
    description: 'For automation and API integration',
  },
];

export function handleExport(analysis: ProjectAnalysis, format: 'csv' | 'json'): void {
  if (format === 'csv') {
    exportToCSV(analysis);
  } else {
    exportToJSON(analysis);
  }
}
