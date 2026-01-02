/**
 * Viewport configurations for responsive testing
 */

export const VIEWPORTS = {
  // Mobile devices
  mobileS: { width: 320, height: 568, name: 'Mobile S (iPhone SE)' },
  mobileM: { width: 375, height: 667, name: 'Mobile M (iPhone 8)' },
  mobileL: { width: 425, height: 812, name: 'Mobile L (iPhone 12)' },

  // Tablets
  tabletPortrait: { width: 768, height: 1024, name: 'Tablet Portrait (iPad)' },
  tabletLandscape: { width: 1024, height: 768, name: 'Tablet Landscape (iPad)' },

  // Desktop
  laptop: { width: 1366, height: 768, name: 'Laptop (HD)' },
  desktop: { width: 1920, height: 1080, name: 'Desktop (FHD)' },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

// Breakpoints based on CSS media queries
export const BREAKPOINTS = {
  mobile: 480,
  tablet: 768,
  desktop: 1024,
} as const;

// Core viewport set for most tests (mobile, tablet, desktop)
export const CORE_VIEWPORTS: ViewportName[] = ['mobileM', 'tabletPortrait', 'desktop'];

// Extended viewport set for comprehensive testing
export const EXTENDED_VIEWPORTS: ViewportName[] = [
  'mobileS',
  'mobileM',
  'mobileL',
  'tabletPortrait',
  'tabletLandscape',
  'laptop',
  'desktop',
];
