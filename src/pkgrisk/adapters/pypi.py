"""PyPI package manager adapter."""

import re

import httpx

from pkgrisk.adapters.base import BaseAdapter, PackageNotFoundError, parse_repo_url
from pkgrisk.models.schemas import Ecosystem, InstallStats, PackageMetadata, RepoRef


class PyPiAdapter(BaseAdapter):
    """Adapter for Python Package Index (PyPI).

    Data sources:
    - Package metadata: https://pypi.org/pypi/{package}/json
    - Download stats: https://pypistats.org/api/packages/{package}/recent
    - Top packages: https://hugovk.github.io/top-pypi-packages/top-pypi-packages-30-days.json
    """

    PYPI_URL = "https://pypi.org/pypi"
    STATS_URL = "https://pypistats.org/api"
    TOP_PACKAGES_URL = "https://hugovk.github.io/top-pypi-packages/top-pypi-packages-30-days.json"

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        """Initialize the adapter.

        Args:
            client: Optional httpx client for making requests.
        """
        self._client = client
        self._top_packages_cache: list[str] | None = None

    @property
    def ecosystem(self) -> Ecosystem:
        return Ecosystem.PYPI

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create an HTTP client."""
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=30.0)

    async def _fetch_json(self, url: str, headers: dict | None = None) -> dict | list:
        """Fetch JSON from a URL."""
        client = await self._get_client()
        try:
            response = await client.get(url, headers=headers or {})
            response.raise_for_status()
            return response.json()
        finally:
            if self._client is None:
                await client.aclose()

    async def list_packages(self, limit: int | None = None) -> list[str]:
        """Return list of PyPI package names, sorted by downloads.

        Uses hugovk's top-pypi-packages dataset which tracks downloads
        from the last 30 days.

        Args:
            limit: Maximum number of packages to return.

        Returns:
            List of package names, most downloaded first.
        """
        if self._top_packages_cache is not None:
            packages = self._top_packages_cache
            if limit is not None:
                return packages[:limit]
            return packages

        try:
            data = await self._fetch_json(self.TOP_PACKAGES_URL)
            rows = data.get("rows", [])
            packages = [row["project"] for row in rows if "project" in row]
            self._top_packages_cache = packages
        except Exception:
            # Fall back to curated list if API fails
            packages = self._get_fallback_packages()
            self._top_packages_cache = packages

        if limit is not None:
            return packages[:limit]
        return packages

    def _get_fallback_packages(self) -> list[str]:
        """Return curated list of popular Python packages as fallback."""
        return [
            # Data Science / ML
            "numpy", "pandas", "scipy", "matplotlib", "scikit-learn",
            "tensorflow", "torch", "keras", "xgboost", "lightgbm",
            "seaborn", "plotly", "jupyter", "notebook", "ipython",
            # Web frameworks
            "django", "flask", "fastapi", "starlette", "tornado",
            "aiohttp", "httpx", "requests", "urllib3", "certifi",
            # CLI / Utilities
            "click", "typer", "rich", "tqdm", "colorama",
            "pyyaml", "toml", "python-dotenv", "pydantic", "attrs",
            # Testing
            "pytest", "pytest-cov", "coverage", "mock", "responses",
            "hypothesis", "faker", "factory-boy", "tox", "nox",
            # Dev tools
            "black", "ruff", "mypy", "pylint", "flake8",
            "isort", "pre-commit", "setuptools", "wheel", "twine",
            # Database
            "sqlalchemy", "psycopg2", "pymysql", "redis", "pymongo",
            "alembic", "databases", "asyncpg", "motor", "peewee",
            # AWS / Cloud
            "boto3", "botocore", "awscli", "google-cloud-storage",
            "azure-storage-blob", "s3transfer", "paramiko", "fabric",
            # Async
            "asyncio", "trio", "anyio", "uvloop", "celery",
            # Security
            "cryptography", "pyjwt", "bcrypt", "passlib", "python-jose",
            # Parsing / Serialization
            "beautifulsoup4", "lxml", "html5lib", "jsonschema", "marshmallow",
            "orjson", "ujson", "msgpack", "protobuf", "grpcio",
        ]

    async def get_package_metadata(self, name: str) -> PackageMetadata:
        """Fetch metadata for a PyPI package.

        Args:
            name: Package name.

        Returns:
            PackageMetadata with package information.

        Raises:
            PackageNotFoundError: If the package doesn't exist.
        """
        # Normalize package name (PyPI is case-insensitive, uses hyphens)
        normalized_name = self._normalize_name(name)
        url = f"{self.PYPI_URL}/{normalized_name}/json"

        try:
            data = await self._fetch_json(url)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise PackageNotFoundError(Ecosystem.PYPI, name) from e
            raise

        info = data.get("info", {})

        # Extract repository URL from project_urls
        repository_url = self._extract_repo_url(info)

        # Parse dependencies from requires_dist
        dependencies = self._parse_dependencies(info.get("requires_dist"))

        # Extract maintainer info
        author = info.get("author") or info.get("maintainer") or ""
        author_email = info.get("author_email") or info.get("maintainer_email") or ""

        return PackageMetadata(
            ecosystem=Ecosystem.PYPI,
            name=info.get("name", name),
            description=info.get("summary", "") or "",
            version=info.get("version", ""),
            homepage=info.get("home_page") or info.get("project_url"),
            repository_url=repository_url,
            license=self._extract_license(info),
            keywords=self._parse_keywords(info),
            dependencies=dependencies,
            # PyPI-specific fields
            pypi_author=author,
            pypi_author_email=author_email,
            pypi_requires_python=info.get("requires_python"),
        )

    def _normalize_name(self, name: str) -> str:
        """Normalize a PyPI package name.

        PyPI package names are case-insensitive and treat underscores,
        hyphens, and periods as equivalent.
        """
        return re.sub(r"[-_.]+", "-", name).lower()

    def _extract_repo_url(self, info: dict) -> str | None:
        """Extract repository URL from PyPI info.

        Checks project_urls for common keys like Source, Repository, GitHub.
        """
        project_urls = info.get("project_urls") or {}

        # Common keys for source code URLs (in priority order)
        repo_keys = [
            "Source", "Source Code", "Repository", "GitHub",
            "Code", "Homepage", "Home", "source", "repository",
            "github", "Git", "git",
        ]

        for key in repo_keys:
            if key in project_urls:
                url = project_urls[key]
                # Verify it looks like a code repository
                if url and ("github.com" in url or "gitlab.com" in url or "bitbucket.org" in url):
                    return url

        # Fall back to homepage if it's a repository URL
        homepage = info.get("home_page", "")
        if homepage and ("github.com" in homepage or "gitlab.com" in homepage):
            return homepage

        # Check all project_urls for any repository URL
        for url in project_urls.values():
            if url and ("github.com" in url or "gitlab.com" in url or "bitbucket.org" in url):
                return url

        return None

    def _extract_license(self, info: dict) -> str | None:
        """Extract license from PyPI info.

        Checks the license field and classifiers.
        """
        # Direct license field
        license_str = info.get("license")
        if license_str and license_str.strip() and license_str.upper() != "UNKNOWN":
            # Some packages put the full license text here, truncate if too long
            if len(license_str) > 100:
                return None
            return license_str.strip()

        # Parse from classifiers
        classifiers = info.get("classifiers", [])
        for classifier in classifiers:
            if classifier.startswith("License :: OSI Approved :: "):
                # Extract license name from classifier
                license_name = classifier.replace("License :: OSI Approved :: ", "")
                return license_name

        return None

    def _parse_keywords(self, info: dict) -> list[str]:
        """Parse keywords from PyPI info.

        Keywords can be a comma-separated string or already a list.
        """
        keywords = info.get("keywords")
        if not keywords:
            return []

        if isinstance(keywords, list):
            return keywords

        if isinstance(keywords, str):
            # Split by comma or whitespace
            return [k.strip() for k in re.split(r"[,\s]+", keywords) if k.strip()]

        return []

    def _parse_dependencies(self, requires_dist: list[str] | None) -> list[str]:
        """Parse dependency names from requires_dist.

        Format: "package-name (>=1.0,<2.0); extra == 'dev'"
        We extract just the package name.
        """
        if not requires_dist:
            return []

        dependencies = []
        for req in requires_dist:
            # Skip extras/optional dependencies
            if "extra ==" in req or "extra==" in req:
                continue

            # Extract package name (everything before version specifier or semicolon)
            match = re.match(r"^([a-zA-Z0-9][-a-zA-Z0-9._]*)", req)
            if match:
                dep_name = match.group(1)
                # Normalize the name
                dep_name = self._normalize_name(dep_name)
                if dep_name not in dependencies:
                    dependencies.append(dep_name)

        return dependencies

    async def get_install_stats(self, name: str) -> InstallStats | None:
        """Fetch download statistics for a PyPI package.

        Uses pypistats.org API for download counts.

        Args:
            name: Package name.

        Returns:
            InstallStats with download counts, or None if unavailable.
        """
        normalized_name = self._normalize_name(name)

        try:
            # Fetch recent download stats
            url = f"{self.STATS_URL}/packages/{normalized_name}/recent"
            data = await self._fetch_json(url)

            # pypistats returns: {"last_day": N, "last_week": N, "last_month": N}
            stats_data = data.get("data", {})
            last_month = stats_data.get("last_month", 0)
            last_week = stats_data.get("last_week", 0)

            return InstallStats(
                downloads_last_30d=last_month,
                downloads_last_90d=last_month * 3,  # Estimate
                downloads_last_365d=last_month * 12,  # Estimate
                dependent_packages=None,
            )
        except Exception:
            return None

    def get_source_repo(self, metadata: PackageMetadata) -> RepoRef | None:
        """Extract source repository reference from metadata.

        Uses base implementation with PyPI-specific URL cleaning.
        """
        url = metadata.repository_url or metadata.homepage

        if not url:
            return None

        # Clean up common PyPI URL patterns
        # Some packages have URLs like "https://github.com/owner/repo/tree/main"
        # Remove tree/branch suffix for cleaner repo reference
        url = re.sub(r"/tree/[^/]+/?$", "", url)
        url = re.sub(r"/blob/[^/]+/?$", "", url)

        return parse_repo_url(url)
