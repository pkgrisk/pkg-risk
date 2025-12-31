import type { Ecosystem, RegistryMetadata } from '../types/package';

const REGISTRY_URLS = {
  npm: 'https://registry.npmjs.org',
  pypi: 'https://pypi.org/pypi',
  homebrew: 'https://formulae.brew.sh/api/formula',
} as const;

// Simple in-memory cache for the session
const cache = new Map<string, RegistryMetadata | null>();

export async function fetchRegistryMetadata(
  name: string,
  ecosystem: Ecosystem
): Promise<RegistryMetadata | null> {
  const cacheKey = `${ecosystem}:${name}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  try {
    let metadata: RegistryMetadata | null = null;

    switch (ecosystem) {
      case 'npm':
        metadata = await fetchNpmMetadata(name);
        break;
      case 'pypi':
        metadata = await fetchPyPIMetadata(name);
        break;
      case 'homebrew':
        metadata = await fetchHomebrewMetadata(name);
        break;
    }

    cache.set(cacheKey, metadata);
    return metadata;
  } catch (e) {
    console.warn(`Failed to fetch registry data for ${ecosystem}:${name}`, e);
    cache.set(cacheKey, null);
    return null;
  }
}

async function fetchNpmMetadata(name: string): Promise<RegistryMetadata | null> {
  // URL-encode scoped packages
  const encodedName = name.replace('/', '%2F');
  const url = `${REGISTRY_URLS.npm}/${encodedName}`;

  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const latestVersion = data['dist-tags']?.latest;
  const versionData = latestVersion ? data.versions?.[latestVersion] : null;

  return {
    name: data.name,
    version: latestVersion || 'unknown',
    description: data.description || '',
    homepage: data.homepage || versionData?.homepage,
    repository: extractRepoUrl(data.repository || versionData?.repository),
    license: extractLicense(data.license || versionData?.license),
  };
}

async function fetchPyPIMetadata(name: string): Promise<RegistryMetadata | null> {
  // Normalize PyPI package name
  const normalizedName = name.toLowerCase().replace(/[-_.]+/g, '-');
  const url = `${REGISTRY_URLS.pypi}/${normalizedName}/json`;

  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const info = data.info;

  return {
    name: info.name,
    version: info.version || 'unknown',
    description: info.summary || '',
    homepage: info.home_page || info.project_urls?.Homepage,
    repository: extractPyPIRepoUrl(info.project_urls),
    license: info.license || undefined,
  };
}

async function fetchHomebrewMetadata(name: string): Promise<RegistryMetadata | null> {
  const url = `${REGISTRY_URLS.homebrew}/${name}.json`;

  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  return {
    name: data.name,
    version: data.versions?.stable || 'unknown',
    description: data.desc || '',
    homepage: data.homepage,
    repository: data.urls?.stable?.url,
    license: data.license,
  };
}

function extractRepoUrl(repository: unknown): string | undefined {
  if (!repository) return undefined;

  if (typeof repository === 'string') {
    return cleanRepoUrl(repository);
  }

  if (typeof repository === 'object' && 'url' in repository) {
    return cleanRepoUrl((repository as { url: string }).url);
  }

  return undefined;
}

function cleanRepoUrl(url: string): string {
  // Clean up common npm URL patterns
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/^github:/, 'https://github.com/');
}

function extractPyPIRepoUrl(projectUrls: Record<string, string> | null): string | undefined {
  if (!projectUrls) return undefined;

  // Try common keys
  const keys = ['Source', 'Source Code', 'Repository', 'GitHub', 'Code', 'Homepage'];
  for (const key of keys) {
    const url = projectUrls[key];
    if (url && (url.includes('github.com') || url.includes('gitlab.com'))) {
      return url;
    }
  }

  return undefined;
}

function extractLicense(license: unknown): string | undefined {
  if (!license) return undefined;

  if (typeof license === 'string') {
    return license;
  }

  if (typeof license === 'object') {
    if ('type' in license) return (license as { type: string }).type;
    if ('name' in license) return (license as { name: string }).name;
  }

  return undefined;
}

// Batch fetch with concurrency control
export async function fetchRegistryMetadataBatch(
  packages: Array<{ name: string; ecosystem: Ecosystem }>,
  concurrency = 5,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, RegistryMetadata | null>> {
  const results = new Map<string, RegistryMetadata | null>();
  let completed = 0;

  // Process in batches
  for (let i = 0; i < packages.length; i += concurrency) {
    const batch = packages.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (pkg) => {
        const metadata = await fetchRegistryMetadata(pkg.name, pkg.ecosystem);
        completed++;
        onProgress?.(completed, packages.length);
        return { key: `${pkg.ecosystem}:${pkg.name}`, metadata };
      })
    );

    for (const { key, metadata } of batchResults) {
      results.set(key, metadata);
    }

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < packages.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

// Clear the cache (useful for testing or refresh)
export function clearRegistryCache(): void {
  cache.clear();
}
