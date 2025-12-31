"""Supply chain security analyzers for detecting malicious package patterns.

Implements detection for Shai Hulud-style attacks including:
- Malicious lifecycle scripts (preinstall, postinstall)
- Obfuscated code patterns
- Credential harvesting indicators
- Suspicious version changes
- Tarball vs repository discrepancies
"""

from __future__ import annotations

import base64
import gzip
import io
import json
import logging
import re
import tarfile
from pathlib import Path

import httpx

from pkgrisk.models.schemas import (
    LifecycleScriptRisk,
    PublishingInfo,
    SupplyChainData,
    SuspiciousPattern,
    TarballAnalysis,
    TarballFile,
    VersionDiff,
)

logger = logging.getLogger(__name__)


# === Pattern Definitions ===

# Lifecycle scripts that execute during install (dangerous)
DANGEROUS_LIFECYCLE_SCRIPTS = {
    "preinstall",
    "install",
    "postinstall",
    "preuninstall",
    "postuninstall",
}

# Scripts that run during publish/prepare (less dangerous but worth noting)
LIFECYCLE_SCRIPTS = DANGEROUS_LIFECYCLE_SCRIPTS | {
    "prepare",
    "prepublish",
    "prepublishOnly",
    "prepack",
    "postpack",
}

# Obfuscation patterns
# Note: These patterns are tuned to minimize false positives on legitimate libraries
OBFUSCATION_PATTERNS = [
    # Very long base64 strings (>200 chars is suspicious)
    (r"['\"][A-Za-z0-9+/=]{200,}['\"]", "long_base64", "critical", "Very long base64-encoded string detected"),
    # Hex-encoded strings (long sequences)
    (r"\\x[0-9a-fA-F]{2}(\\x[0-9a-fA-F]{2}){30,}", "hex_encoding", "high", "Long hex-encoded string sequence"),
    # eval() with dynamic content - more specific pattern
    (r"\beval\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)", "eval_dynamic", "high", "eval() with variable (potential code injection)"),
    # eval() with string concatenation - very suspicious
    (r"\beval\s*\([^)]*\+[^)]*\)", "eval_concat", "critical", "eval() with concatenation (code injection risk)"),
    # Function constructor with string concatenation (more specific than just Function())
    (r"new\s+Function\s*\([^)]*\+[^)]*\)", "function_constructor_concat", "critical", "Function constructor with concatenation"),
    # Obfuscated variable names (very long single-letter style)
    (r"\b[_$][a-zA-Z0-9_$]{40,}\b", "obfuscated_names", "medium", "Heavily obfuscated variable names"),
    # String array with many elements (common obfuscation pattern)
    (r"\[['\"][^'\"]+['\"](?:\s*,\s*['\"][^'\"]+['\"]){20,}\]", "string_array", "medium", "Large string array (potential obfuscation)"),
    # Char code with many arguments (deobfuscation pattern)
    (r"String\.fromCharCode\s*\([^)]{50,}\)", "charcode", "high", "String.fromCharCode with many codes (deobfuscation)"),
    # Buffer from base64 with variable
    (r"Buffer\.from\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*,\s*['\"]base64['\"]", "buffer_base64", "medium", "Buffer.from base64 with variable"),
]

# Network/exfiltration patterns (tuned to reduce false positives)
NETWORK_PATTERNS = [
    # HTTP URLs in strings (must be a full URL, not partial)
    (r"['\"]https?://[^'\"]{10,}['\"]", "url_literal", "low", "Hardcoded URL in string"),
    # curl/wget/nc in shell commands (require shell context)
    (r"\b(sh|bash|exec|spawn|system)\s*\([^)]*\b(curl|wget|nc|netcat)\b", "shell_network", "critical", "Shell network command execution"),
    # Direct curl/wget at start of command string
    (r"['\"](?:curl|wget|nc|netcat)\s+[^'\"]+['\"]", "shell_network_string", "high", "Shell network command in string"),
    # HTTP POST with suspicious context
    (r"method:\s*['\"]POST['\"].*(?:token|password|secret|cred)", "http_post_sensitive", "high", "HTTP POST with sensitive data"),
]

