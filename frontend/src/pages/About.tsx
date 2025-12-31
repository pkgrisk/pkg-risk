import { Link } from 'react-router-dom';

export function About() {
  return (
    <div className="about-page">
      <h1>About pkg-risk</h1>

      <section className="about-section">
        <h2>The Problem</h2>
        <p>
          Modern software depends on hundreds of open source packages. But how do you know
          which ones are safe to use? Vulnerability databases tell you about known CVEs,
          but not whether a project is likely to <em>fix</em> them quickly. Package registries
          show download counts, but popularity doesn't equal quality. And raw repository
          data requires you to interpret dozens of signals yourself.
        </p>
        <p>
          Most tools either give you a firehose of unweighted data, or focus narrowly on
          just security practices. Neither approach answers the real question: <strong>is
          this package healthy enough to depend on?</strong>
        </p>
      </section>

      <section className="about-section">
        <h2>What pkg-risk Does</h2>
        <p>
          pkg-risk provides an opinionated, weighted health score (0-100) for open source
          packages across npm, PyPI, and Homebrew. Instead of just surfacing raw data,
          it applies explicit weights that reflect real-world priorities: security issues
          matter more than documentation gaps, and a single maintainer is a bigger risk
          than low star counts.
        </p>
        <p>
          The scoring combines quantitative metrics from GitHub and vulnerability databases
          with AI-powered qualitative assessments of documentation quality, governance
          maturity, and succession planning—factors that are hard to measure but critical
          for long-term reliability.
        </p>
      </section>

      <section className="about-section">
        <h2>Why Use pkg-risk?</h2>
        <ul>
          <li><strong>Holistic assessment:</strong> Evaluates six dimensions—Security, Maintenance, Community, Bus Factor, Documentation, and Stability—not just vulnerabilities</li>
          <li><strong>Weighted scoring:</strong> Security (30%) and Maintenance (25%) are weighted higher than Community (15%) because they matter more for production use</li>
          <li><strong>AI-powered insights:</strong> LLM assessments evaluate documentation quality and governance—things automated tools typically miss</li>
          <li><strong>Enterprise-ready framing:</strong> Risk tiers (Approved/Conditional/Restricted/Prohibited) and update urgency levels map to real approval workflows</li>
          <li><strong>Bus factor analysis:</strong> Shannon entropy calculations identify single-maintainer risk before it becomes your problem</li>
          <li><strong>Transparent methodology:</strong> Every weight and calculation is documented and the entire project is open source</li>
        </ul>
        <p>
          For detailed information about how scores are calculated, see
          the <Link to="/methodology">Methodology</Link> page.
        </p>
      </section>

      <section className="about-section disclaimer-section">
        <h2>Important Disclaimers</h2>

        <div className="disclaimer-card">
          <h3>Not a Definitive Assessment</h3>
          <p>
            pkg-risk scores are heuristic in nature and are <strong>not intended to be a
            one-size-fits-all solution</strong>. Every aspect of the scoring is opinionated:
            which checks are included, their relative importance, and how scores are calculated.
            A low score is not a definitive indication that a package is unsafe, and a high
            score does not guarantee security.
          </p>
        </div>

        <div className="disclaimer-card">
          <h3>False Positives and Negatives</h3>
          <p>
            Like all automated security and health assessment tools, pkg-risk has inherent
            limitations. There will be <strong>false positives</strong> (packages flagged as
            risky that are actually fine) and <strong>false negatives</strong> (packages that
            appear healthy but have undiscovered issues). Scores should be one input among
            many in your decision-making process.
          </p>
        </div>

        <div className="disclaimer-card">
          <h3>Data Sources</h3>
          <p>
            pkg-risk aggregates data from GitHub, package registries, and vulnerability
            databases. This project <strong>uses these APIs but is not endorsed or certified
            by</strong> GitHub, npm, PyPI, Homebrew, OSV, or any other data source.
            Data accuracy depends on what is publicly available and may not reflect the
            most recent changes.
          </p>
        </div>

        <div className="disclaimer-card">
          <h3>Not Legal or Security Advice</h3>
          <p>
            Information provided by pkg-risk is <strong>not intended to be legal, security,
            or compliance advice</strong>. You should independently verify any information
            and conduct your own security reviews for your specific needs. This tool does
            not replace professional security audits or legal counsel.
          </p>
        </div>

        <div className="disclaimer-card">
          <h3>Point-in-Time Snapshots</h3>
          <p>
            Scores represent a <strong>snapshot at the time of analysis</strong> and may not
            reflect recent changes to packages. Packages can be updated, vulnerabilities can
            be discovered or patched, and maintainer situations can change at any time.
          </p>
        </div>

        <div className="disclaimer-card">
          <h3>AI-Generated Assessments</h3>
          <p>
            Some qualitative assessments are generated using AI/LLM models. These assessments
            <strong> may vary between analysis runs</strong> and should be treated as
            supplementary signals rather than definitive evaluations.
          </p>
        </div>
      </section>

      <section className="about-section">
        <h2>Limitations</h2>
        <ul>
          <li><strong>GitHub-centric:</strong> Full analysis requires GitHub hosting. Packages hosted on GitLab, Bitbucket, or other platforms have limited scoring capability.</li>
          <li><strong>Known vulnerabilities only:</strong> Security scoring is based on publicly disclosed vulnerabilities. Zero-day or undisclosed issues cannot be detected.</li>
          <li><strong>Public repositories only:</strong> Private or internal packages cannot be analyzed.</li>
          <li><strong>New package bias:</strong> Very new packages may score lower due to limited history, which is not necessarily indicative of quality.</li>
          <li><strong>Ecosystem variations:</strong> Different package ecosystems have varying levels of metadata available, which may affect score completeness.</li>
        </ul>
      </section>

      <section className="about-section">
        <h2>Use Responsibly</h2>
        <p>
          pkg-risk is provided "as is" without warranty of any kind. Use it as one tool
          among many when evaluating open source dependencies. We encourage you to:
        </p>
        <ul>
          <li>Review the <Link to="/methodology">scoring methodology</Link> to understand what factors into each score</li>
          <li>Look at individual category scores, not just the aggregate</li>
          <li>Consider your specific use case and risk tolerance</li>
          <li>Conduct additional due diligence for critical dependencies</li>
        </ul>
      </section>

      <section className="about-section">
        <h2>Open Source</h2>
        <p>
          pkg-risk is fully open source under the MIT license. The scoring methodology,
          data collection pipelines, and this dashboard are all available for inspection,
          contribution, and self-hosting.
        </p>
        <p>
          Found a bug? Have a suggestion for improving the scoring? Want to add support
          for another package ecosystem? Contributions are welcome.
        </p>
        <p>
          <a
            href="https://github.com/pkgrisk/pkg-risk"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
          >
            View on GitHub
          </a>
        </p>
      </section>
    </div>
  );
}

export default About;
