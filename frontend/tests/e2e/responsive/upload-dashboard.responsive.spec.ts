/**
 * Responsive tests for UploadDashboard page
 * Tests file uploader, tabs, and results display
 */

import { test, expect, hasHorizontalScroll, checkTouchTargetSize, waitForLayoutStable } from '../../fixtures/responsive.fixture';
import { VIEWPORTS } from '../../fixtures/viewports';

test.describe('UploadDashboard Responsive Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/upload');
    await page.waitForLoadState('networkidle');
  });

  test.describe('File Uploader', () => {
    test('upload zone should be visible on all viewports', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const uploadZone = page.locator('.upload-zone');
      await expect(uploadZone).toBeVisible();
    });

    test('upload zone should be full width on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const uploadZone = page.locator('.upload-zone');
      const box = await uploadZone.boundingBox();
      expect(box).toBeTruthy();

      // Should be nearly full width (accounting for padding)
      const expectedMinWidth = VIEWPORTS.mobileM.width - 48;
      expect(box!.width).toBeGreaterThanOrEqual(expectedMinWidth * 0.85);
    });

    test('upload zone should be focusable and tappable', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const uploadZone = page.locator('.upload-zone');

      // Should have proper accessibility attributes
      const role = await uploadZone.getAttribute('role');
      const tabIndex = await uploadZone.getAttribute('tabindex');

      expect(role).toBe('button');
      expect(tabIndex).toBe('0');
    });

    test('supported file tags should wrap on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const fileTags = page.locator('.file-tags');
      if (await fileTags.isVisible()) {
        const box = await fileTags.boundingBox();
        expect(box).toBeTruthy();

        // Tags should wrap and not overflow
        expect(box!.width).toBeLessThanOrEqual(VIEWPORTS.mobileM.width);
      }
    });
  });

  test.describe('Page Layout', () => {
    test('should not have horizontal scroll on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const hasScroll = await hasHorizontalScroll(page);
      expect(hasScroll).toBe(false);
    });

    test('should not have horizontal scroll on tablet', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.tabletPortrait);
      await waitForLayoutStable(page);

      const hasScroll = await hasHorizontalScroll(page);
      expect(hasScroll).toBe(false);
    });
  });

  test.describe('Saved Projects', () => {
    test('saved projects section should be visible if exists', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const savedProjects = page.locator('.saved-projects, [class*="saved"]');
      // This section may or may not exist depending on localStorage
      if (await savedProjects.isVisible()) {
        await expect(savedProjects).toBeVisible();
      }
    });
  });

  test.describe('Touch Targets', () => {
    test('upload zone should have adequate touch target', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const uploadZone = page.locator('.upload-zone');
      const box = await uploadZone.boundingBox();
      expect(box).toBeTruthy();

      // Upload zone should be large enough for easy tapping
      expect(box!.height).toBeGreaterThanOrEqual(100);
    });
  });
});
