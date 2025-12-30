"""GitHub data fetcher for repository analysis."""

import os
from datetime import datetime, timedelta, timezone

import httpx

from pkgrisk.models.schemas import (
    CIStatus,
    CommitActivity,
    ContributorStats,
    GitHubData,
    GitHubRepoData,
    IssueStats,
    PRStats,
    ReleaseStats,
    RepoFiles,
    RepoRef,
    SecurityData,
)


class GitHubFetcher:
    """Fetches repository data from GitHub API.

    Requires a GitHub personal access token for higher rate limits.
    Set GITHUB_TOKEN environment variable or pass token to constructor.
    """

    BASE_URL = "https://api.github.com"

    def __init__(
        self,
        token: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        """Initialize the fetcher.

        Args:
            token: GitHub personal access token. If not provided, uses GITHUB_TOKEN env var.
            client: Optional httpx client. If not provided, a new client is created.
        """
        self._token = token or os.environ.get("GITHUB_TOKEN")
        self._client = client

    def _headers(self) -> dict[str, str]:
        """Get headers for GitHub API requests."""
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create an HTTP client."""
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=30.0, headers=self._headers())

    async def _fetch(self, path: str, params: dict | None = None) -> dict | list | None:
        """Fetch from GitHub API.

        Returns None if 404, raises on other errors.
        """
        client = await self._get_client()
        url = f"{self.BASE_URL}{path}"

        try:
            response = await client.get(url, params=params, headers=self._headers())
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
        finally:
            if self._client is None:
                await client.aclose()

    async def _fetch_all_pages(
        self,
        path: str,
        params: dict | None = None,
        max_pages: int = 10,
    ) -> list:
        """Fetch all pages from a paginated endpoint."""
        client = await self._get_client()
        url = f"{self.BASE_URL}{path}"
        params = params or {}
        params.setdefault("per_page", 100)

        results = []
        page = 1

        try:
            while page <= max_pages:
                params["page"] = page
                response = await client.get(url, params=params, headers=self._headers())
                if response.status_code == 404:
                    break
                response.raise_for_status()

                data = response.json()
                if not data:
                    break

                results.extend(data)

                # Check if there are more pages
                if len(data) < params["per_page"]:
                    break
                page += 1

            return results
        finally:
            if self._client is None:
                await client.aclose()

    async def fetch_repo_data(self, repo_ref: RepoRef) -> GitHubData | None:
        """Fetch all available data for a GitHub repository.

        Args:
            repo_ref: Reference to the repository.

        Returns:
            GitHubData with all metrics, or None if repo not found.
        """
        owner = repo_ref.owner
        repo = repo_ref.repo

        # Fetch basic repo info first
        repo_data = await self._fetch_repo_info(owner, repo)
        if repo_data is None:
            return None

        # Fetch additional data in parallel would be better, but for simplicity:
        contributors = await self._fetch_contributor_stats(owner, repo)
        commits = await self._fetch_commit_activity(owner, repo)
        issues = await self._fetch_issue_stats(owner, repo)
        prs = await self._fetch_pr_stats(owner, repo)
        releases = await self._fetch_release_stats(owner, repo)
        security = await self._fetch_security_data(owner, repo)
        files = await self._fetch_repo_files(owner, repo, repo_data.default_branch)
        ci = await self._fetch_ci_status(owner, repo)

        return GitHubData(
            repo=repo_data,
            contributors=contributors,
            commits=commits,
            issues=issues,
            prs=prs,
            releases=releases,
            security=security,
            files=files,
            ci=ci,
        )

    async def _fetch_repo_info(self, owner: str, repo: str) -> GitHubRepoData | None:
        """Fetch basic repository information."""
        data = await self._fetch(f"/repos/{owner}/{repo}")
        if data is None:
            return None

        created_at = None
        if data.get("created_at"):
            created_at = datetime.fromisoformat(data["created_at"].replace("Z", "+00:00"))

        updated_at = None
        if data.get("updated_at"):
            updated_at = datetime.fromisoformat(data["updated_at"].replace("Z", "+00:00"))

        pushed_at = None
        if data.get("pushed_at"):
            pushed_at = datetime.fromisoformat(data["pushed_at"].replace("Z", "+00:00"))

        license_info = data.get("license") or {}

        return GitHubRepoData(
            owner=owner,
            name=repo,
            description=data.get("description"),
            stars=data.get("stargazers_count", 0),
            forks=data.get("forks_count", 0),
            open_issues=data.get("open_issues_count", 0),
            watchers=data.get("watchers_count", 0),
            created_at=created_at,
            updated_at=updated_at,
            pushed_at=pushed_at,
            default_branch=data.get("default_branch", "main"),
            license=license_info.get("spdx_id"),
            language=data.get("language"),
            topics=data.get("topics", []),
            is_archived=data.get("archived", False),
            is_fork=data.get("fork", False),
            has_discussions=data.get("has_discussions", False),
        )

    async def _fetch_contributor_stats(self, owner: str, repo: str) -> ContributorStats:
        """Fetch contributor statistics."""
        contributors = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/contributors",
            max_pages=5,
        )

        if not contributors:
            return ContributorStats()

        total = len(contributors)
        total_contributions = sum(c.get("contributions", 0) for c in contributors)

        if total_contributions == 0:
            return ContributorStats(total_contributors=total)

        # Top contributor percentage
        top_contributions = contributors[0].get("contributions", 0) if contributors else 0
        top_pct = (top_contributions / total_contributions * 100) if total_contributions > 0 else 0

        # Count contributors with >5% of commits
        threshold = total_contributions * 0.05
        over_5pct = sum(1 for c in contributors if c.get("contributions", 0) >= threshold)

        # For active contributors, we'd need to check commit dates
        # This is a simplification - just count those with recent activity
        # A more accurate version would fetch recent commits
        active_6mo = min(total, 10)  # Rough estimate

        return ContributorStats(
            total_contributors=total,
            active_contributors_6mo=active_6mo,
            top_contributor_pct=round(top_pct, 1),
            contributors_over_5pct=over_5pct,
        )

    async def _fetch_commit_activity(self, owner: str, repo: str) -> CommitActivity:
        """Fetch commit activity statistics."""
        # Get recent commits
        since = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        commits = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/commits",
            params={"since": since},
            max_pages=10,
        )

        if not commits:
            return CommitActivity()

        # Parse last commit date
        last_commit_date = None
        if commits and commits[0].get("commit", {}).get("author", {}).get("date"):
            date_str = commits[0]["commit"]["author"]["date"]
            last_commit_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))

        # Count commits in time periods
        now = datetime.now(timezone.utc)
        six_months_ago = now - timedelta(days=180)

        commits_6mo = 0
        for commit in commits:
            date_str = commit.get("commit", {}).get("author", {}).get("date")
            if date_str:
                commit_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if commit_date >= six_months_ago:
                    commits_6mo += 1

        return CommitActivity(
            last_commit_date=last_commit_date,
            commits_last_6mo=commits_6mo,
            commits_last_year=len(commits),
        )

    async def _fetch_issue_stats(self, owner: str, repo: str) -> IssueStats:
        """Fetch issue statistics."""
        # Get open issues
        open_issues = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/issues",
            params={"state": "open", "per_page": 100},
            max_pages=3,
        )
        # Filter out pull requests (they're included in issues endpoint)
        open_issues = [i for i in open_issues if "pull_request" not in i]

        # Get recently closed issues
        since = (datetime.now(timezone.utc) - timedelta(days=180)).isoformat()
        closed_issues = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/issues",
            params={"state": "closed", "since": since, "per_page": 100},
            max_pages=3,
        )
        closed_issues = [i for i in closed_issues if "pull_request" not in i]

        # Count good first issues
        good_first_count = sum(
            1
            for i in open_issues
            if any(
                label.get("name", "").lower() in ("good first issue", "good-first-issue")
                for label in i.get("labels", [])
            )
        )

        # Count regression issues
        regression_count = sum(
            1
            for i in open_issues + closed_issues
            if any(
                "regression" in label.get("name", "").lower() for label in i.get("labels", [])
            )
        )

        return IssueStats(
            open_issues=len(open_issues),
            closed_issues_6mo=len(closed_issues),
            good_first_issue_count=good_first_count,
            regression_issue_count=regression_count,
            # avg_response_time would require fetching comments for each issue
        )

    async def _fetch_pr_stats(self, owner: str, repo: str) -> PRStats:
        """Fetch pull request statistics."""
        # Get open PRs
        open_prs = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/pulls",
            params={"state": "open", "per_page": 100},
            max_pages=3,
        )

        # Get recently merged PRs
        closed_prs = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/pulls",
            params={"state": "closed", "per_page": 100},
            max_pages=3,
        )

        now = datetime.now(timezone.utc)
        six_months_ago = now - timedelta(days=180)
        ninety_days_ago = now - timedelta(days=90)

        # Count merged PRs in last 6 months
        merged_6mo = 0
        for pr in closed_prs:
            if pr.get("merged_at"):
                merged_at = datetime.fromisoformat(pr["merged_at"].replace("Z", "+00:00"))
                if merged_at >= six_months_ago:
                    merged_6mo += 1

        # Count stale PRs (open > 90 days)
        stale_count = 0
        for pr in open_prs:
            created_str = pr.get("created_at")
            if created_str:
                created_at = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                if created_at < ninety_days_ago:
                    stale_count += 1

        return PRStats(
            open_prs=len(open_prs),
            merged_prs_6mo=merged_6mo,
            stale_prs=stale_count,
        )

    async def _fetch_release_stats(self, owner: str, repo: str) -> ReleaseStats:
        """Fetch release statistics."""
        releases = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/releases",
            max_pages=5,
        )

        if not releases:
            return ReleaseStats()

        now = datetime.now(timezone.utc)
        one_year_ago = now - timedelta(days=365)

        # Count releases in last year
        releases_last_year = 0
        prerelease_count = 0
        has_signed = False
        last_release_date = None
        latest_version = None

        for i, release in enumerate(releases):
            if i == 0:
                latest_version = release.get("tag_name")
                if release.get("published_at"):
                    last_release_date = datetime.fromisoformat(
                        release["published_at"].replace("Z", "+00:00")
                    )

            published_str = release.get("published_at")
            if published_str:
                published = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
                if published >= one_year_ago:
                    releases_last_year += 1

            if release.get("prerelease"):
                prerelease_count += 1

            # Check for signatures in assets
            for asset in release.get("assets", []):
                name = asset.get("name", "").lower()
                if any(ext in name for ext in [".sig", ".asc", ".sign"]):
                    has_signed = True

        total = len(releases)
        prerelease_ratio = prerelease_count / total if total > 0 else 0

        return ReleaseStats(
            total_releases=total,
            releases_last_year=releases_last_year,
            last_release_date=last_release_date,
            latest_version=latest_version,
            has_signed_releases=has_signed,
            prerelease_ratio=round(prerelease_ratio, 2),
        )

    async def fetch_release_dates(
        self, owner: str, repo: str
    ) -> dict[str, datetime]:
        """Fetch mapping of version tags to release dates.

        Used for calculating time-to-patch for CVEs.

        Args:
            owner: Repository owner.
            repo: Repository name.

        Returns:
            Dict mapping version string (e.g., "v1.2.3") to release datetime.
        """
        releases = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/releases",
            max_pages=10,  # Get more releases for CVE matching
        )

        if not releases:
            return {}

        release_dates = {}
        for release in releases:
            tag = release.get("tag_name")
            published_str = release.get("published_at")
            if tag and published_str:
                try:
                    published = datetime.fromisoformat(
                        published_str.replace("Z", "+00:00")
                    )
                    release_dates[tag] = published
                    # Also store without 'v' prefix for matching
                    if tag.startswith("v"):
                        release_dates[tag[1:]] = published
                except ValueError:
                    pass

        return release_dates

    async def _fetch_security_data(self, owner: str, repo: str) -> SecurityData:
        """Fetch security-related data.

        Includes:
        - SECURITY.md and security policy presence
        - Security CI tools (Dependabot, CodeQL, Snyk, Renovate, Trivy, Semgrep)
        - Signed commits percentage
        - Supply chain security signals (SLSA, Sigstore, SBOM)
        """
        # Check for SECURITY.md
        security_md = await self._fetch(f"/repos/{owner}/{repo}/contents/SECURITY.md")
        has_security_md = security_md is not None

        # Check for security policy via community profile
        community = await self._fetch(f"/repos/{owner}/{repo}/community/profile")
        has_security_policy = False
        if community:
            files = community.get("files", {})
            has_security_policy = files.get("security_policy") is not None

        # Check for Dependabot config
        dependabot = await self._fetch(
            f"/repos/{owner}/{repo}/contents/.github/dependabot.yml"
        )
        has_dependabot = dependabot is not None
        if not has_dependabot:
            dependabot = await self._fetch(
                f"/repos/{owner}/{repo}/contents/.github/dependabot.yaml"
            )
            has_dependabot = dependabot is not None

        # Check for Renovate config
        has_renovate = False
        renovate_files = [
            ".github/renovate.json",
            ".github/renovate.json5",
            "renovate.json",
            "renovate.json5",
            ".renovaterc",
            ".renovaterc.json",
        ]
        for renovate_file in renovate_files:
            renovate = await self._fetch(f"/repos/{owner}/{repo}/contents/{renovate_file}")
            if renovate is not None:
                has_renovate = True
                break

        # Check for workflows and detect security tools
        workflows = await self._fetch(f"/repos/{owner}/{repo}/contents/.github/workflows")
        has_codeql = False
        has_snyk = False
        has_trivy = False
        has_semgrep = False
        has_security_ci = has_dependabot or has_renovate
        has_sigstore = False
        has_sbom = False
        slsa_level = None

        if workflows and isinstance(workflows, list):
            import base64

            for wf in workflows:
                name = wf.get("name", "").lower()

                # Check workflow filename
                if "codeql" in name:
                    has_codeql = True
                    has_security_ci = True
                if "snyk" in name:
                    has_snyk = True
                    has_security_ci = True
                if "trivy" in name:
                    has_trivy = True
                    has_security_ci = True
                if "semgrep" in name:
                    has_semgrep = True
                    has_security_ci = True
                if "security" in name:
                    has_security_ci = True
                if "slsa" in name:
                    has_security_ci = True
                if "sigstore" in name or "cosign" in name:
                    has_sigstore = True
                if "sbom" in name or "cyclonedx" in name or "spdx" in name:
                    has_sbom = True

                # For more accurate detection, fetch workflow content
                wf_content = await self._fetch(f"/repos/{owner}/{repo}/contents/.github/workflows/{wf.get('name')}")
                if wf_content and wf_content.get("content"):
                    try:
                        content = base64.b64decode(wf_content["content"]).decode("utf-8").lower()
                        if "github/codeql-action" in content:
                            has_codeql = True
                            has_security_ci = True
                        if "snyk/actions" in content or "snyk-" in content:
                            has_snyk = True
                            has_security_ci = True
                        if "aquasecurity/trivy" in content or "trivy-action" in content:
                            has_trivy = True
                            has_security_ci = True
                        if "semgrep" in content or "returntocorp/semgrep" in content:
                            has_semgrep = True
                            has_security_ci = True
                        if "sigstore/cosign" in content or "cosign-installer" in content:
                            has_sigstore = True
                        if "anchore/sbom-action" in content or "cyclonedx" in content or "spdx" in content:
                            has_sbom = True
                        # SLSA detection
                        if "slsa-framework" in content or "slsa-github-generator" in content:
                            # Try to detect SLSA level from content
                            if "slsa-builder-go" in content or "slsa-verifier" in content:
                                slsa_level = 3
                            elif "provenance" in content:
                                slsa_level = 2
                            else:
                                slsa_level = 1
                    except Exception:
                        pass

        # Calculate signed commits percentage
        signed_commits_pct = await self._calculate_signed_commits_pct(owner, repo)

        # Check for reproducible builds (look for specific files/configs)
        has_reproducible_builds = False
        # Check for common reproducible build indicators
        reproducible_files = [
            ".goreleaser.yml",
            ".goreleaser.yaml",
            "Earthfile",  # Earthly
            "nix/",  # Nix builds
        ]
        root_files = await self._fetch(f"/repos/{owner}/{repo}/contents")
        if root_files and isinstance(root_files, list):
            root_names = {item.get("name", "").lower() for item in root_files}
            if any(f.lower().rstrip("/") in root_names for f in reproducible_files):
                has_reproducible_builds = True

        return SecurityData(
            has_security_md=has_security_md,
            has_security_policy=has_security_policy,
            has_dependabot=has_dependabot,
            has_codeql=has_codeql,
            has_security_ci=has_security_ci,
            has_snyk=has_snyk,
            has_renovate=has_renovate,
            has_trivy=has_trivy,
            has_semgrep=has_semgrep,
            slsa_level=slsa_level,
            has_sigstore=has_sigstore,
            has_sbom=has_sbom,
            has_reproducible_builds=has_reproducible_builds,
            signed_commits_pct=signed_commits_pct,
        )

    async def _calculate_signed_commits_pct(self, owner: str, repo: str) -> float:
        """Calculate the percentage of signed commits in recent history.

        Checks the verification status of recent commits.

        Returns:
            Percentage of signed commits (0.0 to 100.0)
        """
        # Fetch recent commits with verification info
        commits = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/commits",
            params={"per_page": 100},
            max_pages=1,  # Just check last 100 commits
        )

        if not commits:
            return 0.0

        signed_count = 0
        total_count = len(commits)

        for commit in commits:
            verification = commit.get("commit", {}).get("verification", {})
            if verification.get("verified", False):
                signed_count += 1

        if total_count == 0:
            return 0.0

        return round((signed_count / total_count) * 100, 1)

    async def _fetch_repo_files(
        self, owner: str, repo: str, default_branch: str
    ) -> RepoFiles:
        """Check for presence of key repository files."""
        # Fetch root directory
        root = await self._fetch(f"/repos/{owner}/{repo}/contents")
        if not root or not isinstance(root, list):
            return RepoFiles()

        root_files = {item.get("name", "").lower(): item for item in root}

        # Check README
        has_readme = False
        readme_size = 0
        for name in ["readme.md", "readme.rst", "readme.txt", "readme"]:
            if name in root_files:
                has_readme = True
                readme_size = root_files[name].get("size", 0)
                break

        # Check other files
        has_license = any(
            name.startswith("license") for name in root_files
        )
        has_changelog = any(
            name.startswith("changelog") or name == "history.md" or name == "changes.md"
            for name in root_files
        )
        has_contributing = "contributing.md" in root_files
        has_coc = "code_of_conduct.md" in root_files
        has_codeowners = False
        has_governance = "governance.md" in root_files

        # Check directories
        has_docs = any(
            name in ["docs", "doc", "documentation"] and root_files[name].get("type") == "dir"
            for name in root_files
        )
        has_examples = any(
            name in ["examples", "example", "samples"]
            and root_files[name].get("type") == "dir"
            for name in root_files
        )
        has_tests = any(
            name in ["test", "tests", "__tests__", "spec", "specs"]
            and root_files[name].get("type") == "dir"
            for name in root_files
        )

        # Check .github directory
        github_dir = await self._fetch(f"/repos/{owner}/{repo}/contents/.github")
        has_ci = False
        if github_dir and isinstance(github_dir, list):
            github_files = {item.get("name", "").lower() for item in github_dir}
            has_codeowners = "codeowners" in github_files
            has_ci = "workflows" in github_files

        return RepoFiles(
            has_readme=has_readme,
            readme_size_bytes=readme_size,
            has_license=has_license,
            has_changelog=has_changelog,
            has_contributing=has_contributing,
            has_code_of_conduct=has_coc,
            has_codeowners=has_codeowners,
            has_governance=has_governance,
            has_docs_dir=has_docs,
            has_examples_dir=has_examples,
            has_tests_dir=has_tests,
            has_ci_config=has_ci,
        )

    async def _fetch_ci_status(self, owner: str, repo: str) -> CIStatus:
        """Fetch CI/CD status."""
        workflows = await self._fetch(f"/repos/{owner}/{repo}/actions/workflows")

        if not workflows:
            return CIStatus()

        workflow_list = workflows.get("workflows", [])
        has_actions = len(workflow_list) > 0

        # Get recent workflow runs to calculate pass rate
        runs = await self._fetch(
            f"/repos/{owner}/{repo}/actions/runs",
            params={"per_page": 50},
        )

        pass_rate = None
        if runs:
            run_list = runs.get("workflow_runs", [])
            if run_list:
                completed = [r for r in run_list if r.get("status") == "completed"]
                if completed:
                    successful = sum(
                        1 for r in completed if r.get("conclusion") == "success"
                    )
                    pass_rate = round(successful / len(completed) * 100, 1)

        return CIStatus(
            has_github_actions=has_actions,
            workflow_count=len(workflow_list),
            recent_runs_pass_rate=pass_rate,
        )

    async def fetch_readme_content(self, owner: str, repo: str) -> str | None:
        """Fetch the README content for LLM analysis."""
        readme = await self._fetch(f"/repos/{owner}/{repo}/readme")
        if not readme:
            return None

        # README content is base64 encoded
        import base64

        content = readme.get("content", "")
        if content:
            try:
                return base64.b64decode(content).decode("utf-8")
            except Exception:
                return None
        return None

    async def fetch_security_md_content(self, owner: str, repo: str) -> str | None:
        """Fetch SECURITY.md content for LLM analysis."""
        security = await self._fetch(f"/repos/{owner}/{repo}/contents/SECURITY.md")
        if not security:
            return None

        import base64

        content = security.get("content", "")
        if content:
            try:
                return base64.b64decode(content).decode("utf-8")
            except Exception:
                return None
        return None

    async def fetch_recent_issues(
        self, owner: str, repo: str, limit: int = 20
    ) -> list[dict]:
        """Fetch recent issues with comments for sentiment analysis."""
        issues = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/issues",
            params={"state": "all", "sort": "updated", "per_page": limit},
            max_pages=1,
        )

        # Filter out PRs and limit
        issues = [i for i in issues if "pull_request" not in i][:limit]

        # Simplify for LLM consumption
        result = []
        for issue in issues:
            result.append({
                "title": issue.get("title"),
                "state": issue.get("state"),
                "created_at": issue.get("created_at"),
                "comments": issue.get("comments", 0),
                "labels": [l.get("name") for l in issue.get("labels", [])],
                "body": (issue.get("body") or "")[:500],  # Truncate long bodies
            })

        return result

    async def fetch_changelog_content(self, owner: str, repo: str) -> str | None:
        """Fetch CHANGELOG content for LLM analysis.

        Tries multiple common changelog filenames.
        """
        import base64

        # Try common changelog names
        changelog_names = [
            "CHANGELOG.md",
            "CHANGELOG",
            "CHANGELOG.txt",
            "CHANGES.md",
            "CHANGES",
            "HISTORY.md",
            "HISTORY",
            "NEWS.md",
            "NEWS",
        ]

        for name in changelog_names:
            content_data = await self._fetch(f"/repos/{owner}/{repo}/contents/{name}")
            if content_data and content_data.get("content"):
                try:
                    return base64.b64decode(content_data["content"]).decode("utf-8")
                except Exception:
                    continue

        return None

    async def fetch_governance_docs(self, owner: str, repo: str) -> str | None:
        """Fetch governance-related documentation for LLM analysis.

        Combines GOVERNANCE.md, CONTRIBUTING.md, and related docs.
        """
        import base64

        docs = []

        # Files to check
        gov_files = [
            "GOVERNANCE.md",
            "CONTRIBUTING.md",
            "MAINTAINERS.md",
            "MAINTAINERS",
            ".github/CONTRIBUTING.md",
        ]

        for filename in gov_files:
            content_data = await self._fetch(f"/repos/{owner}/{repo}/contents/{filename}")
            if content_data and content_data.get("content"):
                try:
                    content = base64.b64decode(content_data["content"]).decode("utf-8")
                    docs.append(f"# {filename}\n\n{content}")
                except Exception:
                    continue

        return "\n\n---\n\n".join(docs) if docs else None

    async def fetch_maintainer_comments(
        self, owner: str, repo: str, limit: int = 30
    ) -> list[str]:
        """Fetch recent comments from maintainers on issues and PRs.

        Returns a list of comment texts from maintainers.
        """
        # First get list of contributors to identify maintainers
        contributors = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/contributors",
            max_pages=1,
        )

        # Consider top contributors as maintainers (top 5 or those with significant contributions)
        maintainer_logins = set()
        if contributors:
            total_contributions = sum(c.get("contributions", 0) for c in contributors[:10])
            threshold = total_contributions * 0.05 if total_contributions > 0 else 1
            for c in contributors[:10]:
                if c.get("contributions", 0) >= threshold:
                    maintainer_logins.add(c.get("login", "").lower())

        # Also add repo owner
        maintainer_logins.add(owner.lower())

        if not maintainer_logins:
            return []

        # Fetch recent issue comments
        comments = await self._fetch_all_pages(
            f"/repos/{owner}/{repo}/issues/comments",
            params={"sort": "updated", "direction": "desc", "per_page": 100},
            max_pages=2,
        )

        # Filter to maintainer comments
        maintainer_comments = []
        for comment in comments:
            author = comment.get("user", {}).get("login", "").lower()
            if author in maintainer_logins:
                body = comment.get("body", "")
                if body and len(body) > 20:  # Skip very short comments
                    maintainer_comments.append(body[:1000])  # Truncate long comments

            if len(maintainer_comments) >= limit:
                break

        return maintainer_comments

    # Language to file extension mapping for security analysis
    LANGUAGE_EXTENSIONS: dict[str, list[str]] = {
        "python": [".py"],
        "javascript": [".js", ".mjs", ".cjs"],
        "typescript": [".ts", ".tsx"],
        "rust": [".rs"],
        "go": [".go"],
        "ruby": [".rb"],
        "java": [".java"],
        "c": [".c", ".h"],
        "c++": [".cpp", ".cc", ".cxx", ".hpp", ".h"],
        "c#": [".cs"],
        "php": [".php"],
        "shell": [".sh", ".bash"],
    }

    # Priority patterns for security-relevant files (checked in order)
    SECURITY_PRIORITY_PATTERNS: list[str] = [
        # Entry points
        "main", "app", "index", "server", "cli", "run",
        # Configuration
        "config", "settings", "env", "secrets",
        # Authentication/Authorization
        "auth", "login", "session", "token", "password", "credential",
        # Input handling
        "input", "parse", "request", "handler", "route", "api",
        # Database
        "database", "db", "query", "sql", "model",
        # Security
        "security", "crypto", "encrypt", "hash", "sanitize", "validate",
        # Network
        "http", "client", "connection", "socket",
    ]

    async def fetch_source_files_for_security(
        self,
        owner: str,
        repo: str,
        language: str | None,
        default_branch: str = "main",
        max_bytes: int = 15000,
        max_files: int = 10,
    ) -> str | None:
        """Fetch source files for security analysis.

        Prioritizes security-sensitive files like entry points, config,
        auth handlers, and input processing.

        Args:
            owner: Repository owner.
            repo: Repository name.
            language: Primary language of the repo.
            default_branch: Default branch name.
            max_bytes: Maximum total bytes to fetch.
            max_files: Maximum number of files to include.

        Returns:
            Combined source code with file headers, or None if no files found.
        """
        import base64

        if not language:
            return None

        # Get file extensions for this language
        extensions = self.LANGUAGE_EXTENSIONS.get(language.lower(), [])
        if not extensions:
            # Try to handle common variations
            lang_lower = language.lower()
            if "python" in lang_lower:
                extensions = [".py"]
            elif "javascript" in lang_lower or "node" in lang_lower:
                extensions = [".js", ".mjs"]
            elif "typescript" in lang_lower:
                extensions = [".ts", ".tsx"]
            elif "rust" in lang_lower:
                extensions = [".rs"]
            elif "go" in lang_lower:
                extensions = [".go"]
            else:
                return None

        # Fetch the repository tree
        tree_data = await self._fetch(
            f"/repos/{owner}/{repo}/git/trees/{default_branch}",
            params={"recursive": "1"},
        )

        if not tree_data or "tree" not in tree_data:
            return None

        # Filter to source files with matching extensions
        source_files = []
        for item in tree_data["tree"]:
            if item.get("type") != "blob":
                continue

            path = item.get("path", "")
            size = item.get("size", 0)

            # Skip very large files
            if size > 50000:
                continue

            # Check extension
            if not any(path.endswith(ext) for ext in extensions):
                continue

            # Skip test files, vendor, node_modules, etc.
            path_lower = path.lower()
            skip_patterns = [
                "test", "spec", "mock", "fixture", "vendor", "node_modules",
                "dist", "build", "__pycache__", ".min.", "example", "sample",
                "benchmark", "doc/", "docs/",
            ]
            if any(pattern in path_lower for pattern in skip_patterns):
                continue

            # Calculate priority score based on security-relevant patterns
            priority = 0
            filename_lower = path.split("/")[-1].lower()
            for i, pattern in enumerate(self.SECURITY_PRIORITY_PATTERNS):
                if pattern in filename_lower or pattern in path_lower:
                    priority = len(self.SECURITY_PRIORITY_PATTERNS) - i
                    break

            source_files.append({
                "path": path,
                "sha": item.get("sha"),
                "size": size,
                "priority": priority,
            })

        if not source_files:
            return None

        # Sort by priority (highest first), then by path depth (shallower first)
        source_files.sort(key=lambda f: (-f["priority"], f["path"].count("/")))

        # Fetch file contents up to limits
        fetched_content = []
        total_bytes = 0

        for file_info in source_files:
            if len(fetched_content) >= max_files:
                break
            if total_bytes >= max_bytes:
                break

            # Fetch file content
            blob_data = await self._fetch(
                f"/repos/{owner}/{repo}/git/blobs/{file_info['sha']}"
            )

            if not blob_data or "content" not in blob_data:
                continue

            try:
                content = base64.b64decode(blob_data["content"]).decode("utf-8")
            except Exception:
                continue

            # Truncate if needed to stay within limits
            remaining_bytes = max_bytes - total_bytes
            if len(content) > remaining_bytes:
                content = content[:remaining_bytes] + "\n... (truncated)"

            fetched_content.append(f"=== FILE: {file_info['path']} ===\n{content}")
            total_bytes += len(content)

        if not fetched_content:
            return None

        return "\n\n".join(fetched_content)
