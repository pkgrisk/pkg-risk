import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { PackageList } from './pages/PackageList';
import { PackageDetail } from './pages/PackageDetail';
import { About } from './pages/About';
import type { PackageSummary, PackageAnalysis } from './types/package';
import './App.css';

function App() {
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [packageDetails, setPackageDetails] = useState<Map<string, PackageAnalysis>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ecosystem] = useState('homebrew'); // Default ecosystem

  useEffect(() => {
    async function loadData() {
      try {
        // Load summary data
        const summaryRes = await fetch(`${import.meta.env.BASE_URL}data/${ecosystem}.json`);
        if (!summaryRes.ok) {
          throw new Error(`Failed to load package data: ${summaryRes.status}`);
        }
        const summaryData: PackageSummary[] = await summaryRes.json();
        setPackages(summaryData);

        // Load individual package details (for detail view)
        const detailsMap = new Map<string, PackageAnalysis>();
        for (const pkg of summaryData) {
          try {
            const detailRes = await fetch(
              `${import.meta.env.BASE_URL}data/analyzed/${ecosystem}/${pkg.name}.json`
            );
            if (detailRes.ok) {
              const detail: PackageAnalysis = await detailRes.json();
              detailsMap.set(`${ecosystem}/${pkg.name}`, detail);
            }
          } catch {
            // Individual package load failure is ok
          }
        }
        setPackageDetails(detailsMap);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setLoading(false);
      }
    }
    loadData();
  }, [ecosystem]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading package data...</p>
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
            <span className="stat">{packages.length} packages</span>
            <Link to="/about" className="nav-link">About</Link>
          </div>
        </nav>

        <main className="main-content">
          <Routes>
            <Route
              path="/"
              element={<PackageList packages={packages} ecosystem={ecosystem} />}
            />
            <Route
              path="/:ecosystem/:name"
              element={<PackageDetail packages={packageDetails} />}
            />
            <Route
              path="/about"
              element={<About />}
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
