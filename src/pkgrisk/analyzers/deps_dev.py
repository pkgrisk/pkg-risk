"""deps.dev API fetcher for cross-forge package intelligence.

deps.dev (Open Source Insights) is Google's open source package analysis service.
It provides:
- Cross-forge repository metadata (GitHub, GitLab, Bitbucket)
- OpenSSF Scorecard scores
- SLSA attestations and provenance
- Resolved dependency graphs
- Aggregated advisory information

API docs: https://docs.deps.dev/api/v3/
No authentication required.
"""

from __future__ import annotations

import logging
import urllib.parse
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from pkgrisk.models.schemas import Platform, RepoRef

logger = logging.getLogger(__name__)


class DepsDevFetcher:
    """Fetches package intelligence from deps.dev API.

    deps.dev provides cross-ecosystem package analysis including:
    - OpenSSF Scorecard for security practices
    - SLSA provenance attestations
    - Resolved dependency graphs
    - Cross-forge repository data
    """

    BASE_URL = "https://api.deps.dev/v3"

    # Map our ecosystem names to deps.dev system names
    SYSTEM_MAP = {
        "npm": "npm",
        "pypi": "pypi",
        "crates": "cargo",
        "homebrew": None,  # Not directly supported, use project endpoint
    }

    # Map our platform names to deps.dev project key prefixes
    # deps.dev uses domain-based keys like "github.com/owner/repo"
    PROJECT_KEY_PREFIX_MAP = {
        "github": "github.com",
        "gitlab": "gitlab.com",
        "bitbucket": "bitbucket.org",
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

    async def _fetch(self, endpoint: str) -> dict | None:
        """Fetch data from deps.dev API.

        Args:
            endpoint: API endpoint path (will be appended to BASE_URL).

        Returns:
            JSON response as dict, or None if request failed.
        """
        client = await self._get_client()
        url = f"{self.BASE_URL}{endpoint}"

        try:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.debug(f"deps.dev: Not found: {endpoint}")
            else:
                logger.warning(f"deps.dev API error {e.response.status_code}: {endpoint}")
            return None
        except httpx.RequestError as e:
            logger.warning(f"deps.dev request error: {e}")
            return None
        except ValueError as e:
            # JSON decode error
            logger.warning(f"deps.dev JSON decode error for {endpoint}: {e}")
            return None
        finally:
            if self._client is None:
                await client.aclose()

    def _encode_package_name(self, name: str) -> str:
        """URL-encode a package name for use in API paths.

        Args:
            name: Package name (may contain @, /, etc).

        Returns:
            URL-encoded package name.
        """
        return urllib.parse.quote(name, safe="")

    async def fetch_package(
        self,
        package_name: str,
        ecosystem: str,
    ) -> dict | None:
        """Fetch package information including all versions.

        Args:
            package_name: Package name.
            ecosystem: Our ecosystem name (npm, pypi, crates).

        Returns:
            Package data including versions, or None if not found.
        """
        system = self.SYSTEM_MAP.get(ecosystem)
        if not system:
            return None

        encoded_name = self._encode_package_name(package_name)
        endpoint = f"/systems/{system}/packages/{encoded_name}"
        return await self._fetch(endpoint)

    async def fetch_version(
        self,
        package_name: str,
        version: str,
        ecosystem: str,
    ) -> dict | None:
        """Fetch version-specific information including attestations.

        Args:
            package_name: Package name.
            version: Version string.
            ecosystem: Our ecosystem name.

        Returns:
            Version data including licenses, advisories, attestations.
        """
        system = self.SYSTEM_MAP.get(ecosystem)
        if not system:
            return None

        encoded_name = self._encode_package_name(package_name)
        encoded_version = self._encode_package_name(version)
        endpoint = f"/systems/{system}/packages/{encoded_name}/versions/{encoded_version}"
        return await self._fetch(endpoint)

    async def fetch_dependencies(
        self,
        package_name: str,
        version: str,
        ecosystem: str,
    ) -> dict | None:
        """Fetch resolved dependency graph for a package version.

        Args:
            package_name: Package name.
            version: Version string.
            ecosystem: Our ecosystem name.

        Returns:
            Dependency graph with nodes and edges.
        """
        system = self.SYSTEM_MAP.get(ecosystem)
        if not system:
            return None

        encoded_name = self._encode_package_name(package_name)
        encoded_version = self._encode_package_name(version)
        endpoint = f"/systems/{system}/packages/{encoded_name}/versions/{encoded_version}:dependencies"
        return await self._fetch(endpoint)

    async def fetch_project(
        self,
        owner: str,
        repo: str,
        platform: str = "github",
    ) -> dict | None:
        """Fetch project information including OpenSSF Scorecard.

        Args:
            owner: Repository owner.
            repo: Repository name.
            platform: Platform name (github, gitlab, bitbucket).

        Returns:
            Project data including Scorecard scores (GitHub) or basic metrics (GitLab/Bitbucket).
        """
        key_prefix = self.PROJECT_KEY_PREFIX_MAP.get(platform.lower())
        if not key_prefix:
            logger.debug(f"Unsupported platform for deps.dev: {platform}")
            return None

        # Project key format: domain/owner/repo (URL encoded)
        # e.g., "github.com/lodash/lodash" or "gitlab.com/libeigen/eigen"
        project_key = f"{key_prefix}/{owner}/{repo}"
        encoded_key = self._encode_package_name(project_key)
        endpoint = f"/projects/{encoded_key}"
        return await self._fetch(endpoint)

    async def fetch_project_from_repo_ref(
        self,
        repo_ref: "RepoRef",
    ) -> dict | None:
        """Fetch project data from a RepoRef object.

        Args:
            repo_ref: Repository reference with platform, owner, repo.

        Returns:
            Project data including Scorecard scores.
        """
        return await self.fetch_project(
            owner=repo_ref.owner,
            repo=repo_ref.repo,
            platform=repo_ref.platform.value,
        )

    def parse_basic_project_metrics(self, project_data: dict) -> "BasicProjectMetrics | None":
        """Parse basic project metrics from project response.

        This is used for GitLab/Bitbucket projects where Scorecard is not available.

        Args:
            project_data: Response from fetch_project.

        Returns:
            BasicProjectMetrics model or None if no useful data.
        """
        from pkgrisk.models.schemas import BasicProjectMetrics

        stars = project_data.get("starsCount")
        forks = project_data.get("forksCount")
        issues = project_data.get("openIssuesCount")

        # If we don't have any metrics, return None
        if stars is None and forks is None and issues is None:
            return None

        # Parse OSS-Fuzz coverage if available
        oss_fuzz = project_data.get("ossFuzz", {})
        oss_fuzz_lines = oss_fuzz.get("lineCount") if oss_fuzz else None
        oss_fuzz_covered = oss_fuzz.get("lineCoverCount") if oss_fuzz else None

        return BasicProjectMetrics(
            stars=stars,
            forks=forks,
            open_issues=issues,
            license=project_data.get("license"),
            description=project_data.get("description"),
            oss_fuzz_line_count=oss_fuzz_lines,
            oss_fuzz_line_cover_count=oss_fuzz_covered,
        )

    def parse_scorecard(self, project_data: dict) -> "ScorecardData | None":
        """Parse OpenSSF Scorecard data from project response.

        Args:
            project_data: Response from fetch_project.

        Returns:
            ScorecardData model or None if not available.
        """
        from pkgrisk.models.schemas import ScorecardData

        scorecard = project_data.get("scorecard")
        if not scorecard:
            return None

        overall_score = scorecard.get("overallScore")
        if overall_score is None:
            return None

        # Parse individual checks
        checks = {}
        for check in scorecard.get("checks", []):
            name = check.get("name")
            score = check.get("score")
            if name and score is not None:
                checks[name] = float(score)

        # Parse date
        date_str = scorecard.get("date")
        score_date = None
        if date_str:
            try:
                score_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            except ValueError:
                pass

        # Extract key check scores for convenience
        return ScorecardData(
            overall_score=float(overall_score),
            score_date=score_date,
            checks=checks,
            code_review_score=checks.get("Code-Review"),
            maintained_score=checks.get("Maintained"),
            branch_protection_score=checks.get("Branch-Protection"),
            dangerous_workflow_score=checks.get("Dangerous-Workflow"),
            token_permissions_score=checks.get("Token-Permissions"),
            fuzzing_enabled=checks.get("Fuzzing", 0) >= 5,
            sast_enabled=checks.get("SAST", 0) >= 5,
            cii_badge=checks.get("CII-Best-Practices", 0) >= 5,
        )

    def parse_dependency_graph(self, deps_data: dict) -> "DependencyGraphSummary | None":
        """Parse dependency graph data from dependencies response.

        Args:
            deps_data: Response from fetch_dependencies.

        Returns:
            DependencyGraphSummary model or None if not available.
        """
        from pkgrisk.models.schemas import DependencyGraphSummary

        nodes = deps_data.get("nodes", [])
        if not nodes:
            return None

        # Count direct vs transitive dependencies
        # First node is the root package
        direct_count = 0
        transitive_count = 0
        vulnerable_direct = 0
        vulnerable_transitive = 0
        max_depth = 0

        edges = deps_data.get("edges", [])

        # Build adjacency for depth calculation
        children: dict[int, list[int]] = {}
        for edge in edges:
            from_node = edge.get("fromNode", 0)
            to_node = edge.get("toNode", 0)
            if from_node not in children:
                children[from_node] = []
            children[from_node].append(to_node)

        # Calculate depths via BFS from root (node 0)
        depths: dict[int, int] = {0: 0}
        queue = [0]
        while queue:
            current = queue.pop(0)
            current_depth = depths[current]
            for child in children.get(current, []):
                if child not in depths:
                    depths[child] = current_depth + 1
                    queue.append(child)
                    max_depth = max(max_depth, depths[child])

        # Count dependencies by depth
        for i, node in enumerate(nodes):
            if i == 0:
                continue  # Skip root package

            depth = depths.get(i, 0)
            has_advisory = len(node.get("advisoryKeys", [])) > 0

            if depth == 1:
                direct_count += 1
                if has_advisory:
                    vulnerable_direct += 1
            else:
                transitive_count += 1
                if has_advisory:
                    vulnerable_transitive += 1

        return DependencyGraphSummary(
            direct_count=direct_count,
            transitive_count=transitive_count,
            vulnerable_direct=vulnerable_direct,
            vulnerable_transitive=vulnerable_transitive,
            max_depth=max_depth,
        )

    def parse_slsa_attestation(self, version_data: dict) -> tuple[bool, int | None]:
        """Parse SLSA attestation data from version response.

        Args:
            version_data: Response from fetch_version.

        Returns:
            Tuple of (has_slsa_attestation, slsa_level).
        """
        attestations = version_data.get("attestations", [])
        if not attestations:
            return False, None

        # Look for SLSA provenance attestations
        for attestation in attestations:
            # deps.dev returns attestation types like "SLSA_BUILD_LEVEL_1"
            # or "SLSA_PROVENANCE"
            att_type = attestation.get("type", "")
            if "SLSA" in att_type:
                # Try to extract level
                if "LEVEL_1" in att_type:
                    return True, 1
                elif "LEVEL_2" in att_type:
                    return True, 2
                elif "LEVEL_3" in att_type:
                    return True, 3
                elif "LEVEL_4" in att_type:
                    return True, 4
                else:
                    return True, None

        return False, None

    async def fetch_all_intelligence(
        self,
        package_name: str,
        version: str,
        ecosystem: str,
        repo_ref: "RepoRef | None" = None,
    ) -> "AggregatorData":
        """Fetch all available intelligence for a package.

        This is the main entry point for the pipeline integration.

        Args:
            package_name: Package name.
            version: Package version.
            ecosystem: Our ecosystem name.
            repo_ref: Optional repository reference for Scorecard data.

        Returns:
            AggregatorData with all available intelligence.
        """
        from pkgrisk.models.schemas import AggregatorData

        scorecard = None
        dependency_graph = None
        has_slsa = False
        slsa_level = None
        sources = []

        # Fetch version data for SLSA attestations
        try:
            version_data = await self.fetch_version(package_name, version, ecosystem)
            if version_data:
                sources.append("deps.dev:version")
                has_slsa, slsa_level = self.parse_slsa_attestation(version_data)
        except Exception as e:
            logger.debug(f"deps.dev version fetch/parse failed for {package_name}: {e}")

        # Fetch dependency graph
        try:
            deps_data = await self.fetch_dependencies(package_name, version, ecosystem)
            if deps_data:
                sources.append("deps.dev:dependencies")
                dependency_graph = self.parse_dependency_graph(deps_data)
        except Exception as e:
            logger.debug(f"deps.dev dependencies fetch/parse failed for {package_name}: {e}")

        # Fetch project/Scorecard data if we have a repo reference
        project_metrics = None
        if repo_ref:
            try:
                project_data = await self.fetch_project_from_repo_ref(repo_ref)
                if project_data:
                    sources.append("deps.dev:project")
                    # Try to get Scorecard (only available for GitHub)
                    scorecard = self.parse_scorecard(project_data)
                    # Also get basic metrics (available for all forges)
                    project_metrics = self.parse_basic_project_metrics(project_data)
            except Exception as e:
                logger.debug(f"deps.dev project fetch/parse failed for {repo_ref}: {e}")

        return AggregatorData(
            scorecard=scorecard,
            project_metrics=project_metrics,
            dependency_graph=dependency_graph,
            slsa_attestation=has_slsa,
            slsa_level=slsa_level,
            fetched_at=datetime.now(timezone.utc),
            sources_available=sources,
        )
