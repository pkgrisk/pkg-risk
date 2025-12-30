"""Abstract base class for package manager adapters."""

import re
from abc import ABC, abstractmethod

from pkgrisk.models.schemas import (
    Ecosystem,
    InstallStats,
    PackageMetadata,
    Platform,
    RepoRef,
)


class BaseAdapter(ABC):
    """Base class for package manager adapters.

    Each adapter normalizes data from a specific package manager into
    a common schema for analysis.
    """

    @property
    @abstractmethod
    def ecosystem(self) -> Ecosystem:
        """Return the ecosystem this adapter handles."""
        ...

    @abstractmethod
    async def list_packages(self, limit: int | None = None) -> list[str]:
        """Return list of package names to analyze.

        Args:
            limit: Maximum number of packages to return. If None, returns all.

        Returns:
            List of package names, typically sorted by popularity/downloads.
        """
        ...

    @abstractmethod
    async def get_package_metadata(self, name: str) -> PackageMetadata:
        """Fetch metadata for a single package.

        Args:
            name: Package name.

        Returns:
            PackageMetadata with normalized package information.

        Raises:
            PackageNotFoundError: If the package doesn't exist.
        """
        ...

    @abstractmethod
    async def get_install_stats(self, name: str) -> InstallStats | None:
        """Fetch install/download statistics.

        Args:
            name: Package name.

        Returns:
            InstallStats if available, None if the ecosystem doesn't provide stats.
        """
        ...

    def get_source_repo(self, metadata: PackageMetadata) -> RepoRef | None:
        """Extract source repository reference from metadata.

        Default implementation parses common URL patterns.
        Override for ecosystem-specific logic.

        Args:
            metadata: Package metadata containing repository_url or homepage.

        Returns:
            RepoRef if a repository URL can be parsed, None otherwise.
        """
        url = metadata.repository_url or metadata.homepage
        if not url:
            return None
        return parse_repo_url(url)


def parse_repo_url(url: str) -> RepoRef | None:
    """Parse a repository URL into a RepoRef.

    Supports GitHub, GitLab, and Bitbucket URLs.

    Args:
        url: Repository URL to parse.

    Returns:
        RepoRef if the URL can be parsed, None otherwise.
    """
    if not url:
        return None

    # GitHub patterns
    # https://github.com/owner/repo
    # https://github.com/owner/repo.git
    # https://github.com/owner/repo/tree/main/subpath
    # git://github.com/owner/repo.git
    # git@github.com:owner/repo.git
    github_patterns = [
        r"(?:https?://)?(?:www\.)?github\.com/([^/]+)/([^/.\s]+)(?:\.git)?(?:/tree/[^/]+/(.+))?",
        r"git@github\.com:([^/]+)/([^/.\s]+)(?:\.git)?",
        r"git://github\.com/([^/]+)/([^/.\s]+)(?:\.git)?",
    ]

    for pattern in github_patterns:
        match = re.match(pattern, url)
        if match:
            groups = match.groups()
            return RepoRef(
                platform=Platform.GITHUB,
                owner=groups[0],
                repo=groups[1].rstrip("/"),
                subpath=groups[2] if len(groups) > 2 else None,
            )

    # GitLab patterns
    gitlab_patterns = [
        r"(?:https?://)?(?:www\.)?gitlab\.com/([^/]+)/([^/.\s]+)(?:\.git)?",
        r"git@gitlab\.com:([^/]+)/([^/.\s]+)(?:\.git)?",
    ]

    for pattern in gitlab_patterns:
        match = re.match(pattern, url)
        if match:
            return RepoRef(
                platform=Platform.GITLAB,
                owner=match.group(1),
                repo=match.group(2).rstrip("/"),
            )

    # Bitbucket patterns
    bitbucket_patterns = [
        r"(?:https?://)?(?:www\.)?bitbucket\.org/([^/]+)/([^/.\s]+)(?:\.git)?",
        r"git@bitbucket\.org:([^/]+)/([^/.\s]+)(?:\.git)?",
    ]

    for pattern in bitbucket_patterns:
        match = re.match(pattern, url)
        if match:
            return RepoRef(
                platform=Platform.BITBUCKET,
                owner=match.group(1),
                repo=match.group(2).rstrip("/"),
            )

    return None


class PackageNotFoundError(Exception):
    """Raised when a package cannot be found."""

    def __init__(self, ecosystem: Ecosystem, name: str) -> None:
        self.ecosystem = ecosystem
        self.name = name
        super().__init__(f"Package '{name}' not found in {ecosystem.value}")
