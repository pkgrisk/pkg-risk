import { parse as parseToml } from 'smol-toml';
import type { ParsedDependency, ParserResult } from '../../types/package';

interface Pipfile {
  packages?: Record<string, string | { version?: string; extras?: string[] }>;
  'dev-packages'?: Record<string, string | { version?: string; extras?: string[] }>;
}

export function parsePipfile(content: string, filename: string): ParserResult {
  const errors: string[] = [];
  const dependencies: ParsedDependency[] = [];

  try {
    const pipfile = parseToml(content) as Pipfile;

    // Parse production packages
    if (pipfile.packages) {
      for (const [name, spec] of Object.entries(pipfile.packages)) {
        const version = extractVersion(spec);
        dependencies.push({
          name: normalizePyPIName(name),
          version,
          isDev: false,
          ecosystem: 'pypi',
        });
      }
    }

    // Parse dev packages
    if (pipfile['dev-packages']) {
      for (const [name, spec] of Object.entries(pipfile['dev-packages'])) {
        const version = extractVersion(spec);
        dependencies.push({
          name: normalizePyPIName(name),
          version,
          isDev: true,
          ecosystem: 'pypi',
        });
      }
    }

    if (dependencies.length === 0) {
      errors.push('No packages found in Pipfile');
    }
  } catch (e) {
    errors.push(`Failed to parse Pipfile: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return {
    dependencies,
    ecosystem: 'pypi',
    filename,
    errors,
  };
}

function extractVersion(spec: string | { version?: string }): string | undefined {
  if (typeof spec === 'string') {
    if (spec === '*') return undefined;
    return cleanVersion(spec);
  }
  if (spec.version && spec.version !== '*') {
    return cleanVersion(spec.version);
  }
  return undefined;
}

function cleanVersion(version: string): string {
  // Remove operators like ==, >=, ~=
  return version.replace(/^[\^~>=<!=]+/, '').trim();
}

function normalizePyPIName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}
