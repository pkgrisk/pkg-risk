import { useMemo, useState } from 'react';
import type { ProjectAnalysis, MatchedDependency } from '../types/package';

type ActionSeverity = 'immediate' | 'review' | 'awareness';

interface ActionItem {
  id: string;
  severity: ActionSeverity;
  packageName: string;
  title: string;
  details: string;
  tags: string[];
  dependency: MatchedDependency;
}

interface ActionItemsProps {
  analysis: ProjectAnalysis;
  onPackageClick?: (packageName: string) => void;
  defaultExpanded?: boolean;
}

function categorizeActions(dependencies: MatchedDependency[]): ActionItem[] {
  const actions: ActionItem[] = [];

  for (const dep of dependencies) {
    const { parsed, scored } = dep;

    // IMMEDIATE: Prohibited packages
    if (scored?.scores?.risk_tier === 'prohibited') {
      actions.push({
        id: `${parsed.name}-prohibited`,
        severity: 'immediate',
        packageName: parsed.name,
        title: `${parsed.name} is PROHIBITED`,
        details: 'This package is not approved for use and should be removed immediately.',
        tags: ['Prohibited'],
        dependency: dep,
      });
    }

    // IMMEDIATE: Unpatched CVEs
    if (scored?.has_unpatched_cves) {
      actions.push({
        id: `${parsed.name}-cve`,
        severity: 'immediate',
        packageName: parsed.name,
        title: `${parsed.name} has unpatched CVEs`,
        details: `Known security vulnerabilities with no available fix.`,
        tags: ['Unpatched CVE'],
        dependency: dep,
      });
    }

    // REVIEW: Restricted packages
    if (scored?.scores?.risk_tier === 'restricted') {
      actions.push({
        id: `${parsed.name}-restricted`,
        severity: 'review',
        packageName: parsed.name,
        title: `${parsed.name} is RESTRICTED`,
        details: 'This package requires special approval before use in production.',
        tags: ['Restricted'],
        dependency: dep,
      });
    }

    // REVIEW: High bus factor risk
    if (scored?.top_contributor_pct && scored.top_contributor_pct > 80) {
      actions.push({
        id: `${parsed.name}-busfactor`,
        severity: 'review',
        packageName: parsed.name,
        title: `${parsed.name} has high bus factor risk`,
        details: `${scored.top_contributor_pct.toFixed(0)}% of commits from a single contributor.`,
        tags: ['Bus Factor'],
        dependency: dep,
      });
    }

    // AWARENESS: Abandoned packages (2+ years since last commit)
    if (scored?.last_commit_date) {
      const lastCommit = new Date(scored.last_commit_date);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      if (lastCommit < twoYearsAgo) {
        const yearsSince = Math.floor(
          (Date.now() - lastCommit.getTime()) / (365 * 24 * 60 * 60 * 1000)
        );
        actions.push({
          id: `${parsed.name}-abandoned`,
          severity: 'awareness',
          packageName: parsed.name,
          title: `${parsed.name} may be abandoned`,
          details: `Last commit was ${yearsSince} years ago.`,
          tags: ['Stale'],
          dependency: dep,
        });
      }
    }
  }

  // AWARENESS: Unscored packages (aggregate)
  const unscoredPackages = dependencies.filter((d) => d.status === 'unscored' || d.status === 'not_found');
  if (unscoredPackages.length > 0) {
    actions.push({
      id: 'unscored-aggregate',
      severity: 'awareness',
      packageName: '',
      title: `${unscoredPackages.length} packages not analyzed`,
      details: `These packages are not in our database. Consider reviewing manually: ${unscoredPackages.slice(0, 5).map((d) => d.parsed.name).join(', ')}${unscoredPackages.length > 5 ? ` and ${unscoredPackages.length - 5} more` : ''}.`,
      tags: ['Not Analyzed'],
      dependency: unscoredPackages[0],
    });
  }

  // Sort by severity (immediate first, then review, then awareness)
  const severityOrder: Record<ActionSeverity, number> = {
    immediate: 0,
    review: 1,
    awareness: 2,
  };
  actions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return actions;
}

export function ActionItems({
  analysis,
  onPackageClick,
  defaultExpanded = true,
}: ActionItemsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const actions = useMemo(
    () => categorizeActions(analysis.dependencies),
    [analysis.dependencies]
  );

  const immediate = actions.filter((a) => a.severity === 'immediate');
  const review = actions.filter((a) => a.severity === 'review');
  const awareness = actions.filter((a) => a.severity === 'awareness');

  if (actions.length === 0) {
    return (
      <div className="action-items empty">
        <div className="action-items-header">
          <h3>Action Items</h3>
        </div>
        <div className="action-items-empty">
          <span className="empty-icon">✓</span>
          <p>No action items. All packages meet quality standards.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="action-items">
      <button
        className="action-items-header"
        onClick={() => setExpanded(!expanded)}
      >
        <h3>
          Action Items
          <span className="action-count">{actions.length}</span>
        </h3>
        <span className={`expand-icon ${expanded ? 'expanded' : ''}`}>▶</span>
      </button>

      {expanded && (
        <div className="action-items-content">
          {immediate.length > 0 && (
            <div className="action-section severity-immediate">
              <div className="section-header">
                <span className="section-icon">🚨</span>
                <span className="section-title">IMMEDIATE ACTION</span>
                <span className="section-count">{immediate.length}</span>
              </div>
              <ul className="action-list">
                {immediate.map((item) => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    onClick={
                      item.packageName && onPackageClick
                        ? () => onPackageClick(item.packageName)
                        : undefined
                    }
                  />
                ))}
              </ul>
            </div>
          )}

          {review.length > 0 && (
            <div className="action-section severity-review">
              <div className="section-header">
                <span className="section-icon">⚠️</span>
                <span className="section-title">REVIEW NEEDED</span>
                <span className="section-count">{review.length}</span>
              </div>
              <ul className="action-list">
                {review.map((item) => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    onClick={
                      item.packageName && onPackageClick
                        ? () => onPackageClick(item.packageName)
                        : undefined
                    }
                  />
                ))}
              </ul>
            </div>
          )}

          {awareness.length > 0 && (
            <div className="action-section severity-awareness">
              <div className="section-header">
                <span className="section-icon">ℹ️</span>
                <span className="section-title">AWARENESS</span>
                <span className="section-count">{awareness.length}</span>
              </div>
              <ul className="action-list">
                {awareness.map((item) => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    onClick={
                      item.packageName && onPackageClick
                        ? () => onPackageClick(item.packageName)
                        : undefined
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ActionItemRowProps {
  item: ActionItem;
  onClick?: () => void;
}

function ActionItemRow({ item, onClick }: ActionItemRowProps) {
  return (
    <li
      className={`action-item ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          onClick();
        }
      }}
    >
      <div className="action-item-main">
        <span className="action-item-title">{item.title}</span>
        <div className="action-item-tags">
          {item.tags.map((tag) => (
            <span key={tag} className={`action-tag tag-${tag.toLowerCase().replace(/\s+/g, '-')}`}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <p className="action-item-details">{item.details}</p>
    </li>
  );
}

// Export the type for other components
export type { ActionItem, ActionSeverity };
