import { parse as parseToml } from 'smol-toml';
import type { ParsedDependency, ParserResult } from '../../types/package';

interface PyProjectToml {
  project?: {
    dependencies?: string[];
    'optional-dependencies'?: Record<string, string[]>;
  };
  tool?: {
    poetry?: {
      dependencies?: Record<string, string | { version?: string }>;
      'dev-dependencies'?: Record<string, string | { version?: string }>;
      group?: Record<string, { dependencies?: Record<string, string | { version?: string }> }>;
    };
  };
  'build-system'?: {
    requires?: string[];
  };
}

export function parsePyProjectToml(content: string, filename: string): ParserResult {
  const errors: string[] = [];
  const dependencies: ParsedDependency[] = [];

  try {
    const pyproject = parseToml(content) as PyProjectToml;

    // PEP 621 format (project.dependencies)
    if (pyproject.project?.dependencies) {
      for (const dep of pyproject.project.dependencies) {
        const parsed = parsePEP508(dep);
        if (parsed) {
          dependencies.push({
            ...parsed,
            isDev: false,
            ecosystem: 'pypi',
          });
        }
      }
    }

    // PEP 621 optional dependencies
    if (pyproject.project?.['optional-dependencies']) {
      for (const [group, deps] of Object.entries(pyproject.project['optional-dependencies'])) {
        const isDev = group === 'dev' || group === 'test' || group === 'testing';
        for (const dep of deps) {
          const parsed = parsePEP508(dep);
          if (parsed && !dependencies.some(d => d.name === parsed.name)) {
            dependencies.push({
              ...parsed,
              isDev,
              ecosystem: 'pypi',
            });
          }
        }
      }
    }

    // Poetry format (tool.poetry.dependencies)
    if (pyproject.tool?.poetry?.dependencies) {
      for (const [name, spec] of Object.entries(pyproject.tool.poetry.dependencies)) {
        if (name === 'python') continue; // Skip python version constraint
        const version = typeof spec === 'string' ? spec : spec.version;
        if (!dependencies.some(d => d.name === normalizePyPIName(name))) {
          dependencies.push({
            name: normalizePyPIName(name),
            version: version ? cleanPoetryVersion(version) : undefined,
            isDev: false,
            ecosystem: 'pypi',
          });
        }
      }
    }

    // Poetry dev dependencies
    if (pyproject.tool?.poetry?.['dev-dependencies']) {
      for (const [name, spec] of Object.entries(pyproject.tool.poetry['dev-dependencies'])) {
        const version = typeof spec === 'string' ? spec : spec.version;
        if (!dependencies.some(d => d.name === normalizePyPIName(name))) {
          dependencies.push({
            name: normalizePyPIName(name),
            version: version ? cleanPoetryVersion(version) : undefined,
            isDev: true,
            ecosystem: 'pypi',
          });
        }
      }
    }

    // Poetry groups (poetry 1.2+)
    if (pyproject.tool?.poetry?.group) {
      for (const [groupName, group] of Object.entries(pyproject.tool.poetry.group)) {
        const isDev = groupName === 'dev' || groupName === 'test';
        if (group.dependencies) {
          for (const [name, spec] of Object.entries(group.dependencies)) {
            const version = typeof spec === 'string' ? spec : spec.version;
            if (!dependencies.some(d => d.name === normalizePyPIName(name))) {
              dependencies.push({
                name: normalizePyPIName(name),
                version: version ? cleanPoetryVersion(version) : undefined,
                isDev,
                ecosystem: 'pypi',
              });
            }
          }
        }
      }
    }

    if (dependencies.length === 0) {
      errors.push('No dependencies found in pyproject.toml');
    }
  } catch (e) {
    errors.push(`Failed to parse TOML: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return {
    dependencies,
    ecosystem: 'pypi',
    filename,
    errors,
  };
}

function parsePEP508(spec: string): { name: string; version?: string } | null {
  // PEP 508 format: name[extras](<version>); markers
  // Examples: requests>=2.0, numpy[dev]==1.0, flask; python_version>="3.8"

  // Remove markers
  const markerIndex = spec.indexOf(';');
  if (markerIndex !== -1) {
    spec = spec.substring(0, markerIndex).trim();
  }

  // Remove extras
  const extrasMatch = spec.match(/^([a-zA-Z0-9_.-]+)\[/);
  if (extrasMatch) {
    const bracketEnd = spec.indexOf(']');
    if (bracketEnd !== -1) {
      spec = extrasMatch[1] + spec.substring(bracketEnd + 1);
    }
  }

  // Match name and version
  const match = spec.match(/^([a-zA-Z0-9_.-]+)\s*((?:==|>=|<=|!=|~=|>|<|@)[^\s;]+)?/);
  if (!match) return null;

  return {
    name: normalizePyPIName(match[1]),
    version: match[2] ? cleanPEP508Version(match[2]) : undefined,
  };
}

function normalizePyPIName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function cleanPEP508Version(version: string): string {
  // Handle @ for URL specs
  if (version.startsWith('@')) return version;
  const match = version.match(/[0-9][0-9a-zA-Z.]*$/);
  return match ? match[0] : version;
}

function cleanPoetryVersion(version: string): string {
  // Poetry uses ^, ~, etc. similar to npm
  return version.replace(/^[\^~>=<]+/, '').trim();
}
