/**
 * Utility for loading package data from chunked JSON files.
 *
 * Uses the same FNV-1a hash algorithm as the Python build script.
 */

import type { PackageAnalysis } from '../types/package';

const NUM_CHUNKS = 100;

// FNV-1a parameters for 32-bit
const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/**
 * Compute chunk ID for a package name using FNV-1a hash.
 * Must match the Python hash_to_chunk() function exactly.
 */
export function hashToChunk(name: string): number {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(name);

  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= byte;
    // Multiply and keep 32-bit (JavaScript bitwise ops work on 32-bit)
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash % NUM_CHUNKS;
}

/**
 * Get the chunk filename for a package.
 */
export function getChunkFilename(
  ecosystem: string,
  packageName: string
): string {
  const chunkId = hashToChunk(packageName);
  const paddedId = String(chunkId).padStart(3, '0');
  return `data/chunks/${ecosystem}/chunk_${paddedId}.json`;
}

// Cache for loaded chunks to avoid re-fetching
const chunkCache = new Map<string, Promise<Record<string, PackageAnalysis>>>();

/**
 * Load a package from chunked storage.
 *
 * @param ecosystem - The ecosystem (npm, pypi, homebrew)
 * @param packageName - The package name
 * @param baseUrl - Base URL for fetching (import.meta.env.BASE_URL)
 * @returns The package analysis data, or null if not found
 */
export async function loadPackageFromChunk(
  ecosystem: string,
  packageName: string,
  baseUrl: string
): Promise<PackageAnalysis | null> {
  const chunkFilename = getChunkFilename(ecosystem, packageName);
  const chunkUrl = `${baseUrl}${chunkFilename}`;

  // Check cache first
  let chunkPromise = chunkCache.get(chunkUrl);

  if (!chunkPromise) {
    // Fetch and cache the chunk
    chunkPromise = fetch(chunkUrl)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load chunk: ${res.status}`);
        }
        const data = await res.json();
        return data.packages as Record<string, PackageAnalysis>;
      })
      .catch((err) => {
        // Remove failed promise from cache so retry is possible
        chunkCache.delete(chunkUrl);
        throw err;
      });

    chunkCache.set(chunkUrl, chunkPromise);
  }

  try {
    const packages = await chunkPromise;
    return packages[packageName] || null;
  } catch {
    return null;
  }
}

/**
 * Clear the chunk cache (useful for testing or forced refresh).
 */
export function clearChunkCache(): void {
  chunkCache.clear();
}
