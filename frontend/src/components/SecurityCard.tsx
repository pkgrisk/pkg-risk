import { CVEList } from './CVEList';
import type { Security, CVEHistory } from '../types/package';

interface SecurityCardProps {
  security: Security;
}

export function SecurityCard({ security }: SecurityCardProps) {
  const hasCVEs = security.cve_history && security.cve_history.total_cves > 0;

  return (
    <section className="card security-combined-card">
      <h2>Security</h2>

      <div className="security-grid">
        {/* Vulnerabilities Section */}
        <div className="security-section vulnerabilities-section">
          <h3>Vulnerabilities</h3>
          {hasCVEs ? (
            <CVEList cveHistory={security.cve_history as CVEHistory} />
          ) : (
            <div className="no-cves">
              <span className="no-cves-icon">✓</span>
              <span>No known CVEs</span>
            </div>
          )}
        </div>

        {/* Practices Section */}
        <div className="security-section practices-section">
          <h3>Security Practices</h3>
          <div className="security-checklist">
            <div className={`checklist-item ${security.has_security_md ? 'positive' : 'negative'}`}>
              <span className="check-icon">{security.has_security_md ? '✓' : '✗'}</span>
              <span>SECURITY.md</span>
            </div>
            <div className={`checklist-item ${security.has_security_policy ? 'positive' : 'negative'}`}>
              <span className="check-icon">{security.has_security_policy ? '✓' : '✗'}</span>
              <span>Security Policy</span>
            </div>
            <div className={`checklist-item ${security.has_dependabot ? 'positive' : 'negative'}`}>
              <span className="check-icon">{security.has_dependabot ? '✓' : '✗'}</span>
              <span>Dependabot</span>
            </div>
            <div className={`checklist-item ${security.has_codeql ? 'positive' : 'negative'}`}>
              <span className="check-icon">{security.has_codeql ? '✓' : '✗'}</span>
              <span>CodeQL Analysis</span>
            </div>
            <div className={`checklist-item ${security.has_security_ci ? 'positive' : 'negative'}`}>
              <span className="check-icon">{security.has_security_ci ? '✓' : '✗'}</span>
              <span>Security CI</span>
            </div>
          </div>

          {security.signed_commits_pct > 0 && (
            <div className="signed-commits">
              <span className="signed-label">Signed Commits:</span>
              <span className="signed-value">{security.signed_commits_pct.toFixed(0)}%</span>
            </div>
          )}

          {security.vulnerable_deps > 0 && (
            <div className="vulnerable-deps warning">
              <span>⚠️ {security.vulnerable_deps} vulnerable dependencies detected</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default SecurityCard;
