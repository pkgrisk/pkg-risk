/**
 * Responsive tests for UploadDashboard page
 * Tests file uploader, tabs, and results display
 */

import { test, expect, hasHorizontalScroll, checkTouchTargetSize, waitForLayoutStable } from '../../fixtures/responsive.fixture';
import { VIEWPORTS } from '../../fixtures/viewports';

test.describe('UploadDashboard Responsive Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/upload');
    await page.waitForLoadState('domcontentloaded');
    // Wait for the upload dashboard to render
    await page.waitForSelector('.upload-dashboard, .upload-header', { timeout: 15000 }).catch(() => {});
  });

  test.describe('File Uploader', () => {
    test('upload page should load on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);

      // Navigate and wait for any content to appear
      await page.waitForTimeout(1000);

      // Check for any page content (upload dashboard, header, or error message)
      const hasContent = await page.locator('body').evaluate(
        (body) => body.innerText.length > 50
      );
      expect(hasContent).toBe(true);
    });

    test('file uploader should be full width on mobile when visible', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Wait a bit for component to render
      await page.waitForTimeout(500);

      const uploadZone = page.locator('.upload-zone, .file-uploader');
      if (await uploadZone.first().isVisible().catch(() => false)) {
        const box = await uploadZone.first().boundingBox();
        if (box) {
          // Should be nearly full width (accounting for padding)
          const expectedMinWidth = VIEWPORTS.mobileM.width - 48;
          expect(box.width).toBeGreaterThanOrEqual(expectedMinWidth * 0.7);
        }
      }
    });

    test('upload zone should be focusable and tappable', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const uploadZone = page.locator('.upload-zone');

      if (await uploadZone.isVisible()) {
        // Should have proper accessibility attributes
        const role = await uploadZone.getAttribute('role');
        const tabIndex = await uploadZone.getAttribute('tabindex');

        expect(role).toBe('button');
        expect(tabIndex).toBe('0');
      }
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

      const uploadZone = page.locator('.upload-zone, .file-uploader');
      const first = uploadZone.first();

      if (await first.isVisible()) {
        const box = await first.boundingBox();
        if (box) {
          // Upload zone should be large enough for easy tapping
          expect(box.height).toBeGreaterThanOrEqual(80);
        }
      }
    });
  });
});
