export function About() {
  return (
    <div className="about-page">
      <h1>About pkg-risk Scoring</h1>

      <section className="about-section">
        <h2>Scoring Philosophy</h2>
        <p>
          pkg-risk evaluates open source packages across six dimensions of health and risk.
          Our scoring methodology combines automated analysis of GitHub repository data with
          AI-powered assessments to provide a comprehensive view of package health.
        </p>
        <p>
          The overall score (0-100) represents a weighted aggregate of these dimensions,
          translated into a letter grade (A-F) for quick assessment.
        </p>
      </section>

      <section className="about-section">
        <h2>Scoring Categories</h2>

        <div className="category-card">
          <h3>Security (30% weight)</h3>
          <p>The most heavily weighted category, evaluating vulnerability history and security practices.</p>
          <ul>
            <li><strong>CVE severity-weighted penalties:</strong> CRITICAL (-20), HIGH (-15), MEDIUM (-8), LOW (-3)</li>
            <li><strong>Time-to-patch responsiveness:</strong> Bonus for quick patching (&lt;7 days), penalty for slow response (&gt;90 days)</li>
            <li><strong>Security policy:</strong> Presence of SECURITY.md or security policy</li>
            <li><strong>Security tools:</strong> Dependabot, CodeQL, Snyk, Renovate, Trivy, Semgrep detection</li>
            <li><strong>Signed commits:</strong> Percentage of cryptographically signed commits</li>
            <li><strong>Supply chain:</strong> SLSA compliance, Sigstore signing, SBOM publication</li>
          </ul>
        </div>

        <div className="category-card">
          <h3>Maintenance (25% weight)</h3>
          <p>Evaluates ongoing development activity and responsiveness.</p>
          <ul>
            <li><strong>Commit recency:</strong> Exponential decay based on time since last commit</li>
            <li><strong>Activity presence:</strong> Rewards consistent activity over raw commit volume</li>
            <li><strong>Issue response time:</strong> How quickly maintainers respond to issues</li>
            <li><strong>Release cadence:</strong> Sweet spot of 4-12 releases/year</li>
            <li><strong>Deprecation signals:</strong> Detects deprecated or archived repositories</li>
          </ul>
        </div>

        <div className="category-card">
          <h3>Community (15% weight)</h3>
          <p>Measures community health and engagement.</p>
          <ul>
            <li><strong>Stars/Forks:</strong> Age-normalized popularity metrics</li>
            <li><strong>Contributor growth:</strong> Trajectory analysis (growing/stable/declining)</li>
            <li><strong>First-time contributors:</strong> Welcoming community signal</li>
            <li><strong>Community health:</strong> Issue templates, PR templates, Code of Conduct</li>
            <li><strong>Discussions:</strong> Active Q&A community</li>
          </ul>
        </div>

        <div className="category-card">
          <h3>Bus Factor (10% weight)</h3>
          <p>Assesses project sustainability and single-point-of-failure risk.</p>
          <ul>
            <li><strong>Shannon entropy:</strong> Mathematical measure of contribution distribution</li>
            <li><strong>Top contributor concentration:</strong> Penalty for &gt;90% single contributor</li>
            <li><strong>Active contributors:</strong> Number of recent contributors</li>
            <li><strong>Governance:</strong> CODEOWNERS, GOVERNANCE.md presence</li>
            <li><strong>Succession planning:</strong> AI assessment of maintainer structure</li>
          </ul>
        </div>

        <div className="category-card">
          <h3>Documentation (10% weight)</h3>
          <p>Evaluates documentation quality and completeness.</p>
          <ul>
            <li><strong>Presence signals (40%):</strong> README, docs directory, examples, changelog</li>
            <li><strong>Quality signals (60%):</strong> AI assessment of installation docs, quick start, API examples</li>
            <li><strong>Changelog quality:</strong> Breaking changes marked, migration guides</li>
          </ul>
        </div>

        <div className="category-card">
          <h3>Stability (10% weight)</h3>
          <p>Measures release stability and CI/CD maturity.</p>
          <ul>
            <li><strong>Version maturity:</strong> Bonus for stable (&gt;=1.0) releases</li>
            <li><strong>Pre-release ratio:</strong> Penalty for too many pre-releases</li>
            <li><strong>CI/CD depth:</strong> Tests, linting, security scanning, multi-platform testing</li>
            <li><strong>Regression issues:</strong> Penalty for known regressions</li>
          </ul>
        </div>
      </section>

      <section className="about-section">
        <h2>Enterprise Risk Indicators</h2>

        <h3>Risk Tiers</h3>
        <ul>
          <li><strong>Approved (Tier 1):</strong> Score &gt;=80, no unpatched CVEs, active maintenance</li>
          <li><strong>Conditional (Tier 2):</strong> Score 60-79, or minor concerns requiring review</li>
          <li><strong>Restricted (Tier 3):</strong> Score &lt;60, or critical issues requiring exception</li>
          <li><strong>Prohibited (Tier 4):</strong> Unpatched critical CVEs, abandoned, or known malicious</li>
        </ul>

        <h3>Update Urgency</h3>
        <ul>
          <li><strong>Critical:</strong> Unpatched CVE - update immediately</li>
          <li><strong>High:</strong> Patched CVE available - update soon</li>
          <li><strong>Medium:</strong> Maintenance concerns - plan update</li>
          <li><strong>Low:</strong> Current version acceptable - update opportunistically</li>
        </ul>

        <h3>Project Age Bands</h3>
        <p>Context for interpreting scores based on project maturity:</p>
        <ul>
          <li><strong>New:</strong> &lt;1 year - expectations adjusted for early-stage projects</li>
          <li><strong>Established:</strong> 1-3 years - standard expectations</li>
          <li><strong>Mature:</strong> 3-7 years - higher expectations across categories</li>
          <li><strong>Legacy:</strong> 7+ years - focus on maintenance and security</li>
        </ul>
      </section>

      <section className="about-section">
        <h2>What We Intentionally Don't Score</h2>
        <p>
          Some metrics were deliberately excluded from our scoring methodology due to
          reliability concerns, gaming potential, or lack of consistent meaning across ecosystems:
        </p>
        <ul>
          <li><strong>Code coverage percentage:</strong> Not reliably available across ecosystems</li>
          <li><strong>Test count/quality:</strong> Presence is scored, not depth (unreliable metrics)</li>
          <li><strong>Language-specific linting scores:</strong> Too ecosystem-specific</li>
          <li><strong>Dependency count:</strong> High count isn't inherently bad (utility packages)</li>
          <li><strong>Download velocity/trends:</strong> Popularity does not equal quality</li>
          <li><strong>GitHub star manipulation:</strong> Stars can be gamed</li>
          <li><strong>Contributor company affiliations:</strong> Privacy concerns, not reliable indicator</li>
          <li><strong>Code complexity metrics:</strong> Highly subjective, ecosystem-dependent</li>
          <li><strong>Performance benchmarks:</strong> Out of scope, not health-related</li>
          <li><strong>Package size:</strong> Context-dependent, not a quality signal</li>
        </ul>
      </section>

      <section className="about-section">
        <h2>Limitations & Caveats</h2>
        <ul>
          <li><strong>GitHub-only:</strong> Full analysis requires GitHub hosting (GitLab, Bitbucket have limited support)</li>
          <li><strong>AI variability:</strong> LLM assessments may vary slightly between runs</li>
          <li><strong>New package bias:</strong> Very new packages may score lower due to limited history</li>
          <li><strong>Point-in-time:</strong> Scores are snapshots and may not reflect recent changes</li>
          <li><strong>Private repos:</strong> Cannot analyze private or internal packages</li>
        </ul>
      </section>

      <section className="about-section">
        <h2>Score Confidence</h2>
        <p>
          Each score includes a confidence indicator (high/medium/low) based on data completeness:
        </p>
        <ul>
          <li><strong>High confidence:</strong> Full GitHub data and AI assessment available</li>
          <li><strong>Medium confidence:</strong> Some data sources missing (e.g., no AI assessment)</li>
          <li><strong>Low confidence:</strong> Limited data (very new package, minimal history, no GitHub data)</li>
        </ul>
      </section>

      <section className="about-section">
        <h2>Grade Thresholds</h2>
        <table className="grade-table">
          <thead>
            <tr>
              <th>Grade</th>
              <th>Score Range</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="grade grade-a">A</span></td>
              <td>90-100</td>
              <td>Excellent health across all dimensions</td>
            </tr>
            <tr>
              <td><span className="grade grade-b">B</span></td>
              <td>80-89</td>
              <td>Good health with minor areas for improvement</td>
            </tr>
            <tr>
              <td><span className="grade grade-c">C</span></td>
              <td>70-79</td>
              <td>Acceptable but with notable concerns</td>
            </tr>
            <tr>
              <td><span className="grade grade-d">D</span></td>
              <td>60-69</td>
              <td>Significant concerns, use with caution</td>
            </tr>
            <tr>
              <td><span className="grade grade-f">F</span></td>
              <td>&lt;60</td>
              <td>Major issues, recommend alternatives</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default About;
