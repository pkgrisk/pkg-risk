import type { ParsedDependency, ParserResult } from '../../types/package';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export function parsePackageJson(content: string, filename: string): ParserResult {
  const errors: string[] = [];
  const dependencies: ParsedDependency[] = [];

  try {
    const pkg: PackageJson = JSON.parse(content);

    // Parse regular dependencies
    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        dependencies.push({
          name,
          version: cleanVersion(version),
          isDev: false,
          ecosystem: 'npm',
        });
      }
    }

    // Parse dev dependencies
    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        dependencies.push({
          name,
          version: cleanVersion(version),
          isDev: true,
          ecosystem: 'npm',
        });
      }
    }

    // Parse peer dependencies (mark as non-dev since they're runtime requirements)
    if (pkg.peerDependencies) {
      for (const [name, version] of Object.entries(pkg.peerDependencies)) {
        // Skip if already added from dependencies
        if (!dependencies.some(d => d.name === name)) {
          dependencies.push({
            name,
            version: cleanVersion(version),
            isDev: false,
            ecosystem: 'npm',
          });
        }
      }
    }

    // Parse optional dependencies
    if (pkg.optionalDependencies) {
      for (const [name, version] of Object.entries(pkg.optionalDependencies)) {
        // Skip if already added
        if (!dependencies.some(d => d.name === name)) {
          dependencies.push({
            name,
            version: cleanVersion(version),
            isDev: false,
            ecosystem: 'npm',
          });
        }
      }
    }

    if (dependencies.length === 0) {
      errors.push('No dependencies found in package.json');
    }
  } catch (e) {
    errors.push(`Failed to parse JSON: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return {
    dependencies,
    ecosystem: 'npm',
    filename,
    errors,
  };
}

function cleanVersion(version: string): string {
  // Remove common prefixes like ^, ~, >=, etc.
  return version.replace(/^[\^~>=<]+/, '').trim();
}
