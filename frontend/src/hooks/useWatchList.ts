import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'pkg-risk-watch-list';

interface WatchListHook {
  watchedPackages: Set<string>;
  isWatched: (packageId: string) => boolean;
  toggleWatch: (packageId: string) => void;
  addToWatch: (packageId: string) => void;
  removeFromWatch: (packageId: string) => void;
  watchCount: number;
}

function loadWatchList(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch {
    console.warn('Failed to load watch list from localStorage');
  }
  return new Set();
}

function saveWatchList(packages: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...packages]));
  } catch {
    console.warn('Failed to save watch list to localStorage');
  }
}

export function useWatchList(): WatchListHook {
  const [watchedPackages, setWatchedPackages] = useState<Set<string>>(() => loadWatchList());

  useEffect(() => {
    saveWatchList(watchedPackages);
  }, [watchedPackages]);

  const isWatched = useCallback(
    (packageId: string) => watchedPackages.has(packageId),
    [watchedPackages]
  );

  const addToWatch = useCallback((packageId: string) => {
    setWatchedPackages((prev) => new Set([...prev, packageId]));
  }, []);

  const removeFromWatch = useCallback((packageId: string) => {
    setWatchedPackages((prev) => {
      const next = new Set(prev);
      next.delete(packageId);
      return next;
    });
  }, []);

  const toggleWatch = useCallback(
    (packageId: string) => {
      if (watchedPackages.has(packageId)) {
        removeFromWatch(packageId);
      } else {
        addToWatch(packageId);
      }
    },
    [watchedPackages, addToWatch, removeFromWatch]
  );

  return {
    watchedPackages,
    isWatched,
    toggleWatch,
    addToWatch,
    removeFromWatch,
    watchCount: watchedPackages.size,
  };
}

export default useWatchList;
