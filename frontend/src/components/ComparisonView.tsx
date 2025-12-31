import { useMemo } from 'react';
import type { ProjectAnalysis, MatchedDependency } from '../types/package';

interface ComparisonViewProps {
  current: ProjectAnalysis;
  previous: ProjectAnalysis;
  onDismiss: () => void;
}

interface DependencyDiff {
  added: MatchedDependency[];
  removed: string[];
  versionChanged: Array<{
    name: string;
    oldVersion: string;
    newVersion: string;
    current: MatchedDependency;
  }>;
  newIssues: {
    cves: MatchedDependency[];
    prohibited: MatchedDependency[];
    restricted: MatchedDependency[];
  };
  resolvedIssues: {
    cves: string[];
    prohibited: string[];
    restricted: string[];
  };
}

export function ComparisonView({ current, previous, onDismiss }: ComparisonViewProps) {
  const diff = useMemo(() => calculateDiff(current, previous), [current, previous]);

  const hasChanges =
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.versionChanged.length > 0;

  const hasNewIssues =
    diff.newIssues.cves.length > 0 ||
    diff.newIssues.prohibited.length > 0 ||
    diff.newIssues.restricted.length > 0;

  const hasResolvedIssues =
    diff.resolvedIssues.cves.length > 0 ||
    diff.resolvedIssues.prohibited.length > 0 ||
    diff.resolvedIssues.restricted.length > 0;

  const timeSince = getTimeSince(new Date(previous.uploadedAt));

  return (
    <div className="comparison-view">
      <div className="comparison-header">
        <div className="comparison-title">
          <h3>Changes Since Last Scan</h3>
          <span className="comparison-time">Compared to {timeSince} ago</span>
        </div>
        <button className="comparison-dismiss" onClick={onDismiss} title="Dismiss">
          ×
        </button>
      </div>

      {!hasChanges && !hasNewIssues && !hasResolvedIssues && (
        <div className="comparison-no-changes">
          <span className="check-icon">✓</span>
          No changes detected since last scan
        </div>
      )}

      {hasChanges && (
        <div className="comparison-summary">
          {diff.added.length > 0 && (
            <div className="comparison-stat added">
              <span className="stat-icon">+</span>
              <span className="stat-value">{diff.added.length}</span>
              <span className="stat-label">added</span>
            </div>
          )}
          {diff.removed.length > 0 && (
            <div className="comparison-stat removed">
              <span className="stat-icon">−</span>
              <span className="stat-value">{diff.removed.length}</span>
              <span className="stat-label">removed</span>
            </div>
          )}
          {diff.versionChanged.length > 0 && (
            <div className="comparison-stat changed">
              <span className="stat-icon">↑</span>
              <span className="stat-value">{diff.versionChanged.length}</span>
              <span className="stat-label">updated</span>
            </div>
          )}
        </div>
      )}

      {hasNewIssues && (
        <div className="comparison-issues new-issues">
          <h4 className="issues-header danger">New Issues Detected</h4>
          <div className="issues-list">
            {diff.newIssues.cves.map((dep) => (
              <div key={dep.parsed.name} className="issue-item cve">
                <span className="issue-icon">!</span>
                <span className="issue-name">{dep.parsed.name}</span>
                <span className="issue-badge">Has CVEs</span>
              </div>
            ))}
            {diff.newIssues.prohibited.map((dep) => (
              <div key={dep.parsed.name} className="issue-item prohibited">
                <span className="issue-icon">⛔</span>
                <span className="issue-name">{dep.parsed.name}</span>
                <span className="issue-badge">Prohibited</span>
              </div>
            ))}
            {diff.newIssues.restricted.map((dep) => (
              <div key={dep.parsed.name} className="issue-item restricted">
                <span className="issue-icon">⚠</span>
                <span className="issue-name">{dep.parsed.name}</span>
                <span className="issue-badge">Restricted</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasResolvedIssues && (
        <div className="comparison-issues resolved-issues">
          <h4 className="issues-header success">Issues Resolved</h4>
          <div className="issues-list">
            {diff.resolvedIssues.cves.map((name) => (
              <div key={name} className="issue-item resolved">
                <span className="issue-icon">✓</span>
                <span className="issue-name">{name}</span>
                <span className="issue-badge">CVEs resolved</span>
              </div>
            ))}
            {diff.resolvedIssues.prohibited.map((name) => (
              <div key={name} className="issue-item resolved">
                <span className="issue-icon">✓</span>
                <span className="issue-name">{name}</span>
                <span className="issue-badge">No longer prohibited</span>
              </div>
            ))}
            {diff.resolvedIssues.restricted.map((name) => (
              <div key={name} className="issue-item resolved">
                <span className="issue-icon">✓</span>
                <span className="issue-name">{name}</span>
                <span className="issue-badge">No longer restricted</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(diff.added.length > 0 || diff.removed.length > 0 || diff.versionChanged.length > 0) && (
        <details className="comparison-details">
          <summary>View all dependency changes</summary>
          <div className="changes-content">
            {diff.added.length > 0 && (
              <div className="changes-section">
                <h5>Added Dependencies</h5>
                <ul>
                  {diff.added.map((dep) => (
                    <li key={dep.parsed.name} className="change-item added">
                      <span className="change-icon">+</span>
                      {dep.parsed.name}
                      {dep.parsed.version && <span className="version">@{dep.parsed.version}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diff.removed.length > 0 && (
              <div className="changes-section">
                <h5>Removed Dependencies</h5>
                <ul>
                  {diff.removed.map((name) => (
                    <li key={name} className="change-item removed">
                      <span className="change-icon">−</span>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diff.versionChanged.length > 0 && (
              <div className="changes-section">
                <h5>Version Changes</h5>
                <ul>
                  {diff.versionChanged.map((change) => (
                    <li key={change.name} className="change-item updated">
                      <span className="change-icon">↑</span>
                      {change.name}
                      <span className="version-change">
                        {change.oldVersion} → {change.newVersion}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function calculateDiff(current: ProjectAnalysis, previous: ProjectAnalysis): DependencyDiff {
  const currentMap = new Map(current.dependencies.map((d) => [d.parsed.name.toLowerCase(), d]));
  const previousMap = new Map(previous.dependencies.map((d) => [d.parsed.name.toLowerCase(), d]));

  // Find added dependencies
  const added: MatchedDependency[] = [];
  for (const [name, dep] of currentMap) {
    if (!previousMap.has(name)) {
      added.push(dep);
    }
  }

  // Find removed dependencies
  const removed: string[] = [];
  for (const [name, dep] of previousMap) {
    if (!currentMap.has(name)) {
      removed.push(dep.parsed.name);
    }
  }

  // Find version changes
  const versionChanged: DependencyDiff['versionChanged'] = [];
  for (const [name, currentDep] of currentMap) {
    const prevDep = previousMap.get(name);
    if (prevDep) {
      const currentVersion = currentDep.parsed.version || currentDep.scored?.version || '';
      const prevVersion = prevDep.parsed.version || prevDep.scored?.version || '';
      if (currentVersion && prevVersion && currentVersion !== prevVersion) {
        versionChanged.push({
          name: currentDep.parsed.name,
          oldVersion: prevVersion,
          newVersion: currentVersion,
          current: currentDep,
        });
      }
    }
  }

  // Find new issues (present in current but not in previous)
  const newIssues = {
    cves: [] as MatchedDependency[],
    prohibited: [] as MatchedDependency[],
    restricted: [] as MatchedDependency[],
  };

  for (const [name, dep] of currentMap) {
    const prevDep = previousMap.get(name);

    // Check for new CVEs
    if (dep.scored?.has_unpatched_cves && !prevDep?.scored?.has_unpatched_cves) {
      newIssues.cves.push(dep);
    }

    // Check for new prohibited status
    if (
      dep.scored?.scores?.risk_tier === 'prohibited' &&
      prevDep?.scored?.scores?.risk_tier !== 'prohibited'
    ) {
      newIssues.prohibited.push(dep);
    }

    // Check for new restricted status
    if (
      dep.scored?.scores?.risk_tier === 'restricted' &&
      prevDep?.scored?.scores?.risk_tier !== 'restricted'
    ) {
      newIssues.restricted.push(dep);
    }
  }

  // Find resolved issues (present in previous but not in current)
  const resolvedIssues = {
    cves: [] as string[],
    prohibited: [] as string[],
    restricted: [] as string[],
  };

  for (const [name, prevDep] of previousMap) {
    const currentDep = currentMap.get(name);
    if (!currentDep) continue; // Removed packages are already tracked

    // Check for resolved CVEs
    if (prevDep.scored?.has_unpatched_cves && !currentDep.scored?.has_unpatched_cves) {
      resolvedIssues.cves.push(prevDep.parsed.name);
    }

    // Check for resolved prohibited status
    if (
      prevDep.scored?.scores?.risk_tier === 'prohibited' &&
      currentDep.scored?.scores?.risk_tier !== 'prohibited'
    ) {
      resolvedIssues.prohibited.push(prevDep.parsed.name);
    }

    // Check for resolved restricted status
    if (
      prevDep.scored?.scores?.risk_tier === 'restricted' &&
      currentDep.scored?.scores?.risk_tier !== 'restricted'
    ) {
      resolvedIssues.restricted.push(prevDep.parsed.name);
    }
  }

  return { added, removed, versionChanged, newIssues, resolvedIssues };
}

function getTimeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks`;
  return `${Math.floor(seconds / 2592000)} months`;
}
