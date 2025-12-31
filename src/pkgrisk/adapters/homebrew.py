"""Homebrew package manager adapter."""

import httpx

from pkgrisk.adapters.base import BaseAdapter, PackageNotFoundError
from pkgrisk.models.schemas import Ecosystem, InstallStats, PackageMetadata


class HomebrewAdapter(BaseAdapter):
    """Adapter for Homebrew package manager.

    Data sources:
    - Package list: https://formulae.brew.sh/api/formula.json
    - Per-formula: https://formulae.brew.sh/api/formula/{name}.json
    - Analytics: https://formulae.brew.sh/api/analytics/install/30d.json
    """

    BASE_URL = "https://formulae.brew.sh/api"

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        """Initialize the adapter.

        Args:
            client: Optional httpx client for making requests. If not provided,
                    a new client will be created for each request.
        """
        self._client = client
        self._analytics_cache: dict[str, int] | None = None

    @property
    def ecosystem(self) -> Ecosystem:
        return Ecosystem.HOMEBREW

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create an HTTP client."""
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=30.0)

    async def _fetch_json(self, url: str) -> dict | list:
        """Fetch JSON from a URL."""
        client = await self._get_client()
        try:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()
        finally:
            if self._client is None:
                await client.aclose()

    async def _load_analytics(self) -> dict[str, int]:
        """Load and cache 30-day install analytics."""
        if self._analytics_cache is not None:
            return self._analytics_cache

        url = f"{self.BASE_URL}/analytics/install/30d.json"
        data = await self._fetch_json(url)

        # Build lookup from formula name to install count
        self._analytics_cache = {}
        items = data.get("items", [])
        for item in items:
            # item format: {"number": 1, "formula": "wget", "count": "1,234,567", ...}
            name = item.get("formula", "")
            count_str = item.get("count", "0")
            # Remove commas from count string
            count = int(count_str.replace(",", ""))
            self._analytics_cache[name] = count

        return self._analytics_cache

    async def list_packages(self, limit: int | None = None) -> list[str]:
        """Return list of Homebrew formula names, sorted by popularity.

        Args:
            limit: Maximum number of packages to return.

        Returns:
            List of formula names, most popular first.
        """
        # First, get the analytics to know popularity order
        analytics = await self._load_analytics()

        # Get all formulas
        url = f"{self.BASE_URL}/formula.json"
        formulas = await self._fetch_json(url)

        # Extract names and sort by install count
        names = [f["name"] for f in formulas if isinstance(f, dict) and "name" in f]

        # Sort by analytics (most installed first), then alphabetically for ties
        names.sort(key=lambda n: (-analytics.get(n, 0), n))

        if limit is not None:
            names = names[:limit]

        return names

    async def get_package_metadata(self, name: str) -> PackageMetadata:
        """Fetch metadata for a Homebrew formula.

        Args:
            name: Formula name.

        Returns:
            PackageMetadata with formula information.

        Raises:
            PackageNotFoundError: If the formula doesn't exist.
        """
        url = f"{self.BASE_URL}/formula/{name}.json"

        try:
            data = await self._fetch_json(url)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise PackageNotFoundError(Ecosystem.HOMEBREW, name) from e
            raise

        # Extract version info
        versions = data.get("versions", {})
        version = versions.get("stable", "") or versions.get("head", "")

        # Extract URLs
        homepage = data.get("homepage")
        urls = data.get("urls", {})
        stable_url = urls.get("stable", {}).get("url", "")
        head_url = urls.get("head", {}).get("url", "")

        # Try to find repository URL
        repository_url = None
        # Check if homepage is a GitHub URL
        if homepage and "github.com" in homepage:
            repository_url = homepage
        # Check head URL for GitHub (many packages have repo here)
        elif head_url and "github.com" in head_url:
            # Head URL is usually the git clone URL
            # e.g., https://github.com/git/git.git
            repository_url = head_url.rstrip(".git")
        # Check stable URL for GitHub
        elif stable_url and "github.com" in stable_url:
            # Extract repo URL from tarball URL
            # e.g., https://github.com/owner/repo/archive/refs/tags/v1.0.0.tar.gz
            parts = stable_url.split("/")
            if len(parts) >= 5 and parts[2] == "github.com":
                repository_url = f"https://github.com/{parts[3]}/{parts[4]}"

        # Extract dependencies
        dependencies = []
        for dep in data.get("dependencies", []):
            if isinstance(dep, str):
                dependencies.append(dep)
            elif isinstance(dep, dict):
                dependencies.append(dep.get("name", ""))

        return PackageMetadata(
            ecosystem=Ecosystem.HOMEBREW,
            name=data.get("name", name),
            description=data.get("desc", ""),
            version=version,
            homepage=homepage,
            repository_url=repository_url,
            license=data.get("license"),
            keywords=[],  # Homebrew doesn't have keywords
            dependencies=dependencies,
        )

    async def get_install_stats(self, name: str) -> InstallStats | None:
        """Fetch install statistics for a formula.

        Args:
            name: Formula name.

        Returns:
            InstallStats with 30-day install count.
        """
        analytics = await self._load_analytics()
        count = analytics.get(name)

        if count is None:
            return None

        return InstallStats(
            downloads_last_30d=count,
            downloads_last_90d=None,  # Homebrew only provides 30d and 90d and 365d separately
            downloads_last_365d=None,
            dependent_packages=None,  # Would need to parse all formulas
        )

    async def get_formula_details(self, name: str) -> dict:
        """Get raw formula details for additional processing.

        This returns the full JSON response for cases where you need
        more data than PackageMetadata provides.

        Args:
            name: Formula name.

        Returns:
            Raw formula JSON data.
        """
        url = f"{self.BASE_URL}/formula/{name}.json"
        return await self._fetch_json(url)
