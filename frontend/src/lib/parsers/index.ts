import type { ParserResult } from '../../types/package';
import { parsePackageJson } from './npm';
import { parseRequirementsTxt } from './requirements';
import { parsePyProjectToml } from './pyproject';
import { parsePipfile } from './pipfile';
import { parseBrewfile } from './brewfile';

export type SupportedFilename =
  | 'package.json'
  | 'requirements.txt'
  | 'pyproject.toml'
  | 'Pipfile'
  | 'Brewfile';

const SUPPORTED_FILES: Record<SupportedFilename, (content: string, filename: string) => ParserResult> = {
  'package.json': parsePackageJson,
  'requirements.txt': parseRequirementsTxt,
  'pyproject.toml': parsePyProjectToml,
  'Pipfile': parsePipfile,
  'Brewfile': parseBrewfile,
};

export function isSupportedFile(filename: string): filename is SupportedFilename {
  return filename in SUPPORTED_FILES;
}

export function getSupportedFilenames(): SupportedFilename[] {
  return Object.keys(SUPPORTED_FILES) as SupportedFilename[];
}

export function parseFile(filename: string, content: string): ParserResult {
  const parser = SUPPORTED_FILES[filename as SupportedFilename];

  if (!parser) {
    return {
      dependencies: [],
      ecosystem: 'npm', // Default, won't matter since there's an error
      filename,
      errors: [
        `Unsupported file type: ${filename}. Supported files: ${getSupportedFilenames().join(', ')}`,
      ],
    };
  }

  return parser(content, filename);
}

export { parsePackageJson } from './npm';
export { parseRequirementsTxt } from './requirements';
export { parsePyProjectToml } from './pyproject';
export { parsePipfile } from './pipfile';
export { parseBrewfile } from './brewfile';
