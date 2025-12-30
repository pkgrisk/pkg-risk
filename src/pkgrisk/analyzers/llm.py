"""LLM-based analysis using Ollama."""

import json
import re
from typing import Any

import httpx

from pkgrisk.models.schemas import (
    ChangelogAssessment,
    CommunicationAssessment,
    GovernanceAssessment,
    MaintenanceAssessment,
    ReadmeAssessment,
    SecurityAssessment,
    SentimentAssessment,
)


class LLMAnalyzer:
    """Runs LLM-based analysis using Ollama.

    Uses local LLM models to assess qualitative aspects of packages
    that can't be captured by simple metrics.
    """

    OLLAMA_URL = "http://localhost:11434"

    def __init__(
        self,
        model: str = "llama3.1:70b",
        fast_model: str = "llama3.1:8b",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        """Initialize the analyzer.

        Args:
            model: Primary model for complex analysis.
            fast_model: Faster model for simpler tasks.
            client: Optional httpx client.
        """
        self.model = model
        self.fast_model = fast_model
        self._client = client

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create an HTTP client."""
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=300.0)  # LLM can be slow

    async def _generate(
        self,
        prompt: str,
        model: str | None = None,
        system: str | None = None,
    ) -> str:
        """Generate a response from the LLM.

        Args:
            prompt: The prompt to send.
            model: Model to use (defaults to self.model).
            system: Optional system prompt.

        Returns:
            The generated text response.
        """
        model = model or self.model
        client = await self._get_client()

        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.1,  # Low temperature for consistent scoring
            },
        }
        if system:
            payload["system"] = system

        try:
            response = await client.post(
                f"{self.OLLAMA_URL}/api/generate",
                json=payload,
            )
            response.raise_for_status()
            return response.json().get("response", "")
        finally:
            if self._client is None:
                await client.aclose()

    def _extract_json(self, text: str) -> dict:
        """Extract JSON from LLM response text.

        Args:
            text: Response text that may contain JSON.

        Returns:
            Parsed JSON dict.

        Raises:
            ValueError: If no valid JSON found.
        """
        # Try to find JSON block
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if json_match:
            text = json_match.group(1)

        # Try to find bare JSON object
        obj_match = re.search(r"\{.*\}", text, re.DOTALL)
        if obj_match:
            text = obj_match.group(0)

        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise ValueError(f"Could not extract JSON from response: {e}") from e

    async def assess_readme(
        self,
        readme_content: str,
        package_name: str,
        ecosystem: str,
    ) -> ReadmeAssessment:
        """Assess README quality.

        Args:
            readme_content: The README file content.
            package_name: Name of the package.
            ecosystem: Package ecosystem (homebrew, npm, etc.).

        Returns:
            ReadmeAssessment with scores and summary.
        """
        prompt = f"""Analyze this README for a software package. Score each dimension 1-10:

1. CLARITY: Can a new user understand what this package does within 30 seconds?
2. INSTALLATION: Are installation instructions clear and complete?
3. QUICK_START: Is there a quick example showing basic usage?
4. EXAMPLES: Are there enough examples for common use cases?
5. CONFIGURATION: If configurable, is configuration documented?
6. TROUBLESHOOTING: Are common problems and solutions documented?

Package ecosystem: {ecosystem}
Package name: {package_name}
README content:
{readme_content[:8000]}

Respond in JSON only:
{{
  "clarity": <1-10>,
  "installation": <1-10>,
  "quick_start": <1-10>,
  "examples": <1-10>,
  "configuration": <1-10>,
  "troubleshooting": <1-10>,
  "overall": <1-10>,
  "summary": "<one sentence summary of doc quality>",
  "top_issue": "<biggest documentation problem, or null if none>"
}}"""

        response = await self._generate(prompt)
        data = self._extract_json(response)

        return ReadmeAssessment(
            clarity=data.get("clarity", 5),
            installation=data.get("installation", 5),
            quick_start=data.get("quick_start", 5),
            examples=data.get("examples", 5),
            configuration=data.get("configuration", 5),
            troubleshooting=data.get("troubleshooting", 5),
            overall=data.get("overall", 5),
            summary=data.get("summary", ""),
            top_issue=data.get("top_issue"),
        )

    async def assess_security(
        self,
        code_samples: str,
        package_name: str,
        ecosystem: str,
    ) -> SecurityAssessment:
        """Assess code for security concerns.

        Args:
            code_samples: Code files to analyze.
            package_name: Name of the package.
            ecosystem: Package ecosystem.

        Returns:
            SecurityAssessment with findings.
        """
        prompt = f"""Analyze this code sample for security concerns. This is from the {ecosystem} package "{package_name}".

Focus on:
1. INJECTION_RISKS: eval(), exec(), shell commands with user input, SQL string concatenation, template injection
2. INPUT_VALIDATION: Are external inputs validated/sanitized before use?
3. SECRETS_HANDLING: Hardcoded credentials, API keys, tokens, passwords?
4. ERROR_EXPOSURE: Do error handlers expose stack traces, file paths, or internal details?
5. DANGEROUS_DEFAULTS: Insecure default configurations (e.g., disabled SSL verification)?

Code files:
{code_samples[:10000]}

Respond in JSON only:
{{
  "injection_risks": [{{"file": "...", "line": <n>, "severity": "high|medium|low", "description": "..."}}],
  "input_validation_score": <1-10>,
  "input_validation_issues": ["..."],
  "secrets_found": [{{"file": "...", "line": <n>, "type": "..."}}],
  "error_exposure_score": <1-10>,
  "dangerous_defaults": ["..."],
  "overall_security_score": <1-10>,
  "critical_findings": ["..."],
  "summary": "<one sentence security assessment>"
}}"""

        response = await self._generate(prompt)
        data = self._extract_json(response)

        return SecurityAssessment(
            overall_score=data.get("overall_security_score", 5),
            injection_risks=data.get("injection_risks", []),
            input_validation_score=data.get("input_validation_score", 5),
            secrets_found=data.get("secrets_found", []),
            critical_findings=data.get("critical_findings", []),
            summary=data.get("summary", ""),
        )

    async def assess_sentiment(
        self,
        issues: list[dict],
        package_name: str,
        ecosystem: str,
    ) -> SentimentAssessment:
        """Assess sentiment from GitHub issues.

        Args:
            issues: List of issue dicts with title, body, comments, etc.
            package_name: Name of the package.
            ecosystem: Package ecosystem.

        Returns:
            SentimentAssessment with community health indicators.
        """
        issues_json = json.dumps(issues[:20], indent=2)

        prompt = f"""Analyze these recent GitHub issues for a software project. Assess overall community health.

Package: {package_name} ({ecosystem})
Issues:
{issues_json[:8000]}

Respond in JSON only:
{{
  "sentiment": "<positive|neutral|negative|mixed>",
  "frustration_level": <1-10>,
  "maintainer_responsiveness": "<active|moderate|slow|unresponsive>",
  "common_complaints": ["<issue1>", "<issue2>"],
  "praise_themes": ["<theme1>", "<theme2>"],
  "abandonment_signals": <true|false>,
  "summary": "<one sentence community health summary>"
}}"""

        # Use fast model for sentiment analysis
        response = await self._generate(prompt, model=self.fast_model)
        data = self._extract_json(response)

        return SentimentAssessment(
            sentiment=data.get("sentiment", "neutral"),
            frustration_level=data.get("frustration_level", 5),
            maintainer_responsiveness=data.get("maintainer_responsiveness", "moderate"),
            common_complaints=data.get("common_complaints", []),
            praise_themes=data.get("praise_themes", []),
            abandonment_signals=data.get("abandonment_signals", False),
            summary=data.get("summary", ""),
        )

    async def assess_communication(
        self,
        comments: list[str],
        package_name: str,
        ecosystem: str,
    ) -> CommunicationAssessment:
        """Assess maintainer communication quality.

        Args:
            comments: List of maintainer comments from issues/PRs.
            package_name: Name of the package.
            ecosystem: Package ecosystem.

        Returns:
            CommunicationAssessment with quality indicators.
        """
        comments_text = "\n---\n".join(comments[:30])

        prompt = f"""Analyze these maintainer responses in GitHub issues and pull requests.

Package: {package_name} ({ecosystem})
Maintainer comments:
{comments_text[:8000]}

Assess:
1. HELPFULNESS: Do responses actually help resolve issues?
2. CLARITY: Are explanations clear to users of varying skill levels?
3. PATIENCE: How are repeated or basic questions handled?
4. TECHNICAL_DEPTH: Do they explain the "why" behind decisions?
5. WELCOMINGNESS: Are new contributors encouraged?

Respond in JSON only:
{{
  "helpfulness": <1-10>,
  "clarity": <1-10>,
  "patience": <1-10>,
  "technical_depth": <1-10>,
  "welcomingness": <1-10>,
  "communication_style": "<exemplary|good|adequate|poor|hostile>",
  "red_flags": ["..."],
  "summary": "<one sentence assessment>"
}}"""

        response = await self._generate(prompt, model=self.fast_model)
        data = self._extract_json(response)

        return CommunicationAssessment(
            helpfulness=data.get("helpfulness", 5),
            clarity=data.get("clarity", 5),
            patience=data.get("patience", 5),
            technical_depth=data.get("technical_depth", 5),
            welcomingness=data.get("welcomingness", 5),
            communication_style=data.get("communication_style", "adequate"),
            red_flags=data.get("red_flags", []),
            summary=data.get("summary", ""),
        )

    async def assess_maintenance(
        self,
        last_commit_date: str,
        commit_count: int,
        open_issues: int,
        closed_issues: int,
        open_prs: int,
        merged_prs: int,
        last_release_date: str | None,
        active_contributors: int,
        package_name: str,
        ecosystem: str,
    ) -> MaintenanceAssessment:
        """Assess maintenance status from activity data.

        Returns:
            MaintenanceAssessment with status classification.
        """
        prompt = f"""Based on this GitHub activity data, assess the maintenance status:

Package: {package_name} ({ecosystem})
Last commit: {last_commit_date}
Commits past 6 months: {commit_count}
Open issues: {open_issues}
Closed issues past 6 months: {closed_issues}
Open PRs: {open_prs}
Merged PRs past 6 months: {merged_prs}
Last release: {last_release_date or "unknown"}
Contributors active past 6 months: {active_contributors}

Respond in JSON only:
{{
  "status": "<actively-maintained|maintained|minimal-maintenance|stale|abandoned>",
  "confidence": <1-10>,
  "concerns": ["<concern1>", "<concern2>"],
  "positive_signals": ["<signal1>", "<signal2>"],
  "summary": "<one sentence maintenance assessment>"
}}"""

        response = await self._generate(prompt, model=self.fast_model)
        data = self._extract_json(response)

        return MaintenanceAssessment(
            status=data.get("status", "maintained"),
            confidence=data.get("confidence", 5),
            concerns=data.get("concerns", []),
            positive_signals=data.get("positive_signals", []),
            summary=data.get("summary", ""),
        )

    async def assess_changelog(
        self,
        changelog_content: str,
        package_name: str,
        ecosystem: str,
    ) -> ChangelogAssessment:
        """Assess changelog quality.

        Args:
            changelog_content: The CHANGELOG file content.
            package_name: Name of the package.
            ecosystem: Package ecosystem.

        Returns:
            ChangelogAssessment with quality indicators.
        """
        prompt = f"""Analyze this changelog for the {ecosystem} package "{package_name}".

Assess:
1. BREAKING_CHANGES: Are breaking changes clearly marked?
2. MIGRATION_GUIDES: Are upgrade paths explained?
3. CATEGORIZATION: Are changes grouped (features, fixes, etc.)?
4. COMPLETENESS: Does it appear comprehensive?
5. CLARITY: Is it understandable to users?

CHANGELOG content (most recent entries):
{changelog_content[:6000]}

Respond in JSON only:
{{
  "breaking_changes_marked": <true|false>,
  "has_migration_guides": <true|false>,
  "well_categorized": <true|false>,
  "appears_complete": <true|false>,
  "clarity_score": <1-10>,
  "overall_score": <1-10>,
  "summary": "<one sentence assessment>"
}}"""

        response = await self._generate(prompt, model=self.fast_model)
        data = self._extract_json(response)

        return ChangelogAssessment(
            breaking_changes_marked=data.get("breaking_changes_marked", False),
            has_migration_guides=data.get("has_migration_guides", False),
            well_categorized=data.get("well_categorized", False),
            appears_complete=data.get("appears_complete", False),
            clarity_score=data.get("clarity_score", 5),
            overall_score=data.get("overall_score", 5),
            summary=data.get("summary", ""),
        )

    async def assess_governance(
        self,
        governance_docs: str,
        package_name: str,
        ecosystem: str,
    ) -> GovernanceAssessment:
        """Assess project governance documentation.

        Args:
            governance_docs: Combined content from GOVERNANCE.md, CONTRIBUTING.md, etc.
            package_name: Name of the package.
            ecosystem: Package ecosystem.

        Returns:
            GovernanceAssessment with governance indicators.
        """
        prompt = f"""Analyze the governance documentation for the {ecosystem} package "{package_name}".

Documents provided:
{governance_docs[:6000]}

Assess:
1. SUCCESSION: Is there a plan if primary maintainer leaves?
2. DECISION_MAKING: Is the decision process documented?
3. CONTRIBUTOR_PATH: Is there a path from contributor to maintainer?
4. MULTIPLE_MAINTAINERS: Does it indicate multiple people with merge rights?

Respond in JSON only:
{{
  "has_succession_plan": <true|false>,
  "decision_process_documented": <true|false>,
  "contributor_ladder_exists": <true|false>,
  "indicates_multiple_maintainers": <true|false>,
  "bus_factor_risk": "<low|medium|high>",
  "summary": "<one sentence assessment>"
}}"""

        response = await self._generate(prompt, model=self.fast_model)
        data = self._extract_json(response)

        return GovernanceAssessment(
            has_succession_plan=data.get("has_succession_plan", False),
            decision_process_documented=data.get("decision_process_documented", False),
            contributor_ladder_exists=data.get("contributor_ladder_exists", False),
            indicates_multiple_maintainers=data.get("indicates_multiple_maintainers", False),
            bus_factor_risk=data.get("bus_factor_risk", "unknown"),
            summary=data.get("summary", ""),
        )

    async def is_available(self) -> bool:
        """Check if Ollama is running and the model is available."""
        client = await self._get_client()
        try:
            response = await client.get(f"{self.OLLAMA_URL}/api/tags")
            if response.status_code != 200:
                return False
            models = response.json().get("models", [])
            model_names = [m.get("name", "") for m in models]
            # Check if either our primary or fast model is available
            return any(
                self.model in name or self.fast_model in name for name in model_names
            )
        except Exception:
            return False
        finally:
            if self._client is None:
                await client.aclose()
