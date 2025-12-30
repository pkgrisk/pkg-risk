"""NPM package manager adapter."""

import re

import httpx

from pkgrisk.adapters.base import BaseAdapter, PackageNotFoundError, parse_repo_url
from pkgrisk.models.schemas import Ecosystem, InstallStats, PackageMetadata, RepoRef, Platform


class NpmAdapter(BaseAdapter):
    """Adapter for NPM package registry.

    Data sources:
    - Package metadata: https://registry.npmjs.org/{package}
    - Download stats: https://api.npmjs.org/downloads/point/{period}/{package}
    - Search/ranking: https://api.npms.io/v2/search
    """

    REGISTRY_URL = "https://registry.npmjs.org"
    DOWNLOADS_URL = "https://api.npmjs.org/downloads"
    NPMS_URL = "https://api.npms.io/v2"

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        """Initialize the adapter.

        Args:
            client: Optional httpx client for making requests.
        """
        self._client = client
        self._popular_packages_cache: list[str] | None = None

    @property
    def ecosystem(self) -> Ecosystem:
        return Ecosystem.NPM

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
        """Return list of NPM package names, sorted by dependents (most depended upon).

        Uses a curated list of highly-depended-upon packages as the npms.io search
        API doesn't support wildcard listing. These are the most critical packages
        in the npm ecosystem.

        Args:
            limit: Maximum number of packages to return.

        Returns:
            List of package names, most depended-upon first.
        """
        if self._popular_packages_cache is not None:
            packages = self._popular_packages_cache
            if limit is not None:
                return packages[:limit]
            return packages

        # Use curated list of most-depended-upon npm packages
        # Source: npm "most dependents" list + GitHub data on usage
        # These packages form the critical infrastructure of npm
        packages = self._get_popular_packages()

        self._popular_packages_cache = packages

        if limit is not None:
            return packages[:limit]
        return packages

    def _get_popular_packages(self) -> list[str]:
        """Return list of most depended-upon npm packages.

        This list is curated from npm's "most dependents" rankings.
        The order approximates dependency count (most depended-upon first).
        """
        return [
            # Tier 1: Core utilities (100M+ weekly downloads)
            "lodash", "chalk", "commander", "debug", "uuid", "semver", "glob",
            "yargs", "fs-extra", "axios", "moment", "async", "underscore",
            "dotenv", "minimist", "colors", "rimraf", "mkdirp", "bluebird",
            "cross-env", "inquirer", "ora", "rxjs", "ws", "cheerio",
            # Tier 2: Build/Dev tools (50M+ weekly downloads)
            "typescript", "webpack", "babel-core", "@babel/core", "eslint",
            "prettier", "jest", "mocha", "chai", "esbuild", "rollup",
            "postcss", "autoprefixer", "sass", "less", "terser",
            # Tier 3: Frontend frameworks (20M+ weekly downloads)
            "react", "react-dom", "vue", "angular", "@angular/core", "svelte",
            "preact", "next", "nuxt", "gatsby", "vite", "solid-js",
            # Tier 4: Backend/Server (20M+ weekly downloads)
            "express", "koa", "fastify", "hapi", "socket.io", "body-parser",
            "cors", "helmet", "morgan", "cookie-parser", "compression",
            # Tier 5: Data/Database (10M+ weekly downloads)
            "mongoose", "sequelize", "redis", "pg", "mysql", "mysql2",
            "mongodb", "knex", "typeorm", "prisma", "graphql", "apollo-server",
            # Tier 6: HTTP/Networking (10M+ weekly downloads)
            "node-fetch", "got", "superagent", "request", "form-data",
            "http-proxy", "https-proxy-agent", "socks-proxy-agent",
            # Tier 7: Testing (10M+ weekly downloads)
            "sinon", "nock", "supertest", "enzyme", "@testing-library/react",
            "cypress", "puppeteer", "playwright", "jsdom",
            # Tier 8: Types (50M+ weekly downloads)
            "@types/node", "@types/react", "@types/lodash", "@types/jest",
            "@types/express", "@types/mocha", "@types/chai",
            # Tier 9: CLI/Dev experience (5M+ weekly downloads)
            "yargs-parser", "boxen", "execa", "cosmiconfig", "tslib",
            "source-map-support", "electron", "nodemon", "ts-node",
            # Tier 10: Security/Crypto
            "jsonwebtoken", "bcrypt", "bcryptjs", "crypto-js", "argon2",
        ]

    async def get_package_metadata(self, name: str) -> PackageMetadata:
        """Fetch metadata for an NPM package.

        Args:
            name: Package name (supports scoped packages like @org/pkg).

        Returns:
            PackageMetadata with package information.

        Raises:
            PackageNotFoundError: If the package doesn't exist.
        """
        # URL-encode scoped package names
        encoded_name = name.replace("/", "%2F")
        url = f"{self.REGISTRY_URL}/{encoded_name}"

        try:
            data = await self._fetch_json(url)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise PackageNotFoundError(Ecosystem.NPM, name) from e
            raise

        # Get latest version info
        dist_tags = data.get("dist-tags", {})
        latest_version = dist_tags.get("latest", "")

        # Get version-specific data
        versions = data.get("versions", {})
        version_data = versions.get(latest_version, {})

        # Extract repository URL
        repository = data.get("repository") or version_data.get("repository")
        repository_url = self._extract_repo_url(repository)

        # Extract maintainers
        maintainers = data.get("maintainers", [])
        maintainer_names = [m.get("name", "") for m in maintainers if isinstance(m, dict)]

        # Check for TypeScript types
        has_types = bool(
            version_data.get("types") or
            version_data.get("typings") or
            version_data.get("main", "").endswith(".d.ts")
        )

        # Check if scoped package
        is_scoped = name.startswith("@")

        return PackageMetadata(
            ecosystem=Ecosystem.NPM,
            name=data.get("name", name),
            description=data.get("description", "") or version_data.get("description", ""),
            version=latest_version,
            homepage=data.get("homepage") or version_data.get("homepage"),
            repository_url=repository_url,
            license=self._extract_license(data, version_data),
            keywords=data.get("keywords", []) or version_data.get("keywords", []),
            dependencies=list(version_data.get("dependencies", {}).keys()),
            # NPM-specific fields (added via metadata extension)
            npm_maintainers=maintainer_names,
            npm_maintainer_count=len(maintainer_names),
            has_types=has_types,
            is_scoped=is_scoped,
        )

    def _extract_repo_url(self, repository: dict | str | None) -> str | None:
        """Extract repository URL from npm repository field.

        Handles various formats:
        - {"type": "git", "url": "git+https://github.com/owner/repo.git"}
        - "github:owner/repo"
        - "https://github.com/owner/repo"
        """
        if not repository:
            return None

        if isinstance(repository, str):
            url = repository
        elif isinstance(repository, dict):
            url = repository.get("url", "")
        else:
            return None

        if not url:
            return None

        # Clean up common npm URL patterns
        url = url.replace("git+", "").replace("git://", "https://")
        url = url.rstrip(".git")

        # Handle GitHub shorthand
        if url.startswith("github:"):
            url = f"https://github.com/{url[7:]}"

        return url if url else None

    def _extract_license(self, data: dict, version_data: dict) -> str | None:
        """Extract license from npm package data."""
        license_info = data.get("license") or version_data.get("license")

        if isinstance(license_info, str):
            return license_info
        elif isinstance(license_info, dict):
            return license_info.get("type") or license_info.get("name")
        elif isinstance(license_info, list) and license_info:
            first = license_info[0]
            if isinstance(first, str):
                return first
            elif isinstance(first, dict):
                return first.get("type") or first.get("name")

        return None

    async def get_install_stats(self, name: str) -> InstallStats | None:
        """Fetch download statistics for an NPM package.

        Args:
            name: Package name.

        Returns:
            InstallStats with download counts.
        """
        # URL-encode scoped package names
        encoded_name = name.replace("/", "%2F")

        # Fetch last week and last month stats
        try:
            week_url = f"{self.DOWNLOADS_URL}/point/last-week/{encoded_name}"
            week_data = await self._fetch_json(week_url)
            downloads_week = week_data.get("downloads", 0)

            month_url = f"{self.DOWNLOADS_URL}/point/last-month/{encoded_name}"
            month_data = await self._fetch_json(month_url)
            downloads_month = month_data.get("downloads", 0)

            # Estimate 30-day from month data (npm provides variable "last-month")
            # Last-month is approximately 28-31 days
            return InstallStats(
                downloads_last_30d=downloads_month,
                downloads_last_90d=downloads_month * 3,  # Rough estimate
                downloads_last_365d=downloads_month * 12,  # Rough estimate
                dependent_packages=None,  # Would need npms.io for this
            )
        except Exception:
            return None

    async def check_types_package_exists(self, name: str) -> bool:
        """Check if a @types/* package exists for the given package.

        Args:
            name: Package name (not including @types/ prefix).

        Returns:
            True if @types/{name} package exists.
        """
        # Skip if already a @types package or scoped
        if name.startswith("@"):
            return False

        types_name = f"@types/{name}"
        encoded = types_name.replace("/", "%2F")
        url = f"{self.REGISTRY_URL}/{encoded}"

        client = await self._get_client()
        try:
            response = await client.head(url)
            return response.status_code == 200
        except Exception:
            return False
        finally:
            if self._client is None:
                await client.aclose()

    def get_source_repo(self, metadata: PackageMetadata) -> RepoRef | None:
        """Extract source repository reference from metadata.

        Extends base implementation with npm-specific URL handling.
        """
        url = metadata.repository_url or metadata.homepage

        if not url:
            return None

        # Handle npm-specific patterns first
        # git+https://github.com/owner/repo.git
        url = url.replace("git+", "").replace("git://", "https://")
        url = url.rstrip(".git")

        # GitHub shorthand: github:owner/repo
        if url.startswith("github:"):
            parts = url[7:].split("/")
            if len(parts) >= 2:
                return RepoRef(
                    platform=Platform.GITHUB,
                    owner=parts[0],
                    repo=parts[1],
                )

        # GitLab shorthand: gitlab:owner/repo
        if url.startswith("gitlab:"):
            parts = url[7:].split("/")
            if len(parts) >= 2:
                return RepoRef(
                    platform=Platform.GITLAB,
                    owner=parts[0],
                    repo=parts[1],
                )

        # Fall back to base implementation
        return parse_repo_url(url)
