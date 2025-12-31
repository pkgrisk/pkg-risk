import type { ParsedDependency, ParserResult } from '../../types/package';

export function parseBrewfile(content: string, filename: string): ParserResult {
  const errors: string[] = [];
  const dependencies: ParsedDependency[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    try {
      const parsed = parseBrewfileLine(line);
      if (parsed) {
        // Avoid duplicates
        if (!dependencies.some(d => d.name === parsed.name)) {
          dependencies.push({
            ...parsed,
            ecosystem: 'homebrew',
          });
        }
      }
    } catch (e) {
      errors.push(`Line ${i + 1}: Failed to parse "${line.substring(0, 50)}"`);
    }
  }

  if (dependencies.length === 0 && errors.length === 0) {
    errors.push('No packages found in Brewfile');
  }

  return {
    dependencies,
    ecosystem: 'homebrew',
    filename,
    errors,
  };
}

function parseBrewfileLine(line: string): { name: string; isDev?: boolean } | null {
  // Brewfile formats:
  // brew "package"
  // brew "package", args: ["--with-option"]
  // cask "app"
  // tap "owner/repo"
  // mas "App Name", id: 123456

  // We only care about brew formulas for now
  // cask and mas are applications, not packages we can analyze

  // Match: brew "name" or brew 'name' or brew name
  const brewMatch = line.match(/^brew\s+["']?([a-zA-Z0-9_@./-]+)["']?/);
  if (brewMatch) {
    return {
      name: brewMatch[1],
      isDev: false,
    };
  }

  // Also support tap for tracking (though we won't analyze them)
  // For now, skip taps, casks, and mas entries

  return null;
}
