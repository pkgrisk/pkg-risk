import type { PackageSummary, Repository } from '../types/package';

interface RowActionsProps {
  pkg: PackageSummary;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  });
}

function getGitHubUrl(repository: Repository | null): string | null {
  if (!repository) return null;
  if (repository.platform !== 'github') return null;
  return `https://github.com/${repository.owner}/${repository.repo}`;
}

export function RowActions({ pkg }: RowActionsProps) {
  const githubUrl = getGitHubUrl(pkg.repository);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(pkg.name);
  };

  const handleGitHub = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (githubUrl) {
      window.open(githubUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      <button
        className="row-action-btn"
        onClick={handleCopy}
        title="Copy package name"
      >
        <span className="action-icon">📋</span>
      </button>
      {githubUrl && (
        <button
          className="row-action-btn"
          onClick={handleGitHub}
          title="Open on GitHub"
        >
          <span className="action-icon">🔗</span>
        </button>
      )}
    </div>
  );
}

export default RowActions;
