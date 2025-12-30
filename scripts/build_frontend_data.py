#!/usr/bin/env python3
"""Build frontend data from analyzed packages."""

import json
import shutil
from pathlib import Path


def main():
    # Paths
    data_dir = Path("data/analyzed")
    frontend_public = Path("frontend/public/data")

    # Ensure frontend data directory exists
    frontend_public.mkdir(parents=True, exist_ok=True)

    # Copy analyzed directory structure
    analyzed_dest = frontend_public / "analyzed"
    if analyzed_dest.exists():
        shutil.rmtree(analyzed_dest)
    shutil.copytree(data_dir, analyzed_dest)
    print(f"Copied analyzed data to {analyzed_dest}")

    # Build summary for each ecosystem
    for ecosystem_dir in data_dir.iterdir():
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

                summary.append({
                    "name": data.get("name"),
                    "version": data.get("version"),
                    "description": data.get("description"),
                    "install_count_30d": data.get("install_count_30d"),
                    "data_availability": data.get("data_availability"),
                    "unavailable_reason": data.get("unavailable_reason"),
                    "scores": data.get("scores"),
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
                })
            except Exception as e:
                print(f"Error processing {pkg_file}: {e}")

        # Sort by install count (descending), with None values at end
        summary.sort(
            key=lambda x: (x.get("install_count_30d") or 0),
            reverse=True
        )

        # Save summary
        summary_file = frontend_public / f"{ecosystem}.json"
        summary_file.write_text(json.dumps(summary, indent=2))
        print(f"Created summary: {summary_file} ({len(summary)} packages)")


if __name__ == "__main__":
    main()
