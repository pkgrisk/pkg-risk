#!/usr/bin/env python3
"""Build chunked JSON files from individual package analysis files.

This script reads all package JSON files from analyzed/{ecosystem}/ directories
and groups them into ~100 chunks per ecosystem for faster GitHub Pages deployment.

Chunking strategy: hash(package_name) % NUM_CHUNKS
This is deterministic, so the frontend can compute the chunk ID without an index.
"""

import json
import sys
from pathlib import Path


# Number of chunks per ecosystem
NUM_CHUNKS = 100


def hash_to_chunk(name: str, num_chunks: int = NUM_CHUNKS) -> int:
    """Compute chunk ID from package name using FNV-1a hash.

    Uses FNV-1a algorithm which is simple and consistent across languages.
    The same algorithm must be used in the frontend.
    """
    # FNV-1a parameters for 32-bit
    FNV_PRIME = 0x01000193
    FNV_OFFSET = 0x811c9dc5

    hash_value = FNV_OFFSET
    for byte in name.encode('utf-8'):
        hash_value ^= byte
        hash_value = (hash_value * FNV_PRIME) & 0xFFFFFFFF  # Keep 32-bit

    return hash_value % num_chunks


def build_chunks_for_ecosystem(
    analyzed_dir: Path,
    chunks_dir: Path,
    ecosystem: str,
) -> dict:
    """Build chunk files for a single ecosystem.

    Args:
        analyzed_dir: Path to analyzed/{ecosystem}/ directory
        chunks_dir: Path to output chunks/{ecosystem}/ directory
        ecosystem: Ecosystem name (npm, pypi, homebrew)

    Returns:
        Stats dict with counts
    """
    source_dir = analyzed_dir / ecosystem
    output_dir = chunks_dir / ecosystem

    if not source_dir.exists():
        print(f"  Skipping {ecosystem}: {source_dir} does not exist")
        return {"ecosystem": ecosystem, "packages": 0, "chunks": 0}

    # Initialize chunk buckets
    chunks: dict[int, dict] = {i: {} for i in range(NUM_CHUNKS)}

    # Read all package files and distribute to chunks
    package_files = list(source_dir.glob("*.json"))
    print(f"  Found {len(package_files)} packages in {ecosystem}")

    for pkg_file in package_files:
        try:
            data = json.loads(pkg_file.read_text())
            pkg_name = data.get("name", pkg_file.stem)
            chunk_id = hash_to_chunk(pkg_name)
            chunks[chunk_id][pkg_name] = data
        except (json.JSONDecodeError, OSError) as e:
            print(f"  Warning: Failed to read {pkg_file}: {e}")
            continue

    # Write chunk files
    output_dir.mkdir(parents=True, exist_ok=True)

    non_empty_chunks = 0
    for chunk_id, packages in chunks.items():
        if not packages:
            continue

        chunk_file = output_dir / f"chunk_{chunk_id:03d}.json"
        chunk_data = {"packages": packages}
        chunk_file.write_text(json.dumps(chunk_data, separators=(',', ':')))
        non_empty_chunks += 1

    print(f"  Written {non_empty_chunks} chunks for {ecosystem}")

    return {
        "ecosystem": ecosystem,
        "packages": len(package_files),
        "chunks": non_empty_chunks,
    }


def build_all_chunks(data_dir: Path) -> None:
    """Build chunks for all ecosystems.

    Args:
        data_dir: Root data directory (e.g., frontend/public/data)
    """
    analyzed_dir = data_dir / "analyzed"
    chunks_dir = data_dir / "chunks"

    print(f"Building chunks from {analyzed_dir} to {chunks_dir}")
    print(f"Using {NUM_CHUNKS} chunks per ecosystem")
    print()

    ecosystems = ["npm", "pypi", "homebrew"]
    stats = []

    for ecosystem in ecosystems:
        result = build_chunks_for_ecosystem(analyzed_dir, chunks_dir, ecosystem)
        stats.append(result)

    # Print summary
    print()
    print("=" * 50)
    print("Summary:")
    total_packages = sum(s["packages"] for s in stats)
    total_chunks = sum(s["chunks"] for s in stats)
    print(f"  Total packages: {total_packages}")
    print(f"  Total chunks: {total_chunks}")
    print(f"  Reduction: {total_packages} files -> {total_chunks} files")

    # Write metadata
    meta_file = chunks_dir / "meta.json"
    meta = {
        "num_chunks": NUM_CHUNKS,
        "ecosystems": stats,
        "hash_algorithm": "md5_first4bytes_mod_chunks",
    }
    meta_file.write_text(json.dumps(meta, indent=2))
    print(f"  Metadata written to {meta_file}")


def main() -> int:
    """Main entry point."""
    data_dir = Path("frontend/public/data")

    if len(sys.argv) > 1:
        data_dir = Path(sys.argv[1])

    if not data_dir.exists():
        print(f"Error: Data directory {data_dir} does not exist")
        return 1

    build_all_chunks(data_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
