import type { ParsedDependency, ParserResult } from '../../types/package';

interface BunLockWorkspace {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface BunLockfile {
  lockfileVersion: number;
  workspaces: Record<string, BunLockWorkspace>;
  packages?: Record<string, unknown>;
}

/**
 * Strip single-line (//) and multi-line comments from JSONC content.
 * Preserves strings containing comment-like sequences.
 */
function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      result += char;
      if (char === '\\') {
        // Skip escaped character
        result += next ?? '';
        i += 2;
        continue;
      }
      if (char === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      result += char;
      i++;
      continue;
    }

    if (char === '/' && next === '/') {
      // Single-line comment — skip to end of line
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    if (char === '/' && next === '*') {
      // Multi-line comment — skip to closing */
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip closing */
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

export function parseBunLock(content: string, filename: string): ParserResult {
  const errors: string[] = [];
  const dependencies: ParsedDependency[] = [];
  const seen = new Set<string>();

  try {
    const cleanContent = stripJsoncComments(content);
    const lockfile: BunLockfile = JSON.parse(cleanContent);

    if (!lockfile.workspaces || typeof lockfile.workspaces !== 'object') {
      errors.push('Invalid bun.lock: missing "workspaces" field');
      return { dependencies, ecosystem: 'npm', filename, errors };
    }

    for (const workspace of Object.values(lockfile.workspaces)) {
      addDeps(workspace.dependencies, false, seen, dependencies);
      addDeps(workspace.devDependencies, true, seen, dependencies);
      addDeps(workspace.peerDependencies, false, seen, dependencies);
      addDeps(workspace.optionalDependencies, false, seen, dependencies);
    }

    if (dependencies.length === 0) {
      errors.push('No dependencies found in bun.lock');
    }
  } catch (e) {
    errors.push(`Failed to parse bun.lock: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return { dependencies, ecosystem: 'npm', filename, errors };
}

function addDeps(
  deps: Record<string, string> | undefined,
  isDev: boolean,
  seen: Set<string>,
  out: ParsedDependency[]
): void {
  if (!deps) return;

  for (const [name, version] of Object.entries(deps)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      version: cleanVersion(version),
      isDev,
      ecosystem: 'npm',
    });
  }
}

function cleanVersion(version: string): string {
  return version.replace(/^[\^~>=<]+/, '').trim();
}
