#!/usr/bin/env python3
"""Build frontend data from analyzed packages."""

import json
import shutil
from pathlib import Path
from collections import Counter


def calculate_percentiles(packages: list[dict]) -> list[dict]:
    """Calculate percentile ranks within ecosystem.

    Packages without scores get percentile=None.
    """
    # Filter to packages with scores
    scored = [p for p in packages if p.get("scores") and p["scores"].get("overall")]

    if not scored:
        return packages

    # Sort by overall score (ascending for percentile calc)
    scored_sorted = sorted(scored, key=lambda p: p["scores"]["overall"])

    n = len(scored_sorted)
    for i, pkg in enumerate(scored_sorted):
        # Percentile = (rank / total) * 100
        percentile = ((i + 1) / n) * 100
        pkg["scores"]["percentile"] = round(percentile, 1)

    return packages


def calculate_ecosystem_stats(packages: list[dict]) -> dict:
    """Calculate score distribution statistics for an ecosystem."""
    scored = [p for p in packages if p.get("scores") and p["scores"].get("overall")]

    if not scored:
        return {}

    scores = [p["scores"]["overall"] for p in scored]
    grades = [p["scores"]["grade"] for p in scored]

    # Grade distribution
    grade_counts = Counter(grades)

    # Score statistics
    scores_sorted = sorted(scores)
    n = len(scores_sorted)

    stats = {
        "total_packages": len(packages),
        "scored_packages": len(scored),
        "unavailable_packages": len(packages) - len(scored),
        "score_distribution": {
            "min": round(min(scores), 1),
            "max": round(max(scores), 1),
            "median": round(scores_sorted[n // 2], 1),
            "p25": round(scores_sorted[n // 4], 1),
            "p75": round(scores_sorted[3 * n // 4], 1),
        },
        "grade_distribution": {
            "A": grade_counts.get("A", 0),
            "B": grade_counts.get("B", 0),
            "C": grade_counts.get("C", 0),
            "D": grade_counts.get("D", 0),
            "F": grade_counts.get("F", 0),
        },
        "risk_tier_distribution": Counter(
            p["scores"].get("risk_tier") for p in scored if p["scores"].get("risk_tier")
        ),
    }

    return stats


def main():
    # Paths
    data_dir = Path("data/analyzed")
    frontend_public = Path("frontend/public/data")
    analyzed_dest = frontend_public / "analyzed"

    # Ensure frontend data directory exists
    frontend_public.mkdir(parents=True, exist_ok=True)
    analyzed_dest.mkdir(parents=True, exist_ok=True)

    # Merge data from both locations (data/analyzed and frontend/public/data/analyzed)
    # Prefer newer files when duplicates exist
    source_dirs = [data_dir, analyzed_dest]

    for source_dir in source_dirs:
        if not source_dir.exists():
            continue
        for ecosystem_dir in source_dir.iterdir():
            if not ecosystem_dir.is_dir():
                continue
            dest_ecosystem = analyzed_dest / ecosystem_dir.name
            dest_ecosystem.mkdir(parents=True, exist_ok=True)

            for pkg_file in ecosystem_dir.glob("*.json"):
                dest_file = dest_ecosystem / pkg_file.name
                # Copy if dest doesn't exist or source is newer
                if not dest_file.exists() or pkg_file.stat().st_mtime > dest_file.stat().st_mtime:
                    if source_dir != analyzed_dest:  # Don't copy to itself
                        shutil.copy2(pkg_file, dest_file)

    print(f"Merged analyzed data to {analyzed_dest}")

    # Build summary for each ecosystem from the merged data
    for ecosystem_dir in analyzed_dest.iterdir():
        if not ecosystem_dir.is_dir():
            continue

        ecosystem = ecosystem_dir.name
        summary = []

        for pkg_file in ecosystem_dir.glob("*.json"):
            try:
                data = json.loads(pkg_file.read_text())

                # Extract key risk indicators from github_data
                github_data = data.get("github_data") or {}
                commits = github_data.get("commits") or {}
                security = github_data.get("security") or {}
                contributors = github_data.get("contributors") or {}
                cve_history = security.get("cve_history") or {}

                # Get scores and extract new statistical fields
                scores = data.get("scores")

                summary.append({
                    "name": data.get("name"),
                    "version": data.get("version"),
                    "description": data.get("description"),
                    "install_count_30d": data.get("install_count_30d"),
                    "data_availability": data.get("data_availability"),
                    "unavailable_reason": data.get("unavailable_reason"),
                    "scores": scores,
                    "analysis_summary": data.get("analysis_summary"),
                    "repository": data.get("repository"),
                    "analyzed_at": data.get("analyzed_at"),
                    # Risk indicators for dashboard
                    "last_commit_date": commits.get("last_commit_date"),
                    "cve_count": security.get("known_cves", 0),
                    "has_unpatched_cves": cve_history.get("has_unpatched", False),
                    "top_contributor_pct": contributors.get("top_contributor_pct"),
                    "has_security_policy": security.get("has_security_md") or security.get("has_security_policy"),
                    "has_security_tools": security.get("has_dependabot") or security.get("has_codeql"),
                    # New statistical fields (if scores exist)
                    "risk_tier": scores.get("risk_tier") if scores else None,
                    "update_urgency": scores.get("update_urgency") if scores else None,
                    "confidence": scores.get("confidence") if scores else None,
                    "project_age_band": scores.get("project_age_band") if scores else None,
                })
            except Exception as e:
                print(f"Error processing {pkg_file}: {e}")

        # Sort by install count (descending), with None values at end
        summary.sort(
            key=lambda x: (x.get("install_count_30d") or 0),
            reverse=True
        )

        # Calculate ecosystem percentiles
        summary = calculate_percentiles(summary)

        # Calculate ecosystem statistics
        stats = calculate_ecosystem_stats(summary)

        # Save summary
        summary_file = frontend_public / f"{ecosystem}.json"
        summary_file.write_text(json.dumps(summary, indent=2))

        # Save ecosystem stats
        if stats:
            stats_file = frontend_public / f"{ecosystem}_stats.json"
            stats_file.write_text(json.dumps(stats, indent=2))
            print(f"Created stats: {stats_file}")

        scored_count = len([p for p in summary if p.get("scores")])
        print(f"Created summary: {summary_file} ({len(summary)} packages, {scored_count} scored)")


if __name__ == "__main__":
    main()
