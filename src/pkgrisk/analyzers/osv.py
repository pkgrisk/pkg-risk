"""OSV (Open Source Vulnerabilities) fetcher for CVE data."""

from datetime import datetime, timezone

import httpx

from pkgrisk.models.schemas import CVEDetail, CVEHistory, ReleaseStats


class OSVFetcher:
    """Fetches vulnerability data from OSV (Open Source Vulnerabilities) database.

    OSV is a distributed vulnerability database for open source:
    https://osv.dev/

    No authentication required.
    """

    BASE_URL = "https://api.osv.dev/v1"

    # Map our ecosystem names to OSV ecosystem names
    ECOSYSTEM_MAP = {
        "npm": "npm",
        "pypi": "PyPI",
        "crates": "crates.io",
        "homebrew": None,  # Query by GitHub repo instead
    }

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        """Initialize the fetcher.

        Args:
            client: Optional httpx client. If not provided, creates one per request.
        """
        self._client = client

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create an HTTP client."""
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=30.0)

    async def _query(self, body: dict) -> list[dict]:
        """Query OSV API.

        Args:
            body: Request body for OSV query.

        Returns:
            List of vulnerability records.
        """
        client = await self._get_client()
        url = f"{self.BASE_URL}/query"

        try:
            response = await client.post(url, json=body)
            response.raise_for_status()
            data = response.json()
            return data.get("vulns", [])
        except httpx.HTTPStatusError:
            return []
        finally:
            if self._client is None:
                await client.aclose()

    async def fetch_by_package(
        self,
        package_name: str,
        ecosystem: str,
    ) -> list[dict]:
        """Fetch vulnerabilities for a package by name and ecosystem.

        Args:
            package_name: Package name.
            ecosystem: Our ecosystem name (npm, pypi, crates).

        Returns:
            List of OSV vulnerability records.
        """
        osv_ecosystem = self.ECOSYSTEM_MAP.get(ecosystem)
        if not osv_ecosystem:
            return []

        body = {
            "package": {
                "name": package_name,
                "ecosystem": osv_ecosystem,
            }
        }
        return await self._query(body)

    async def fetch_by_repo(
        self,
        owner: str,
        repo: str,
    ) -> list[dict]:
        """Fetch vulnerabilities for a GitHub repository.

        Uses the purl (package URL) format to query by repo.

        Args:
            owner: GitHub owner.
            repo: GitHub repo name.

        Returns:
            List of OSV vulnerability records.
        """
        # Query using GitHub advisory source
        # OSV aggregates GitHub Security Advisories
        body = {
            "package": {
                "purl": f"pkg:github/{owner}/{repo}",
            }
        }
        return await self._query(body)

    def _parse_severity(self, vuln: dict) -> tuple[str, float | None]:
        """Extract severity and CVSS score from OSV record.

        Args:
            vuln: OSV vulnerability record.

        Returns:
            Tuple of (severity_string, cvss_score).
        """
        severity = "UNKNOWN"
        cvss_score = None

        # Check severity array
        severities = vuln.get("severity", [])
        for sev in severities:
            if sev.get("type") == "CVSS_V3":
                score_str = sev.get("score", "")
                # Extract score from CVSS vector or use direct score
                if isinstance(score_str, (int, float)):
                    cvss_score = float(score_str)
                elif "/" in score_str:
                    # Parse CVSS vector string (e.g., "CVSS:3.1/AV:N/AC:L/...")
                    # The base score is often in database_specific
                    pass

        # Check database_specific for CVSS
        db_specific = vuln.get("database_specific", {})
        if "cvss" in db_specific:
            cvss_data = db_specific["cvss"]
            if isinstance(cvss_data, dict):
                cvss_score = cvss_data.get("score")
            elif isinstance(cvss_data, (int, float)):
                cvss_score = float(cvss_data)

        # Also check severity in database_specific
        if "severity" in db_specific:
            severity = db_specific["severity"].upper()

        # Determine severity from CVSS score if not explicitly set
        if severity == "UNKNOWN" and cvss_score is not None:
            if cvss_score >= 9.0:
                severity = "CRITICAL"
            elif cvss_score >= 7.0:
                severity = "HIGH"
            elif cvss_score >= 4.0:
                severity = "MEDIUM"
            else:
                severity = "LOW"

        # Check ecosystem_specific for npm/pypi severity
        for eco_data in vuln.get("affected", []):
            eco_specific = eco_data.get("ecosystem_specific", {})
            if "severity" in eco_specific:
                severity = eco_specific["severity"].upper()
                break

        return severity, cvss_score

    def _parse_fixed_version(self, vuln: dict) -> str | None:
        """Extract the first fixed version from OSV record.

        Args:
            vuln: OSV vulnerability record.

        Returns:
            Fixed version string or None.
        """
        for affected in vuln.get("affected", []):
            for rng in affected.get("ranges", []):
                for event in rng.get("events", []):
                    if "fixed" in event:
                        return event["fixed"]
        return None

    def _parse_references(self, vuln: dict) -> list[str]:
        """Extract reference URLs from OSV record.

        Args:
            vuln: OSV vulnerability record.

        Returns:
            List of reference URLs.
        """
        refs = []
        for ref in vuln.get("references", []):
            url = ref.get("url")
            if url:
                refs.append(url)
        return refs[:5]  # Limit to 5 references

    def _find_release_date(
        self,
        version: str,
        releases: ReleaseStats | None,
        release_dates: dict[str, datetime] | None = None,
    ) -> datetime | None:
        """Find the release date for a specific version.

        Args:
            version: Version string to find.
            releases: ReleaseStats from GitHub data.
            release_dates: Optional dict mapping version -> release date.

        Returns:
            Release datetime or None.
        """
        if release_dates and version in release_dates:
            return release_dates[version]

        # Try common version formats
        if release_dates:
            # Try with 'v' prefix
            if f"v{version}" in release_dates:
                return release_dates[f"v{version}"]
            # Try without 'v' prefix
            if version.startswith("v") and version[1:] in release_dates:
                return release_dates[version[1:]]

        return None

    async def fetch_cve_history(
        self,
        package_name: str,
        ecosystem: str,
        releases: ReleaseStats | None = None,
        owner: str | None = None,
        repo: str | None = None,
        release_dates: dict[str, datetime] | None = None,
    ) -> CVEHistory:
        """Fetch complete CVE history for a package.

        Args:
            package_name: Package name.
            ecosystem: Our ecosystem name.
            releases: ReleaseStats from GitHub for patch timing.
            owner: GitHub owner (for homebrew packages).
            repo: GitHub repo name (for homebrew packages).
            release_dates: Optional dict mapping version strings to release dates.

        Returns:
            CVEHistory with all vulnerabilities and patch timing.
        """
        # Fetch vulnerabilities
        if ecosystem == "homebrew" and owner and repo:
            vulns = await self.fetch_by_repo(owner, repo)
        else:
            vulns = await self.fetch_by_package(package_name, ecosystem)

        if not vulns:
            return CVEHistory(total_cves=0, cves=[], has_unpatched=False)

        cve_details = []
        total_patch_days = 0
        patched_count = 0
        has_unpatched = False

        for vuln in vulns:
            # Parse basic info
            vuln_id = vuln.get("id", "UNKNOWN")
            summary = vuln.get("summary", "") or vuln.get("details", "")[:200]
            severity, cvss_score = self._parse_severity(vuln)

            # Parse dates
            published_str = vuln.get("published")
            published_date = None
            if published_str:
                try:
                    published_date = datetime.fromisoformat(
                        published_str.replace("Z", "+00:00")
                    )
                except ValueError:
                    published_date = datetime.now(timezone.utc)
            else:
                published_date = datetime.now(timezone.utc)

            # Parse fixed version and calculate patch time
            fixed_version = self._parse_fixed_version(vuln)
            patch_release_date = None
            days_to_patch = None

            if fixed_version and release_dates:
                patch_release_date = self._find_release_date(
                    fixed_version, releases, release_dates
                )
                if patch_release_date and published_date:
                    # Ensure both are timezone-aware for comparison
                    if patch_release_date.tzinfo is None:
                        patch_release_date = patch_release_date.replace(
                            tzinfo=timezone.utc
                        )
                    if published_date.tzinfo is None:
                        published_date = published_date.replace(tzinfo=timezone.utc)

                    delta = patch_release_date - published_date
                    days_to_patch = max(0, delta.days)
                    total_patch_days += days_to_patch
                    patched_count += 1

            # Check if unpatched
            if not fixed_version:
                has_unpatched = True

            # Get references
            references = self._parse_references(vuln)

            cve_details.append(
                CVEDetail(
                    id=vuln_id,
                    summary=summary[:500],  # Truncate long summaries
                    severity=severity,
                    cvss_score=cvss_score,
                    published_date=published_date,
                    fixed_version=fixed_version,
                    patch_release_date=patch_release_date,
                    days_to_patch=days_to_patch,
                    references=references,
                )
            )

        # Sort by severity (CRITICAL first) then by date (newest first)
        severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "UNKNOWN": 4}
        cve_details.sort(
            key=lambda c: (severity_order.get(c.severity, 4), -c.published_date.timestamp())
        )

        # Calculate average days to patch
        avg_days = None
        if patched_count > 0:
            avg_days = total_patch_days / patched_count

        return CVEHistory(
            total_cves=len(cve_details),
            cves=cve_details,
            avg_days_to_patch=avg_days,
            has_unpatched=has_unpatched,
        )
