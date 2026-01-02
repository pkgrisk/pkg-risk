/**
 * Shared fixtures and utilities for responsive testing
 */

import { test as base, expect, Page } from '@playwright/test';
import { VIEWPORTS, CORE_VIEWPORTS, type ViewportName } from './viewports';

// Extended test fixture with responsive utilities
export const test = base.extend<{
  forEachViewport: (
    callback: (
      viewport: (typeof VIEWPORTS)[ViewportName],
      name: ViewportName
    ) => Promise<void>
  ) => Promise<void>;
}>({
  forEachViewport: async ({ page }, use) => {
    const runForViewports = async (
      callback: (
        viewport: (typeof VIEWPORTS)[ViewportName],
        name: ViewportName
      ) => Promise<void>
    ) => {
      for (const viewportName of CORE_VIEWPORTS) {
        const viewport = VIEWPORTS[viewportName];
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await callback(viewport, viewportName);
      }
    };
    await use(runForViewports);
  },
});

/**
 * Check if page has horizontal scroll (overflow)
 */
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
}

/**
 * Check if an element is visible within the viewport bounds
 */
export async function isVisibleInViewport(
  page: Page,
  selector: string
): Promise<boolean> {
  const element = page.locator(selector);
  const isVisible = await element.isVisible();
  if (!isVisible) return false;

  const box = await element.boundingBox();
  const viewport = page.viewportSize();

  if (!box || !viewport) return false;

  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

/**
 * Check if element meets minimum touch target size (44x44px per WCAG 2.5.5)
 */
export async function checkTouchTargetSize(
  page: Page,
  selector: string,
  minSize: number = 44
): Promise<boolean> {
  const element = page.locator(selector);
  const box = await element.boundingBox();

  if (!box) return false;

  return box.width >= minSize && box.height >= minSize;
}

/**
 * Get computed style property value
 */
export async function getComputedStyle(
  page: Page,
  selector: string,
  property: string
): Promise<string> {
  return page.locator(selector).evaluate(
    (el, prop) => getComputedStyle(el).getPropertyValue(prop),
    property
  );
}

/**
 * Check if table is transformed to cards (mobile view)
 */
export async function isTableTransformedToCards(page: Page): Promise<boolean> {
  const table = page.locator('table.package-table');
  const tableDisplay = await table.evaluate((el) => getComputedStyle(el).display);
  return tableDisplay === 'block';
}

/**
 * Wait for page to stabilize after viewport change
 */
export async function waitForLayoutStable(page: Page, timeout: number = 300): Promise<void> {
  await page.waitForTimeout(timeout);
  await page.waitForLoadState('domcontentloaded');
}

// Re-export expect for convenience
export { expect };
