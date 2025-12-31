import { useState, useCallback, useEffect } from 'react';
import type { PackageNote, PackageNotesStore, Ecosystem, ReviewStatus } from '../types/package';

const STORAGE_KEY = 'pkgrisk-package-notes';
const CURRENT_VERSION = 1;

export interface UsePackageNotesReturn {
  getNote: (ecosystem: Ecosystem, packageName: string) => PackageNote | undefined;
  setNote: (ecosystem: Ecosystem, packageName: string, note: string) => void;
  setReviewStatus: (ecosystem: Ecosystem, packageName: string, status: ReviewStatus) => void;
  deleteNote: (ecosystem: Ecosystem, packageName: string) => void;
  getAllNotes: () => PackageNote[];
  getNotesForEcosystem: (ecosystem: Ecosystem) => PackageNote[];
  hasNote: (ecosystem: Ecosystem, packageName: string) => boolean;
  isReviewed: (ecosystem: Ecosystem, packageName: string) => boolean;
  clearAllNotes: () => void;
}

function makeKey(ecosystem: Ecosystem, packageName: string): string {
  return `${ecosystem}:${packageName.toLowerCase()}`;
}

export function usePackageNotes(): UsePackageNotesReturn {
  const [store, setStore] = useState<PackageNotesStore>({
    notes: {},
    version: CURRENT_VERSION,
  });

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PackageNotesStore;
        // Version check for future migrations
        if (parsed.version === CURRENT_VERSION) {
          setStore(parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to load package notes:', e);
    }
  }, []);

  // Save to localStorage when store changes
  useEffect(() => {
    if (Object.keys(store.notes).length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      } catch (e) {
        console.warn('Failed to save package notes:', e);
      }
    }
  }, [store]);

  const getNote = useCallback(
    (ecosystem: Ecosystem, packageName: string): PackageNote | undefined => {
      const key = makeKey(ecosystem, packageName);
      return store.notes[key];
    },
    [store.notes]
  );

  const setNote = useCallback((ecosystem: Ecosystem, packageName: string, note: string) => {
    const key = makeKey(ecosystem, packageName);
    const now = new Date().toISOString();

    setStore((prev) => {
      const existing = prev.notes[key];
      return {
        ...prev,
        notes: {
          ...prev.notes,
          [key]: {
            packageName,
            ecosystem,
            note,
            reviewStatus: existing?.reviewStatus || 'not_reviewed',
            reviewedBy: existing?.reviewedBy,
            reviewedAt: existing?.reviewedAt,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
          },
        },
      };
    });
  }, []);

  const setReviewStatus = useCallback(
    (ecosystem: Ecosystem, packageName: string, status: ReviewStatus) => {
      const key = makeKey(ecosystem, packageName);
      const now = new Date().toISOString();

      setStore((prev) => {
        const existing = prev.notes[key];
        return {
          ...prev,
          notes: {
            ...prev.notes,
            [key]: {
              packageName,
              ecosystem,
              note: existing?.note || '',
              reviewStatus: status,
              reviewedAt: status !== 'not_reviewed' ? now : undefined,
              createdAt: existing?.createdAt || now,
              updatedAt: now,
            },
          },
        };
      });
    },
    []
  );

  const deleteNote = useCallback((ecosystem: Ecosystem, packageName: string) => {
    const key = makeKey(ecosystem, packageName);

    setStore((prev) => {
      const { [key]: _, ...rest } = prev.notes;
      return {
        ...prev,
        notes: rest,
      };
    });
  }, []);

  const getAllNotes = useCallback((): PackageNote[] => {
    return Object.values(store.notes);
  }, [store.notes]);

  const getNotesForEcosystem = useCallback(
    (ecosystem: Ecosystem): PackageNote[] => {
      return Object.values(store.notes).filter((n) => n.ecosystem === ecosystem);
    },
    [store.notes]
  );

  const hasNote = useCallback(
    (ecosystem: Ecosystem, packageName: string): boolean => {
      const key = makeKey(ecosystem, packageName);
      const note = store.notes[key];
      return !!note && (!!note.note || note.reviewStatus !== 'not_reviewed');
    },
    [store.notes]
  );

  const isReviewed = useCallback(
    (ecosystem: Ecosystem, packageName: string): boolean => {
      const key = makeKey(ecosystem, packageName);
      const note = store.notes[key];
      return !!note && note.reviewStatus !== 'not_reviewed';
    },
    [store.notes]
  );

  const clearAllNotes = useCallback(() => {
    setStore({ notes: {}, version: CURRENT_VERSION });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    getNote,
    setNote,
    setReviewStatus,
    deleteNote,
    getAllNotes,
    getNotesForEcosystem,
    hasNote,
    isReviewed,
    clearAllNotes,
  };
}