# Credential/secret access patterns (focused on actual theft attempts)
CREDENTIAL_PATTERNS = [
    # NPM token paths in strings
    (r"['\"].*\.npmrc['\"]", "npmrc_access", "critical", "Accessing .npmrc (npm tokens)"),
    (r"['\"]NPM_TOKEN['\"]|process\.env\.NPM_TOKEN", "npm_token_env", "critical", "NPM_TOKEN environment variable"),
    # SSH key paths in strings
    (r"['\"].*\.(ssh|gnupg)[/\\]['\"]", "ssh_access", "critical", "Accessing SSH/GPG directory"),
    (r"['\"].*id_(rsa|ed25519|ecdsa)['\"]", "ssh_key_file", "critical", "SSH private key file reference"),
    # AWS/cloud credential paths
    (r"['\"].*\.(aws|config/gcloud|azure)[/\\]['\"]", "cloud_creds", "critical", "Accessing cloud credentials"),
    (r"process\.env\.(AWS_ACCESS_KEY|AWS_SECRET|GOOGLE_APPLICATION_CREDENTIALS)", "cloud_env", "critical", "Cloud credential env vars"),
    # Environment variable enumeration (very suspicious)
    (r"Object\.keys\s*\(\s*process\.env\s*\)", "env_keys", "critical", "Enumerating all environment variables"),
    (r"Object\.entries\s*\(\s*process\.env\s*\)", "env_entries", "critical", "Enumerating all environment variables"),
]

# Process spawning patterns (focused on shell execution in install context)
PROCESS_PATTERNS = [
    # Dangerous shell commands in strings
    (r"['\"](?:rm\s+-rf|chmod\s+777|>>\s*/etc/)['\"]", "dangerous_shell_string", "critical", "Dangerous shell command in string"),
    # Child process with shell command
    (r"(?:exec|spawn)(?:Sync)?\s*\(\s*['\"](?:sh|bash|cmd|powershell)", "shell_exec", "high", "Shell execution via child process"),
]

# File system patterns (only flag obvious malicious access)
FILESYSTEM_PATTERNS = [
    # Writing to home directory hidden files
    (r"writeFile(?:Sync)?\s*\([^)]*['\"].*\/\.[a-z]", "hidden_file_write", "high", "Writing hidden files in home directory"),
]

# Runtime installation (Shai Hulud signature)
RUNTIME_PATTERNS = [
    (r"\bbun\.sh\b", "bun_install", "critical", "Bun runtime installation (Shai Hulud indicator)"),
    (r"npm\s+(i|install).*?\s+bun\b", "bun_npm", "critical", "Installing Bun via npm"),
    (r"deno\.(land|com)", "deno_install", "high", "Deno runtime reference"),
    (r"install.*?(bun|deno)\b", "runtime_install", "high", "Alternative runtime installation"),
]

# Lifecycle script-specific patterns (for shell commands in scripts section)
# These patterns don't require quotes since script values are shell commands
LIFECYCLE_SCRIPT_PATTERNS = [
    # Direct curl/wget execution
    (r"\b(curl|wget)\s+", "script_network_fetch", "high", "Network download in script"),
    # Piping to shell
    (r"\|\s*(bash|sh|zsh)\b", "script_pipe_shell", "critical", "Piping output to shell (RCE risk)"),
    # Node/JS file execution
    (r"node\s+[a-zA-Z_][a-zA-Z0-9_]*\.js\b", "script_node_exec", "medium", "Node.js file execution in script"),
    # Environment variable access
    (r"\$[A-Z_]+", "script_env_var", "low", "Environment variable in script"),
    # URL patterns
    (r"https?://[^\s]+", "script_url", "medium", "URL in script"),
    # Base64 decode
    (r"base64\s+(-d|--decode)", "script_base64_decode", "high", "Base64 decoding in script"),
]

# Suspicious file names (from Shai Hulud)
SUSPICIOUS_FILENAMES = {
    "setup_bun.js": "critical",
    "bun_environment.js": "critical",
    "postinstall.js": "high",
    "preinstall.js": "high",
    ".env.js": "high",
    "config.min.js": "medium",
}

