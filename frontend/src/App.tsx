import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { PackageList } from './pages/PackageList';
import { PackageDetail } from './pages/PackageDetail';
import { UploadDashboard } from './pages/UploadDashboard';
import { About } from './pages/About';
import { Methodology } from './pages/Methodology';
import type { PackageSummary, PackageAnalysis, EcosystemStats } from './types/package';
import './App.css';

type Ecosystem = 'homebrew' | 'npm' | 'pypi';

const ECOSYSTEM_LABELS: Record<Ecosystem, string> = {
  homebrew: 'Homebrew',
  npm: 'NPM',
  pypi: 'PyPI',
};

function App() {
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [packageDetails, setPackageDetails] = useState<Map<string, PackageAnalysis>>(new Map());
  const [ecosystemStats, setEcosystemStats] = useState<EcosystemStats | null>(null);
  const [allEcosystemData, setAllEcosystemData] = useState<Record<string, PackageSummary[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ecosystem, setEcosystem] = useState<Ecosystem>('homebrew');

  // Load all ecosystem data for the upload feature
  useEffect(() => {
    async function loadAllEcosystems() {
      const ecosystems: Ecosystem[] = ['homebrew', 'npm', 'pypi'];
      const data: Record<string, PackageSummary[]> = {};

      for (const eco of ecosystems) {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}data/${eco}.json`);
          if (res.ok) {
            data[eco] = await res.json();
          }
        } catch {
          // Skip failed ecosystems
        }
      }

      setAllEcosystemData(data);
    }
    loadAllEcosystems();
  }, []);

  useEffect(() => {
    // Reset state when switching ecosystems
    setLoading(true);
    setError(null);
    setPackages([]);
    setPackageDetails(new Map());
    setEcosystemStats(null);

    async function loadData() {
      try {
        // Load summary data only - details are loaded on-demand in PackageDetail
        const summaryRes = await fetch(`${import.meta.env.BASE_URL}data/${ecosystem}.json`);
        if (!summaryRes.ok) {
          throw new Error(`Failed to load package data: ${summaryRes.status}`);
        }
        const summaryData: PackageSummary[] = await summaryRes.json();
        setPackages(summaryData);

        // Load ecosystem stats
        try {
          const statsRes = await fetch(`${import.meta.env.BASE_URL}data/${ecosystem}_stats.json`);
          if (statsRes.ok) {
            const statsData: EcosystemStats = await statsRes.json();
            setEcosystemStats(statsData);
          }
        } catch {
          // Stats are optional
        }

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setLoading(false);
      }
    }
    loadData();
  }, [ecosystem]);

  // Cache a loaded package detail (called from PackageDetail component)
  const cacheDetail = (key: string, detail: PackageAnalysis) => {
    setPackageDetails(prev => new Map(prev).set(key, detail));
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-icon">📦</div>
          <h2>Loading {ECOSYSTEM_LABELS[ecosystem]} packages...</h2>
          <div className="loading-bar">
            <div className="loading-bar-fill"></div>
          </div>
          <p className="loading-hint">Fetching package health data</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error">
        <h2>Error</h2>
        <p>{error}</p>
        <p>Make sure package data exists in public/data/</p>
      </div>
    );
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div className="app">
        <nav className="navbar">
          <Link to="/" className="nav-brand">
            <span className="brand-icon">📦</span>
            <span className="brand-text">pkg-risk</span>
          </Link>
          <div className="nav-links">
            <select
              value={ecosystem}
              onChange={(e) => setEcosystem(e.target.value as Ecosystem)}
              className="ecosystem-selector"
            >
              <option value="homebrew">{ECOSYSTEM_LABELS.homebrew}</option>
              <option value="npm">{ECOSYSTEM_LABELS.npm}</option>
              <option value="pypi">{ECOSYSTEM_LABELS.pypi}</option>
            </select>
            <span className="stat">{packages.length} packages</span>
            <Link to="/upload" className="nav-link upload-link">Analyze</Link>
            <Link to="/methodology" className="nav-link">Methodology</Link>
            <Link to="/about" className="nav-link">About</Link>
          </div>
        </nav>

        <main className="main-content">
          <Routes>
            <Route
              path="/"
              element={<PackageList packages={packages} ecosystem={ecosystem} stats={ecosystemStats} />}
            />
            <Route
              path="/upload"
              element={<UploadDashboard ecosystemData={allEcosystemData} />}
            />
            <Route
              path="/:ecosystem/:name"
              element={<PackageDetail packages={packageDetails} cacheDetail={cacheDetail} />}
            />
            <Route
              path="/about"
              element={<About />}
            />
            <Route
              path="/methodology"
              element={<Methodology />}
            />
          </Routes>
        </main>

        <footer className="app-footer">
          <p>Package health scores for open source dependencies</p>
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;
