import { useEffect, useCallback } from 'react';
import type { RefObject } from 'react';

interface UseKeyboardNavigationOptions {
  itemCount: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onEnter: (index: number) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onEscape?: () => void;
}

export function useKeyboardNavigation({
  itemCount,
  selectedIndex,
  onSelect,
  onEnter,
  searchInputRef,
  onEscape,
}: UseKeyboardNavigationOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if typing in an input (except for special keys)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // Escape always works
      if (e.key === 'Escape') {
        if (isInput) {
          (target as HTMLInputElement).blur();
        }
        onEscape?.();
        return;
      }

      // / to focus search (if not already in input)
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Skip navigation keys if in input
      if (isInput) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          if (itemCount > 0) {
            const next = selectedIndex < itemCount - 1 ? selectedIndex + 1 : 0;
            onSelect(next);
          }
          break;

        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          if (itemCount > 0) {
            const prev = selectedIndex > 0 ? selectedIndex - 1 : itemCount - 1;
            onSelect(prev);
          }
          break;

        case 'Enter':
          if (selectedIndex >= 0 && selectedIndex < itemCount) {
            onEnter(selectedIndex);
          }
          break;

        case 'g':
          // gg to go to first item (vim-style)
          e.preventDefault();
          if (itemCount > 0) {
            onSelect(0);
          }
          break;

        case 'G':
          // G to go to last item (vim-style)
          e.preventDefault();
          if (itemCount > 0) {
            onSelect(itemCount - 1);
          }
          break;
      }
    },
    [itemCount, selectedIndex, onSelect, onEnter, searchInputRef, onEscape]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export default useKeyboardNavigation;