# Binary/native file extensions
BINARY_EXTENSIONS = {".node", ".so", ".dll", ".dylib", ".exe", ".bin"}

# Minified JS indicators
MINIFIED_PATTERNS = [
    # Very long lines
    r"^.{500,}$",
    # No whitespace between tokens
    r"\w\(\w\)\{\w",
]


class SupplyChainAnalyzer:
    """Analyzer for supply chain security risks in packages."""

    def __init__(self, client: httpx.AsyncClient | None = None):
        """Initialize the analyzer.

        Args:
            client: Optional HTTP client for fetching tarballs
        """
        self._client = client

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=60.0, follow_redirects=True)

    def analyze_lifecycle_scripts(
        self,
        package_json: dict,
        script_files: dict[str, str] | None = None,
    ) -> LifecycleScriptRisk:
        """Analyze package.json scripts for suspicious patterns.

        Args:
            package_json: Parsed package.json content
            script_files: Optional dict of script filename -> content for deeper analysis

        Returns:
            LifecycleScriptRisk with detected issues
        """
        result = LifecycleScriptRisk()
        scripts = package_json.get("scripts", {})

        if not scripts:
            return result

        # Check for dangerous lifecycle scripts
        for script_name in DANGEROUS_LIFECYCLE_SCRIPTS:
            if script_name in scripts:
                setattr(result, f"has_{script_name}", True)
                result.scripts[script_name] = scripts[script_name]
                result.risk_factors.append(f"Has {script_name} script")

        # Also track other lifecycle scripts
        if "prepare" in scripts:
            result.has_prepare = True
            result.scripts["prepare"] = scripts["prepare"]
        if "prepublish" in scripts:
            result.has_prepublish = True
            result.scripts["prepublish"] = scripts["prepublish"]

        # Analyze script contents using lifecycle-specific patterns
        all_patterns = []
        for script_name, script_cmd in result.scripts.items():
            # Use lifecycle-specific patterns for shell commands
            patterns = self._analyze_lifecycle_script(script_cmd, f"scripts.{script_name}")
            all_patterns.extend(patterns)

            # Update detection flags based on pattern type
            for pattern in patterns:
                ptype = pattern.pattern_type
                # Obfuscation patterns
                if ptype in ("long_base64", "hex_encoding", "eval_dynamic", "eval_concat",
                             "function_constructor_concat", "charcode", "string_array"):
                    result.has_obfuscation = True
                # Network patterns
                elif ptype in ("url_literal", "shell_network", "shell_network_string",
                               "script_network_fetch", "script_url"):
                    result.has_network_calls = True
                # Credential access patterns
                elif ptype in ("npmrc_access", "npm_token_env", "ssh_access", "ssh_key_file",
                               "cloud_creds", "cloud_env", "env_keys", "env_entries"):
                    result.has_credential_access = True
                # Process spawning patterns
                elif ptype in ("dangerous_shell_string", "shell_exec", "script_pipe_shell"):
                    result.has_process_spawn = True
                # File system patterns
                elif ptype in ("hidden_file_write",):
                    result.has_file_system_access = True
                # Environment access
                elif "env" in ptype:
                    result.has_env_access = True
                # Runtime installation (critical Shai Hulud indicator)
                elif ptype in ("bun_install", "bun_npm", "deno_install", "runtime_install"):
                    result.installs_runtime = True

        # If we have script files, analyze those too
        if script_files:
            for filename, content in script_files.items():
                file_patterns = self._analyze_content(content, filename)
                all_patterns.extend(file_patterns)

        result.suspicious_patterns = all_patterns

        # Calculate risk score
        result.risk_score = self._calculate_script_risk_score(result)

        return result

    def _analyze_lifecycle_script(self, script_cmd: str, location: str) -> list[SuspiciousPattern]:
        """Analyze a lifecycle script command for suspicious patterns.

        This uses lifecycle-specific patterns that are appropriate for shell commands,
        not JavaScript source code.

        Args:
            script_cmd: The shell command from the script
            location: Script name (e.g., "scripts.preinstall")

        Returns:
            List of detected suspicious patterns
        """
        patterns = []

        for regex, pattern_type, severity, description in LIFECYCLE_SCRIPT_PATTERNS:
            matches = re.finditer(regex, script_cmd, re.IGNORECASE)
            for match in matches:
                matched = match.group(0)
                if len(matched) > 100:
                    matched = matched[:100] + "..."

                patterns.append(SuspiciousPattern(
                    pattern_type=pattern_type,
                    severity=severity,
                    location=location,
                    matched_content=matched,
                    description=description,
                ))

        # Also check runtime patterns
        for regex, pattern_type, severity, description in RUNTIME_PATTERNS:
            matches = re.finditer(regex, script_cmd, re.IGNORECASE)
            for match in matches:
                matched = match.group(0)
                patterns.append(SuspiciousPattern(
                    pattern_type=pattern_type,
                    severity=severity,
                    location=location,
                    matched_content=matched,
                    description=description,
                ))

        return patterns

    def _analyze_content(self, content: str, location: str) -> list[SuspiciousPattern]:
        """Analyze content for suspicious patterns.

        Args:
            content: Code/script content to analyze
            location: File or location identifier

        Returns:
            List of detected suspicious patterns
        """
        patterns = []

        all_pattern_sets = [
            OBFUSCATION_PATTERNS,
            NETWORK_PATTERNS,
            CREDENTIAL_PATTERNS,
            PROCESS_PATTERNS,
            FILESYSTEM_PATTERNS,
            RUNTIME_PATTERNS,
        ]

        for pattern_set in all_pattern_sets:
            for regex, pattern_type, severity, description in pattern_set:
                matches = re.finditer(regex, content, re.IGNORECASE | re.MULTILINE)
                for match in matches:
                    # Truncate matched content for readability
                    matched = match.group(0)
                    if len(matched) > 100:
                        matched = matched[:100] + "..."

                    patterns.append(SuspiciousPattern(
                        pattern_type=pattern_type,
                        severity=severity,
                        location=location,
                        matched_content=matched,
                        description=description,
                    ))

        return patterns

    def _calculate_script_risk_score(self, result: LifecycleScriptRisk) -> int:
        """Calculate risk score for lifecycle scripts.

        Returns:
            Risk score 0-100
        """
        score = 0

        # Base score for having lifecycle scripts
        if result.has_preinstall:
            score += 30  # preinstall is most dangerous
        if result.has_postinstall:
            score += 20
        if result.has_install:
            score += 15

        # Pattern severity scores
        for pattern in result.suspicious_patterns:
            if pattern.severity == "critical":
                score += 25
            elif pattern.severity == "high":
                score += 15
            elif pattern.severity == "medium":
                score += 8
            else:
                score += 3

        # Flag-based additions
        if result.has_obfuscation:
            score += 20
        if result.has_credential_access:
            score += 25
        if result.installs_runtime:
            score += 30  # Shai Hulud signature
        if result.has_network_calls and result.has_credential_access:
            score += 20  # Exfiltration combo

        return min(100, score)

    async def analyze_tarball(
        self,
        tarball_url: str,
        repo_files: set[str] | None = None,
    ) -> TarballAnalysis:
        """Download and analyze npm tarball.

        Args:
            tarball_url: URL to the npm tarball
            repo_files: Optional set of files in the repository for comparison

        Returns:
            TarballAnalysis with findings
        """
        result = TarballAnalysis(tarball_url=tarball_url)

        try:
            client = await self._get_client()
            response = await client.get(tarball_url)
            response.raise_for_status()

            tarball_data = response.content
            result.tarball_size_bytes = len(tarball_data)

            # Parse tarball
            with gzip.GzipFile(fileobj=io.BytesIO(tarball_data)) as gz:
                with tarfile.open(fileobj=gz, mode="r:") as tar:
                    for member in tar.getmembers():
                        if not member.isfile():
                            continue

                        # Normalize path (remove package/ prefix)
                        path = member.name
                        if path.startswith("package/"):
                            path = path[8:]

                        result.file_count += 1

                        # Check file properties
                        ext = Path(path).suffix.lower()
                        is_binary = ext in BINARY_EXTENSIONS
                        is_executable = member.mode & 0o111 != 0

                        result.files.append(TarballFile(
                            path=path,
                            size_bytes=member.size,
                            is_executable=is_executable,
                            is_binary=is_binary,
                        ))

                        if is_binary:
                            result.has_native_code = True

                        # Check for suspicious filenames
                        filename = Path(path).name
                        if filename in SUSPICIOUS_FILENAMES:
                            result.suspicious_files.append(path)
                            severity = SUSPICIOUS_FILENAMES[filename]
                            result.suspicious_patterns.append(SuspiciousPattern(
                                pattern_type="suspicious_filename",
                                severity=severity,
                                location=path,
                                matched_content=filename,
                                description=f"Known malicious filename pattern: {filename}",
                            ))

                        # Compare with repo files
                        if repo_files is not None and path not in repo_files:
                            # Check if it's a common generated file
                            if not self._is_expected_generated_file(path):
                                result.files_not_in_repo.append(path)

                        # Analyze JS files for suspicious patterns
                        # Skip minified files to reduce false positives
                        if ext in (".js", ".mjs", ".cjs") and member.size < 500_000:
                            try:
                                file_obj = tar.extractfile(member)
                                if file_obj:
                                    content = file_obj.read().decode("utf-8", errors="ignore")

                                    # Check for minification
                                    if self._is_minified(content):
                                        result.has_minified_js = True
                                        result.minified_files.append(path)
                                        # Skip pattern analysis on minified files
                                        # (too many false positives)
                                        continue

                                    # Only analyze non-minified source files
                                    patterns = self._analyze_content(content, path)
                                    result.suspicious_patterns.extend(patterns)
                            except Exception as e:
                                logger.debug(f"Error reading {path}: {e}")

        except Exception as e:
            logger.warning(f"Error analyzing tarball {tarball_url}: {e}")

        # Calculate risk score
        result.risk_score = self._calculate_tarball_risk_score(result)

        if self._client is None:
            await client.aclose()

        return result

    def _is_expected_generated_file(self, path: str) -> bool:
        """Check if a file is expected to be generated (not in repo)."""
        expected_patterns = [
            r"^dist/",
            r"^build/",
            r"^lib/",
            r"^out/",
            r"\.d\.ts$",
            r"\.map$",
            r"^\..*",  # Hidden files
            r"package\.json$",
            r"README",
            r"LICENSE",
            r"CHANGELOG",
        ]
        for pattern in expected_patterns:
            if re.search(pattern, path, re.IGNORECASE):
                return True
        return False

    def _is_minified(self, content: str) -> bool:
        """Check if JS content appears to be minified."""
        lines = content.split("\n")
        if not lines:
            return False

        # Check average line length
        avg_len = sum(len(line) for line in lines) / len(lines)
        if avg_len > 200:
            return True

        # Very few lines for large content
        if len(content) > 10000 and len(lines) < 50:
            return True

        return False

    def _calculate_tarball_risk_score(self, result: TarballAnalysis) -> int:
        """Calculate risk score for tarball analysis."""
        score = 0

        # Suspicious files
        score += len(result.suspicious_files) * 25

        # Files not in repo (potential injection)
        if len(result.files_not_in_repo) > 5:
            score += 15
        elif result.files_not_in_repo:
            score += 5

        # Pattern severity
        for pattern in result.suspicious_patterns:
            if pattern.severity == "critical":
                score += 20
            elif pattern.severity == "high":
                score += 12
            elif pattern.severity == "medium":
                score += 5

        # Native code without expectation
        if result.has_native_code:
            score += 10

        return min(100, score)

    def analyze_version_diff(
        self,
        current_version: str,
        current_data: dict,
        previous_version: str | None,
        previous_data: dict | None,
    ) -> VersionDiff:
        """Compare current and previous package versions.

        Args:
            current_version: Current version string
            current_data: Current version's package.json
            previous_version: Previous version string
            previous_data: Previous version's package.json

        Returns:
            VersionDiff with detected changes
        """
        result = VersionDiff(
            current_version=current_version,
            previous_version=previous_version,
        )

        if not previous_data or not previous_version:
            return result

        result.comparison_available = True

        # Analyze version jump
        result.is_major_bump, result.is_minor_bump, result.is_patch_bump = \
            self._analyze_version_jump(previous_version, current_version)

        # Check for suspicious version jumps (e.g., 1.0.0 -> 10.0.0)
        result.version_jump_suspicious = self._is_suspicious_version_jump(
            previous_version, current_version
        )
        if result.version_jump_suspicious:
            result.risk_factors.append("Suspicious version jump detected")

        # Compare scripts
        prev_scripts = set(previous_data.get("scripts", {}).keys())
        curr_scripts = set(current_data.get("scripts", {}).keys())

        new_scripts = curr_scripts - prev_scripts
        if new_scripts:
            result.scripts_changed = True
            result.scripts_added = list(new_scripts)

            # Check if new scripts are lifecycle scripts
            dangerous_added = new_scripts & DANGEROUS_LIFECYCLE_SCRIPTS
            if dangerous_added:
                result.risk_factors.append(
                    f"Dangerous lifecycle scripts added: {', '.join(dangerous_added)}"
                )

        # Compare dependencies
        prev_deps = set(previous_data.get("dependencies", {}).keys())
        curr_deps = set(current_data.get("dependencies", {}).keys())

        result.dependencies_added = list(curr_deps - prev_deps)
        result.dependencies_removed = list(prev_deps - curr_deps)

        # Calculate risk score
        result.risk_score = self._calculate_version_diff_risk_score(result)

        return result

    def _analyze_version_jump(
        self, prev: str, curr: str
    ) -> tuple[bool, bool, bool]:
        """Determine version bump type."""
        try:
            prev_parts = [int(x) for x in prev.split(".")[:3]]
            curr_parts = [int(x) for x in curr.split(".")[:3]]

            # Pad to 3 parts
            while len(prev_parts) < 3:
                prev_parts.append(0)
            while len(curr_parts) < 3:
                curr_parts.append(0)

            is_major = curr_parts[0] > prev_parts[0]
            is_minor = not is_major and curr_parts[1] > prev_parts[1]
            is_patch = not is_major and not is_minor and curr_parts[2] > prev_parts[2]

            return is_major, is_minor, is_patch
        except (ValueError, IndexError):
            return False, False, False

    def _is_suspicious_version_jump(self, prev: str, curr: str) -> bool:
        """Check if version jump is suspiciously large."""
        try:
            prev_parts = [int(x) for x in prev.split(".")[:3]]
            curr_parts = [int(x) for x in curr.split(".")[:3]]

            # Major version jump > 5 is suspicious
            if curr_parts[0] - prev_parts[0] > 5:
                return True

            # Going backwards is very suspicious
            if curr_parts[0] < prev_parts[0]:
                return True

            return False
        except (ValueError, IndexError):
            return False

    def _calculate_version_diff_risk_score(self, result: VersionDiff) -> int:
        """Calculate risk score for version diff."""
        score = 0

        if result.version_jump_suspicious:
            score += 30

        # New lifecycle scripts are high risk
        dangerous_added = set(result.scripts_added) & DANGEROUS_LIFECYCLE_SCRIPTS
        score += len(dangerous_added) * 25

        if result.scripts_changed:
            score += 10

        # Many new dependencies
        if len(result.dependencies_added) > 10:
            score += 15
        elif len(result.dependencies_added) > 5:
            score += 8

        return min(100, score)

    def analyze_publishing_info(
        self,
        package_data: dict,
        version_data: dict | None = None,
    ) -> PublishingInfo:
        """Analyze package publishing and maintainer information.

        Args:
            package_data: Full npm package data
            version_data: Specific version data (optional)

        Returns:
            PublishingInfo with findings
        """
        result = PublishingInfo()

        # Get maintainers
        maintainers = package_data.get("maintainers", [])
        result.maintainer_count = len(maintainers)
        result.maintainers = [m.get("name", "") for m in maintainers if isinstance(m, dict)]

        # Check for npm provenance
        if version_data:
            # npm provenance is in the signatures field
            if version_data.get("signatures"):
                result.has_provenance = True
                result.provenance_verified = True

            # Check publisher
            npm_user = version_data.get("_npmUser", {})
            if isinstance(npm_user, dict):
                result.publisher_username = npm_user.get("name")

                # Check if publisher is in maintainers list
                if result.publisher_username and result.maintainers:
                    result.publisher_is_listed_maintainer = \
                        result.publisher_username in result.maintainers

                    if not result.publisher_is_listed_maintainer:
                        result.risk_factors.append(
                            f"Publisher '{result.publisher_username}' not in maintainers list"
                        )

        # Calculate risk score
        result.risk_score = self._calculate_publishing_risk_score(result)

        return result

    def _calculate_publishing_risk_score(self, result: PublishingInfo) -> int:
        """Calculate risk score for publishing info."""
        score = 0

        # No provenance
        if not result.has_provenance:
            score += 10

        # Publisher not a maintainer
        if not result.publisher_is_listed_maintainer:
            score += 25

        # Single maintainer (bus factor)
        if result.maintainer_count == 1:
            score += 5
        elif result.maintainer_count == 0:
            score += 15

        # Recent maintainer changes
        if result.recent_maintainer_change:
            score += 15

        return min(100, score)

    async def analyze_package(
        self,
        package_json: dict,
        tarball_url: str | None = None,
        repo_files: set[str] | None = None,
        previous_version_data: dict | None = None,
        npm_package_data: dict | None = None,
    ) -> SupplyChainData:
        """Perform complete supply chain analysis on a package.

        Args:
            package_json: Current package.json content
            tarball_url: URL to download tarball (optional)
            repo_files: Set of files in repository (optional)
            previous_version_data: Previous version's package.json (optional)
            npm_package_data: Full npm registry data (optional)

        Returns:
            SupplyChainData with all analysis results
        """
        result = SupplyChainData()

        # 1. Analyze lifecycle scripts
        result.lifecycle_scripts = self.analyze_lifecycle_scripts(package_json)

        # 2. Analyze tarball if URL provided
        if tarball_url:
            result.tarball = await self.analyze_tarball(tarball_url, repo_files)

        # 3. Analyze version diff if previous version available
        current_version = package_json.get("version", "0.0.0")
        if previous_version_data:
            prev_version = previous_version_data.get("version")
            result.version_diff = self.analyze_version_diff(
                current_version,
                package_json,
                prev_version,
                previous_version_data,
            )

        # 4. Analyze publishing info
        if npm_package_data:
            version_data = npm_package_data.get("versions", {}).get(current_version)
            result.publishing = self.analyze_publishing_info(npm_package_data, version_data)

        # Aggregate all suspicious patterns
        result.all_suspicious_patterns = list(result.lifecycle_scripts.suspicious_patterns)
        if result.tarball:
            result.all_suspicious_patterns.extend(result.tarball.suspicious_patterns)

        # Identify critical findings
        for pattern in result.all_suspicious_patterns:
            if pattern.severity == "critical":
                result.critical_findings.append(
                    f"{pattern.description} in {pattern.location}"
                )

        # Set behavioral flags
        if result.lifecycle_scripts.installs_runtime:
            result.behavioral_flags.append("installs_alternative_runtime")
        if result.lifecycle_scripts.has_credential_access:
            result.behavioral_flags.append("accesses_credentials")
        if result.lifecycle_scripts.has_network_calls:
            result.behavioral_flags.append("makes_network_calls")
        if result.lifecycle_scripts.has_obfuscation:
            result.behavioral_flags.append("contains_obfuscation")

        # Calculate overall risk score
        scores = [result.lifecycle_scripts.risk_score]
        if result.tarball:
            scores.append(result.tarball.risk_score)
        if result.version_diff:
            scores.append(result.version_diff.risk_score)
        scores.append(result.publishing.risk_score)

        # Overall is max of component scores (any red flag is important)
        result.overall_risk_score = max(scores) if scores else 0

        # Add weight for multiple high scores
        high_scores = sum(1 for s in scores if s >= 50)
        if high_scores >= 2:
            result.overall_risk_score = min(100, result.overall_risk_score + 20)

        # Set risk level
        if result.overall_risk_score >= 75:
            result.risk_level = "critical"
        elif result.overall_risk_score >= 50:
            result.risk_level = "high"
        elif result.overall_risk_score >= 25:
            result.risk_level = "medium"
        else:
            result.risk_level = "low"

        return result
