import { useCallback, useEffect, useState } from 'react';
import type { ProjectAnalysis } from '../types/package';

const STORAGE_KEY = 'pkgrisk-current-analysis';
const EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredAnalysis {
  analysis: ProjectAnalysis;
  expiresAt: number;
}

interface StoredAnalyses {
  [id: string]: StoredAnalysis;
}

export interface UseAnalysisStorageReturn {
  saveAnalysis: (analysis: ProjectAnalysis) => void;
  getAnalysis: (id: string) => ProjectAnalysis | null;
  getPackageFromAnalysis: (analysisId: string, packageName: string) => ProjectAnalysis['dependencies'][0] | null;
  deleteAnalysis: (id: string) => void;
  clearExpired: () => void;
}

function loadFromStorage(): StoredAnalyses {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as StoredAnalyses;
    }
  } catch (e) {
    console.warn('Failed to load analysis from storage:', e);
  }
  return {};
}

function saveToStorage(analyses: StoredAnalyses): void {
  try {
    if (Object.keys(analyses).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(analyses));
    }
  } catch (e) {
    console.warn('Failed to save analysis to storage:', e);
  }
}

function cleanExpired(analyses: StoredAnalyses): StoredAnalyses {
  const now = Date.now();
  const cleaned: StoredAnalyses = {};

  for (const [id, stored] of Object.entries(analyses)) {
    if (stored.expiresAt > now) {
      cleaned[id] = stored;
    }
  }

  return cleaned;
}

export function useAnalysisStorage(): UseAnalysisStorageReturn {
  const [analyses, setAnalyses] = useState<StoredAnalyses>({});

  // Load and clean expired on mount
  useEffect(() => {
    const loaded = loadFromStorage();
    const cleaned = cleanExpired(loaded);

    // Save cleaned data back if we removed any expired entries
    if (Object.keys(cleaned).length !== Object.keys(loaded).length) {
      saveToStorage(cleaned);
    }

    setAnalyses(cleaned);
  }, []);

  const saveAnalysis = useCallback((analysis: ProjectAnalysis) => {
    setAnalyses((prev) => {
      const updated = {
        ...prev,
        [analysis.id]: {
          analysis,
          expiresAt: Date.now() + EXPIRATION_MS,
        },
      };
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const getAnalysis = useCallback((id: string): ProjectAnalysis | null => {
    const stored = analyses[id];
    if (!stored) return null;

    // Check if expired
    if (stored.expiresAt < Date.now()) {
      // Clean up expired entry
      const updated = { ...analyses };
      delete updated[id];
      setAnalyses(updated);
      saveToStorage(updated);
      return null;
    }

    return stored.analysis;
  }, [analyses]);

  const getPackageFromAnalysis = useCallback(
    (analysisId: string, packageName: string) => {
      const analysis = getAnalysis(analysisId);
      if (!analysis) return null;

      return analysis.dependencies.find(
        (dep) => dep.parsed.name.toLowerCase() === packageName.toLowerCase()
      ) || null;
    },
    [getAnalysis]
  );

  const deleteAnalysis = useCallback((id: string) => {
    setAnalyses((prev) => {
      const updated = { ...prev };
      delete updated[id];
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const clearExpired = useCallback(() => {
    setAnalyses((prev) => {
      const cleaned = cleanExpired(prev);
      saveToStorage(cleaned);
      return cleaned;
    });
  }, []);

  return {
    saveAnalysis,
    getAnalysis,
    getPackageFromAnalysis,
    deleteAnalysis,
    clearExpired,
  };
}

// Standalone functions for use outside of React components
export function getStoredAnalysis(id: string): ProjectAnalysis | null {
  const analyses = loadFromStorage();
  const stored = analyses[id];

  if (!stored) return null;
  if (stored.expiresAt < Date.now()) return null;

  return stored.analysis;
}

export function getStoredPackage(analysisId: string, packageName: string) {
  const analysis = getStoredAnalysis(analysisId);
  if (!analysis) return null;

  return analysis.dependencies.find(
    (dep) => dep.parsed.name.toLowerCase() === packageName.toLowerCase()
  ) || null;
}
