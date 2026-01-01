import { useState, useCallback, useRef, useMemo } from 'react';
import { FileUploader } from '../components/FileUploader';
import { DependencyResults, type QuickFilter } from '../components/DependencyResults';
import { ProjectSummary } from '../components/ProjectSummary';
import { ExecutiveVerdict } from '../components/ExecutiveVerdict';
import { ActionItems } from '../components/ActionItems';
import { ComparisonView } from '../components/ComparisonView';
import { useUploadedProject } from '../hooks/useUploadedProject';
import { usePackageNotes } from '../hooks/usePackageNotes';
import { useAnalysisStorage } from '../hooks/useAnalysisStorage';
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
  const [analyses, setAnalyses] = useState<ProjectAnalysis[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [showActionItems, setShowActionItems] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [showComparison, setShowComparison] = useState(true);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'reviewed' | 'not_reviewed' | 'flagged'>('all');
  const exportButtonRef = useRef<HTMLDivElement>(null);

  const {
    savedProjects,
    saveProject,
    deleteProject,
    persistenceEnabled,
    setPersistenceEnabled,
    clearAllProjects,
  } = useUploadedProject();

  const { getNote, isReviewed } = usePackageNotes();
  const { saveAnalysis } = useAnalysisStorage();

  // Current active analysis
  const analysis = analyses[activeTabIndex] || null;

  // Find previous analysis of the same file for comparison
  const previousAnalysis = useMemo(() => {
    if (!analysis) return null;
    // Look for a saved project with the same filename
    const prev = savedProjects.find(
      (p) => p.name === analysis.filename && p.id !== analysis.id
    );
    if (!prev) return null;

    // Convert saved project to a comparable format
    // Note: This is a simplified comparison - we'd need the full analysis for detailed comparison
    // For now, we'll just create a stub that can be used for basic diff
    return null; // We'll implement full comparison when we store full analyses
  }, [analysis, savedProjects]);

  // Combined analysis for multi-file view
  const combinedAnalysis = useMemo(() => {
    if (analyses.length <= 1) return null;

    const allDeps: MatchedDependency[] = [];
    const seenNames = new Set<string>();

    for (const a of analyses) {
      for (const dep of a.dependencies) {
        const key = `${dep.parsed.ecosystem}:${dep.parsed.name.toLowerCase()}`;
        if (!seenNames.has(key)) {
          seenNames.add(key);
          allDeps.push(dep);
        }
      }
    }

    const summary = calculateSummary(allDeps);

    return {
      id: 'combined',
      filename: `Combined (${analyses.length} files)`,
      ecosystem: analyses[0].ecosystem,
      uploadedAt: new Date().toISOString(),
      dependencies: allDeps,
      summary,
    } as ProjectAnalysis;
  }, [analyses]);

  const handleFilesParsed = useCallback(
    async (results: ParserResult[]) => {
      try {
        // Filter out results with no dependencies
        const validResults = results.filter((r) => r.dependencies.length > 0);
        if (validResults.length === 0) {
          const errors = results.flatMap((r) => r.errors);
          setError(errors.length > 0 ? errors.join(', ') : 'No dependencies found');
          setAnalysisState('error');
          return;
        }

        setError(null);
        setAnalysisState('matching');

        const newAnalyses: ProjectAnalysis[] = [];

        // Process each file
        for (const result of validResults) {
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

          newAnalyses.push(projectAnalysis);

          // Auto-save if persistence is enabled
          if (persistenceEnabled) {
            saveProject(result.filename, result.ecosystem, result.dependencies);
          }

          // Save analysis for package detail navigation
          saveAnalysis(projectAnalysis);
        }

        setAnalyses(newAnalyses);
        setActiveTabIndex(0);
        setAnalysisState('complete');
      } catch (err) {
        console.error('Analysis error:', err);
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        setAnalysisState('error');
      }
    },
    [ecosystemData, persistenceEnabled, saveProject, saveAnalysis]
  );

  const handleReset = useCallback(() => {
    setAnalyses([]);
    setActiveTabIndex(0);
    setAnalysisState('idle');
    setError(null);
    setProgress({ current: 0, total: 0 });
    setShowActionItems(true);
    setExportMenuOpen(false);
    setSearchFilter('');
    setQuickFilter('all');
    setShowComparison(true);
    setReviewFilter('all');
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

          {/* File tabs for multi-file uploads */}
          {analyses.length > 1 && (
            <div className="file-tabs">
              {combinedAnalysis && (
                <button
                  className={`file-tab combined ${activeTabIndex === -1 ? 'active' : ''}`}
                  onClick={() => setActiveTabIndex(-1)}
                >
                  Combined ({combinedAnalysis.dependencies.length})
                </button>
              )}
              {analyses.map((a, index) => (
                <button
                  key={a.id}
                  className={`file-tab ${activeTabIndex === index ? 'active' : ''}`}
                  onClick={() => setActiveTabIndex(index)}
                >
                  {a.filename}
                  <span className="tab-count">{a.dependencies.length}</span>
                </button>
              ))}
            </div>
          )}

          {/* Comparison view for repeat uploads */}
          {previousAnalysis && showComparison && (
            <ComparisonView
              current={analysis}
              previous={previousAnalysis}
              onDismiss={() => setShowComparison(false)}
            />
          )}

          <ExecutiveVerdict
            analysis={activeTabIndex === -1 && combinedAnalysis ? combinedAnalysis : analysis}
            onViewActionItems={() => {
              setShowActionItems(true);
              document.querySelector('.action-items')?.scrollIntoView({ behavior: 'smooth' });
            }}
            onExport={() => setExportMenuOpen(true)}
          />

          {showActionItems && (
            <ActionItems
              analysis={activeTabIndex === -1 && combinedAnalysis ? combinedAnalysis : analysis}
              onPackageClick={handlePackageClick}
            />
          )}

          <ProjectSummary
            analysis={activeTabIndex === -1 && combinedAnalysis ? combinedAnalysis : analysis}
            onQuickFilterClick={handleQuickFilterClick}
            onPackageClick={handlePackageClick}
          />

          <div className="results-section">
            <div className="results-section-header">
              <h3>All Dependencies</h3>
              <div className="review-filter">
                <label>Review Status:</label>
                <select
                  value={reviewFilter}
                  onChange={(e) => setReviewFilter(e.target.value as typeof reviewFilter)}
                >
                  <option value="all">All</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="not_reviewed">Not Reviewed</option>
                  <option value="flagged">Flagged</option>
                </select>
              </div>
            </div>
            <DependencyResults
              dependencies={(activeTabIndex === -1 && combinedAnalysis ? combinedAnalysis : analysis).dependencies.filter((dep) => {
                if (reviewFilter === 'all') return true;
                const reviewed = isReviewed(dep.parsed.ecosystem, dep.parsed.name);
                const note = getNote(dep.parsed.ecosystem, dep.parsed.name);
                if (reviewFilter === 'reviewed') return reviewed;
                if (reviewFilter === 'not_reviewed') return !reviewed;
                if (reviewFilter === 'flagged') return note?.reviewStatus === 'flagged';
                return true;
              })}
              analysisId={(activeTabIndex === -1 && combinedAnalysis ? combinedAnalysis : analysis).id}
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
