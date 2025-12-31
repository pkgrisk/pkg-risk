import { useState, useCallback, useEffect } from 'react';
import type { SavedProject, ParsedDependency, Ecosystem } from '../types/package';

const STORAGE_KEY = 'pkgrisk-uploaded-projects';
const MAX_SAVED_PROJECTS = 10;

export interface UseUploadedProjectReturn {
  savedProjects: SavedProject[];
  saveProject: (name: string, ecosystem: Ecosystem, dependencies: ParsedDependency[]) => string;
  deleteProject: (id: string) => void;
  getProject: (id: string) => SavedProject | undefined;
  clearAllProjects: () => void;
  persistenceEnabled: boolean;
  setPersistenceEnabled: (enabled: boolean) => void;
}

export function useUploadedProject(): UseUploadedProjectReturn {
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SavedProject[];
        setSavedProjects(parsed);
        setPersistenceEnabled(true);
      }
    } catch (e) {
      console.warn('Failed to load saved projects:', e);
    }
  }, []);

  // Save to localStorage when projects change (if persistence is enabled)
  useEffect(() => {
    if (persistenceEnabled && savedProjects.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedProjects));
      } catch (e) {
        console.warn('Failed to save projects to localStorage:', e);
      }
    }
  }, [savedProjects, persistenceEnabled]);

  const saveProject = useCallback(
    (name: string, ecosystem: Ecosystem, dependencies: ParsedDependency[]): string => {
      const id = crypto.randomUUID();
      const project: SavedProject = {
        id,
        name,
        uploadedAt: new Date().toISOString(),
        ecosystem,
        dependencies,
      };

      setSavedProjects((prev) => {
        // Add new project at the beginning, limit total
        const updated = [project, ...prev].slice(0, MAX_SAVED_PROJECTS);
        return updated;
      });

      return id;
    },
    []
  );

  const deleteProject = useCallback((id: string) => {
    setSavedProjects((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      if (updated.length === 0) {
        // Clear storage if no projects left
        localStorage.removeItem(STORAGE_KEY);
      }
      return updated;
    });
  }, []);

  const getProject = useCallback(
    (id: string): SavedProject | undefined => {
      return savedProjects.find((p) => p.id === id);
    },
    [savedProjects]
  );

  const clearAllProjects = useCallback(() => {
    setSavedProjects([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const handleSetPersistenceEnabled = useCallback((enabled: boolean) => {
    setPersistenceEnabled(enabled);
    if (!enabled) {
      // Clear storage when disabling persistence
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return {
    savedProjects,
    saveProject,
    deleteProject,
    getProject,
    clearAllProjects,
    persistenceEnabled,
    setPersistenceEnabled: handleSetPersistenceEnabled,
  };
}
