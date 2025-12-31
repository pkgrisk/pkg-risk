import type { ParsedDependency, ParserResult } from '../../types/package';

export function parseRequirementsTxt(content: string, filename: string): ParserResult {
  const errors: string[] = [];
  const dependencies: ParsedDependency[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Skip options like -r, -e, -i, --index-url, etc.
    if (line.startsWith('-')) {
      continue;
    }

    // Skip URLs (git+, http://, etc.)
    if (line.includes('://') || line.startsWith('git+')) {
      continue;
    }

    try {
      const parsed = parseRequirementLine(line);
      if (parsed) {
        dependencies.push({
          ...parsed,
          ecosystem: 'pypi',
        });
      }
    } catch (e) {
      errors.push(`Line ${i + 1}: Failed to parse "${line.substring(0, 50)}..."`);
    }
  }

  if (dependencies.length === 0 && errors.length === 0) {
    errors.push('No dependencies found in requirements.txt');
  }

  return {
    dependencies,
    ecosystem: 'pypi',
    filename,
    errors,
  };
}

function parseRequirementLine(line: string): { name: string; version?: string } | null {
  // Remove environment markers (e.g., ; python_version >= "3.8")
  const markerIndex = line.indexOf(';');
  if (markerIndex !== -1) {
    line = line.substring(0, markerIndex).trim();
  }

  // Remove extras (e.g., package[extra1,extra2])
  const extrasMatch = line.match(/^([a-zA-Z0-9_-]+)\[/);
  if (extrasMatch) {
    const bracketEnd = line.indexOf(']');
    if (bracketEnd !== -1) {
      line = extrasMatch[1] + line.substring(bracketEnd + 1);
    }
  }

  // Match package name and optional version specifier
  // Supports: ==, >=, <=, !=, ~=, >, <
  const match = line.match(/^([a-zA-Z0-9_.-]+)\s*((?:==|>=|<=|!=|~=|>|<)[^\s;]+)?/);

  if (!match) {
    return null;
  }

  const name = normalizePyPIName(match[1]);
  const versionSpec = match[2];

  return {
    name,
    version: versionSpec ? cleanPyPIVersion(versionSpec) : undefined,
  };
}

function normalizePyPIName(name: string): string {
  // PyPI treats [-_.] as equivalent, normalize to lowercase with hyphens
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function cleanPyPIVersion(version: string): string {
  // Extract just the version number, removing operators
  const match = version.match(/[0-9][0-9a-zA-Z.]*$/);
  return match ? match[0] : version;
}
