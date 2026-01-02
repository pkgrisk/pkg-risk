/**
 * Responsive tests for PackageList page
 * Tests table-to-card transformation, filters, and navigation
 */

import { test, expect, hasHorizontalScroll, checkTouchTargetSize, isTableTransformedToCards, waitForLayoutStable } from '../../fixtures/responsive.fixture';
import { VIEWPORTS } from '../../fixtures/viewports';

test.describe('PackageList Responsive Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table.package-table');
  });

  test.describe('Table Layout', () => {
    test('should display table on desktop', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await waitForLayoutStable(page);

      const table = page.locator('table.package-table');
      await expect(table).toBeVisible();

      // Verify table header is visible
      const thead = page.locator('table.package-table thead');
      const theadDisplay = await thead.evaluate((el) => getComputedStyle(el).display);
      expect(theadDisplay).not.toBe('none');

      // Verify all columns are visible
      const headers = ['Grade', 'Package', 'Score', 'Issues', 'Last Commit', 'Installs'];
      for (const header of headers) {
        await expect(page.locator(`th:has-text("${header}")`)).toBeVisible();
      }
    });

    test('should transform table to cards on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Table should be in block display mode
      const isCards = await isTableTransformedToCards(page);
      expect(isCards).toBe(true);

      // Table header should be visually hidden
      const thead = page.locator('table.package-table thead');
      const theadClip = await thead.evaluate((el) => getComputedStyle(el).clip);
      expect(theadClip).toBe('rect(0px, 0px, 0px, 0px)');

      // Each row should have card-like styling
      const firstRow = page.locator('table.package-table tbody tr').first();
      const rowDisplay = await firstRow.evaluate((el) => getComputedStyle(el).display);
      expect(rowDisplay).toBe('block');
    });

    test('should not have horizontal scroll on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const hasScroll = await hasHorizontalScroll(page);
      expect(hasScroll).toBe(false);
    });

    test('table rows should be clickable on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const firstRow = page.locator('table.package-table tbody tr').first();
      await firstRow.click();

      // Should navigate to package detail page
      await expect(page).toHaveURL(/\/homebrew\//);
    });
  });

  test.describe('Filters', () => {
    test('should stack filters vertically on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const filters = page.locator('.filters');
      const filtersBox = await filters.boundingBox();
      expect(filtersBox).toBeTruthy();

      // Search input should be full width
      const searchInput = page.locator('.search-input');
      const searchBox = await searchInput.boundingBox();
      expect(searchBox).toBeTruthy();

      // Search should be nearly full width (accounting for padding)
      const expectedMinWidth = VIEWPORTS.mobileM.width - 48;
      expect(searchBox!.width).toBeGreaterThanOrEqual(expectedMinWidth * 0.85);
    });

    test('filter dropdowns should be usable on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Grade filter
      const gradeFilter = page.locator('.grade-filter');
      await gradeFilter.selectOption('A');
      await expect(gradeFilter).toHaveValue('A');

      // Reset and test security filter
      await gradeFilter.selectOption('all');
      const securityFilter = page.locator('.security-filter');
      await securityFilter.selectOption('has_cves');
      await expect(securityFilter).toHaveValue('has_cves');
    });

    test('search input should work on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const searchInput = page.locator('.search-input');
      await searchInput.fill('curl');
      await expect(searchInput).toHaveValue('curl');

      // Wait for filter to apply
      await page.waitForTimeout(300);

      // Should filter results
      const visibleRows = page.locator('table.package-table tbody tr');
      const count = await visibleRows.count();
      expect(count).toBeLessThan(100); // Filtered results
    });
  });

  test.describe('Touch Targets', () => {
    test('action buttons should have adequate touch targets', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Actions should be visible on mobile
      const firstRowActions = page.locator('.row-actions').first();
      await expect(firstRowActions).toBeVisible();

      // Check action button size
      const actionBtn = page.locator('.row-action-btn').first();
      if (await actionBtn.isVisible()) {
        const isAdequate = await checkTouchTargetSize(page, '.row-action-btn');
        expect(isAdequate).toBe(true);
      }
    });

    test('filter controls should have adequate touch targets', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Check grade filter height
      const gradeFilter = page.locator('.grade-filter');
      const gradeBox = await gradeFilter.boundingBox();
      expect(gradeBox).toBeTruthy();
      expect(gradeBox!.height).toBeGreaterThanOrEqual(44);
    });
  });

  test.describe('Ecosystem Stats', () => {
    test('stats grid should be responsive', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const statsGrid = page.locator('.stats-grid, .summary-stats');
      if (await statsGrid.isVisible()) {
        const statCards = page.locator('.stat-card');
        const count = await statCards.count();

        // All stat cards should be visible
        for (let i = 0; i < count; i++) {
          await expect(statCards.nth(i)).toBeVisible();
        }
      }
    });
  });
});
