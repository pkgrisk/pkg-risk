import { useState, useCallback, useRef } from 'react';
import { FileUploader } from '../components/FileUploader';
import { DependencyResults, type QuickFilter } from '../components/DependencyResults';
import { ProjectSummary } from '../components/ProjectSummary';
import { ExecutiveVerdict } from '../components/ExecutiveVerdict';
import { ActionItems } from '../components/ActionItems';
import { useUploadedProject } from '../hooks/useUploadedProject';
import { fetchRegistryMetadataBatch } from '../lib/registryFetcher';
import { exportToCSV, exportToJSON } from '../lib/exportUtils';
import type {
  ParserResult,
  PackageSummary,
  MatchedDependency,
  ProjectAnalysis,
  GradeDistribution,
  RiskTier,
} from '../types/package';

interface UploadDashboardProps {
  ecosystemData: Record<string, PackageSummary[]>;
}

type AnalysisState = 'idle' | 'parsing' | 'matching' | 'fetching' | 'complete' | 'error';

export function UploadDashboard({ ecosystemData }: UploadDashboardProps) {
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [showActionItems, setShowActionItems] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const exportButtonRef = useRef<HTMLDivElement>(null);

  const {
    savedProjects,
    saveProject,
    deleteProject,
    persistenceEnabled,
    setPersistenceEnabled,
    clearAllProjects,
  } = useUploadedProject();

  const handleFilesParsed = useCallback(
    async (results: ParserResult[]) => {
      try {
        // For now, handle single file (could extend to multiple)
        const result = results[0];
        if (!result || result.dependencies.length === 0) {
          setError(result?.errors.join(', ') || 'No dependencies found');
          setAnalysisState('error');
          return;
        }

        setError(null);
        setAnalysisState('matching');

        // Get ecosystem data for matching
        const scoredData = ecosystemData[result.ecosystem] || [];
        const scoredMap = new Map(scoredData.map((pkg) => [pkg.name.toLowerCase(), pkg]));

        // Match dependencies against scored data
        const matchedDeps: MatchedDependency[] = result.dependencies.map((dep) => {
          const normalizedName = dep.name.toLowerCase();
          const scored = scoredMap.get(normalizedName);

          return {
            parsed: dep,
            scored,
            status: scored ? 'scored' : 'loading',
          };
        });

        // Identify unscored packages that need registry lookup
        const unscoredPackages = matchedDeps
          .filter((d) => d.status === 'loading')
          .map((d) => ({ name: d.parsed.name, ecosystem: d.parsed.ecosystem }));

        // Fetch registry metadata for unscored packages
        if (unscoredPackages.length > 0) {
          setAnalysisState('fetching');
          setProgress({ current: 0, total: unscoredPackages.length });

          const registryData = await fetchRegistryMetadataBatch(
            unscoredPackages,
            5,
            (completed, total) => setProgress({ current: completed, total })
          );

          // Update matched deps with registry data
          for (const dep of matchedDeps) {
            if (dep.status === 'loading') {
              const key = `${dep.parsed.ecosystem}:${dep.parsed.name}`;
              const registry = registryData.get(key);
              dep.registry = registry ?? undefined;
              dep.status = registry ? 'unscored' : 'not_found';
            }
          }
        } else {
          // No unscored packages, mark all loading as not_found
          for (const dep of matchedDeps) {
            if (dep.status === 'loading') {
              dep.status = 'not_found';
            }
          }
        }

        // Calculate summary
        const summary = calculateSummary(matchedDeps);

        const projectAnalysis: ProjectAnalysis = {
          id: crypto.randomUUID(),
          filename: result.filename,
          ecosystem: result.ecosystem,
          uploadedAt: new Date().toISOString(),
          dependencies: matchedDeps,
          summary,
        };

        setAnalysis(projectAnalysis);
        setAnalysisState('complete');

        // Auto-save if persistence is enabled
        if (persistenceEnabled) {
          saveProject(result.filename, result.ecosystem, result.dependencies);
        }
      } catch (err) {
        console.error('Analysis error:', err);
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        setAnalysisState('error');
      }
    },
    [ecosystemData, persistenceEnabled, saveProject]
  );

  const handleReset = useCallback(() => {
    setAnalysis(null);
    setAnalysisState('idle');
    setError(null);
    setProgress({ current: 0, total: 0 });
    setShowActionItems(true);
    setExportMenuOpen(false);
    setSearchFilter('');
    setQuickFilter('all');
  }, []);

  const handleExport = useCallback(
    (format: 'csv' | 'json') => {
      if (!analysis) return;
      if (format === 'csv') {
        exportToCSV(analysis);
      } else {
        exportToJSON(analysis);
      }
      setExportMenuOpen(false);
    },
    [analysis]
  );

  const handlePackageClick = useCallback((packageName: string) => {
    setSearchFilter(packageName);
    setQuickFilter('all'); // Reset quick filter when searching by name
    // Scroll to dependency results
    document.querySelector('.dependency-results')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleQuickFilterClick = useCallback((filter: QuickFilter) => {
    setQuickFilter(filter);
    setSearchFilter(''); // Clear search when using quick filter
    // Scroll to dependency results
    document.querySelector('.dependency-results')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const loadSavedProject = useCallback(
    async (projectId: string) => {
      const project = savedProjects.find((p) => p.id === projectId);
      if (!project) return;

      // Re-run analysis with saved dependencies
      const parserResult: ParserResult = {
        dependencies: project.dependencies,
        ecosystem: project.ecosystem,
        filename: project.name,
        errors: [],
      };

      await handleFilesParsed([parserResult]);
    },
    [savedProjects, handleFilesParsed]
  );

  return (
    <div className="upload-dashboard">
      <header className="upload-header">
        <h1>Analyze Your Dependencies</h1>
        <p>
          Upload your dependency file to get a security and health analysis of your project's
          packages.
        </p>
      </header>

      {analysisState === 'idle' && (
        <>
          <FileUploader onFilesParsed={handleFilesParsed} />

          {savedProjects.length > 0 && (
            <div className="saved-projects">
              <div className="saved-projects-header">
                <h3>Previously Analyzed</h3>
                <button className="clear-btn" onClick={clearAllProjects}>
                  Clear All
                </button>
              </div>
              <ul className="saved-projects-list">
                {savedProjects.map((project) => (
                  <li key={project.id} className="saved-project-item">
                    <button
                      className="project-btn"
                      onClick={() => loadSavedProject(project.id)}
                    >
                      <span className="project-name">{project.name}</span>
                      <span className="project-meta">
                        {project.ecosystem} • {project.dependencies.length} deps •{' '}
                        {new Date(project.uploadedAt).toLocaleDateString()}
                      </span>
                    </button>
                    <button
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(project.id);
                      }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="persistence-toggle">
            <label>
              <input
                type="checkbox"
                checked={persistenceEnabled}
                onChange={(e) => setPersistenceEnabled(e.target.checked)}
              />
              Save analysis history in browser
            </label>
            <p className="persistence-note">
              When enabled, your uploaded dependency lists are stored locally so you can revisit
              them later.
            </p>
          </div>
        </>
      )}

      {(analysisState === 'matching' || analysisState === 'fetching') && (
        <div className="analysis-progress">
          <div className="spinner" />
          <div className="progress-content">
            <p className="progress-status">
              {analysisState === 'matching'
                ? 'Matching dependencies against our database...'
                : `Fetching public package info (${progress.current}/${progress.total})...`}
            </p>
            <p className="progress-privacy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Processing locally in your browser
            </p>
          </div>
        </div>
      )}

      {analysisState === 'error' && (
        <div className="analysis-error">
          <p>{error}</p>
          <button onClick={handleReset}>Try Again</button>
        </div>
      )}

      {analysisState === 'complete' && analysis && (
        <div className="analysis-results">
          <div className="results-header">
            <div className="results-header-left">
              <h2>{analysis.filename}</h2>
              <span className="privacy-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Analyzed locally
              </span>
            </div>
            <div className="results-header-right">
              <div className="export-button-container" ref={exportButtonRef}>
                <button
                  className="export-btn"
                  onClick={() => setExportMenuOpen(!exportMenuOpen)}
                >
                  Export Report ▾
                </button>
                {exportMenuOpen && (
                  <div className="export-dropdown">
                    <button onClick={() => handleExport('csv')}>
                      <span className="export-icon">📊</span>
                      Export CSV
                    </button>
                    <button onClick={() => handleExport('json')}>
                      <span className="export-icon">{ }</span>
                      Export JSON
                    </button>
                  </div>
                )}
              </div>
              <button className="reset-btn" onClick={handleReset}>
                Analyze Another File
              </button>
            </div>
          </div>

          <ExecutiveVerdict
            analysis={analysis}
            onViewActionItems={() => {
              setShowActionItems(true);
              document.querySelector('.action-items')?.scrollIntoView({ behavior: 'smooth' });
            }}
            onExport={() => setExportMenuOpen(true)}
          />

          {showActionItems && (
            <ActionItems
              analysis={analysis}
              onPackageClick={handlePackageClick}
            />
          )}

          <ProjectSummary
            analysis={analysis}
            onQuickFilterClick={handleQuickFilterClick}
            onPackageClick={handlePackageClick}
          />

          <div className="results-section">
            <h3>All Dependencies</h3>
            <DependencyResults
              dependencies={analysis.dependencies}
              ecosystem={analysis.ecosystem}
              initialSearchQuery={searchFilter}
              initialQuickFilter={quickFilter}
            />
          </div>

          {!persistenceEnabled && (
            <div className="save-prompt">
              <button onClick={() => setPersistenceEnabled(true)}>
                Save this analysis for later?
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function calculateSummary(dependencies: MatchedDependency[]): ProjectAnalysis['summary'] {
  const scored = dependencies.filter((d) => d.status === 'scored');
  const unscored = dependencies.filter((d) => d.status === 'unscored');
  const notFound = dependencies.filter((d) => d.status === 'not_found');

  // Calculate average score
  const scores = scored.map((d) => d.scored?.scores?.overall).filter((s): s is number => s !== undefined);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  // Grade distribution
  const gradeDistribution: GradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const dep of scored) {
    const grade = dep.scored?.scores?.grade;
    if (grade) {
      gradeDistribution[grade]++;
    }
  }

  // Risk tier distribution
  const riskTierDistribution: Record<RiskTier, number> = {
    approved: 0,
    conditional: 0,
    restricted: 0,
    prohibited: 0,
  };
  for (const dep of scored) {
    const tier = dep.scored?.scores?.risk_tier;
    if (tier) {
      riskTierDistribution[tier]++;
    }
  }

  // Count critical issues
  const criticalIssues = dependencies.filter(
    (d) =>
      d.scored?.has_unpatched_cves ||
      d.scored?.scores?.risk_tier === 'prohibited' ||
      d.scored?.scores?.risk_tier === 'restricted'
  ).length;

  return {
    total: dependencies.length,
    scored: scored.length,
    unscored: unscored.length,
    notFound: notFound.length,
    avgScore,
    gradeDistribution,
    riskTierDistribution,
    criticalIssues,
  };
}
