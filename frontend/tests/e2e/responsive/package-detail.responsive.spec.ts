/**
 * Responsive tests for PackageDetail page
 * Tests header, card grids, and score displays
 */

import { test, expect, hasHorizontalScroll, waitForLayoutStable } from '../../fixtures/responsive.fixture';
import { VIEWPORTS } from '../../fixtures/viewports';

test.describe('PackageDetail Responsive Behavior', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a package detail page
    await page.goto('/');
    await page.waitForSelector('table.package-table');

    // Click first package to go to detail
    const firstRow = page.locator('table.package-table tbody tr').first();
    await firstRow.click();
    await page.waitForLoadState('networkidle');
  });

  test.describe('Header Layout', () => {
    test('should display header correctly on desktop', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await waitForLayoutStable(page);

      // Package title should be visible
      const title = page.locator('.package-title, h1');
      await expect(title.first()).toBeVisible();

      // Grade badge should be visible
      const gradeBadge = page.locator('.grade-badge').first();
      await expect(gradeBadge).toBeVisible();
    });

    test('should stack header on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Header should still be visible
      const title = page.locator('.package-title, h1');
      await expect(title.first()).toBeVisible();

      // No horizontal overflow
      const hasScroll = await hasHorizontalScroll(page);
      expect(hasScroll).toBe(false);
    });

    test('grade badge should be appropriately sized on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const gradeBadge = page.locator('.grade-badge').first();
      if (await gradeBadge.isVisible()) {
        const box = await gradeBadge.boundingBox();
        expect(box).toBeTruthy();
        expect(box!.width).toBeGreaterThanOrEqual(32);
      }
    });
  });

  test.describe('Detail Grid', () => {
    test('should display cards in grid on desktop', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await waitForLayoutStable(page);

      const detailGrid = page.locator('.detail-grid');
      if (await detailGrid.isVisible()) {
        const cards = detailGrid.locator('.card, [class*="card"]');
        const count = await cards.count();
        expect(count).toBeGreaterThan(0);
      }
    });

    test('should stack cards on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const detailGrid = page.locator('.detail-grid');
      if (await detailGrid.isVisible()) {
        // Grid should be single column
        const gridStyle = await detailGrid.evaluate((el) =>
          getComputedStyle(el).gridTemplateColumns
        );

        // Should be single column (1fr or a single value)
        expect(gridStyle).toMatch(/^(1fr|[0-9.]+px)$/);
      }
    });

    test('cards should not overflow on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const hasScroll = await hasHorizontalScroll(page);
      expect(hasScroll).toBe(false);
    });
  });

  test.describe('Score Breakdown', () => {
    test('score bars should be visible on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const scoreCard = page.locator('.scores-card, [class*="score"]').first();
      if (await scoreCard.isVisible()) {
        // Score bars should fit within the card
        const cardBox = await scoreCard.boundingBox();
        expect(cardBox).toBeTruthy();
        expect(cardBox!.width).toBeLessThanOrEqual(VIEWPORTS.mobileM.width);
      }
    });
  });

  test.describe('Enterprise Indicators', () => {
    test('indicators should wrap on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const indicators = page.locator('.enterprise-indicators');
      if (await indicators.isVisible()) {
        // Should be visible and not overflow
        const box = await indicators.boundingBox();
        expect(box).toBeTruthy();
        expect(box!.width).toBeLessThanOrEqual(VIEWPORTS.mobileM.width);
      }
    });
  });

  test.describe('Collapsible Sections', () => {
    test('score justification should be expandable on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const justificationHeader = page.locator('text=How Scores Are Calculated');
      if (await justificationHeader.isVisible()) {
        // Click to expand
        await justificationHeader.click();
        await page.waitForTimeout(300);

        // Content should be visible
        const securityScore = page.locator('text=Security Score');
        await expect(securityScore).toBeVisible();
      }
    });
  });
});
