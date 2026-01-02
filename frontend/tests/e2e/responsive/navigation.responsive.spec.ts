/**
 * Responsive tests for navigation
 * Tests navbar behavior across viewports
 */

import { test, expect, hasHorizontalScroll, checkTouchTargetSize, waitForLayoutStable } from '../../fixtures/responsive.fixture';
import { VIEWPORTS } from '../../fixtures/viewports';

test.describe('Navigation Responsive Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Navbar Layout', () => {
    test('should display full navbar on desktop', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await waitForLayoutStable(page);

      // Brand should be visible
      const brand = page.locator('.nav-brand');
      await expect(brand).toBeVisible();

      // Nav links should be visible
      const navLinks = page.locator('.nav-links');
      await expect(navLinks).toBeVisible();

      // Ecosystem selector should be visible
      const ecosystemSelector = page.locator('.ecosystem-selector');
      await expect(ecosystemSelector).toBeVisible();
    });

    test('should be accessible on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Brand should still be visible
      const brand = page.locator('.nav-brand');
      await expect(brand).toBeVisible();

      // Ecosystem selector should be visible and usable
      const ecosystemSelector = page.locator('.ecosystem-selector');
      await expect(ecosystemSelector).toBeVisible();
    });

    test('should not have horizontal overflow', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const hasScroll = await hasHorizontalScroll(page);
      expect(hasScroll).toBe(false);
    });
  });

  test.describe('Ecosystem Selector', () => {
    test('should work on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const selector = page.locator('.ecosystem-selector');

      // Should be able to change ecosystem
      await selector.selectOption('npm');
      await expect(selector).toHaveValue('npm');

      // Wait for data to load
      await page.waitForLoadState('networkidle');

      // Should update URL or content
      await expect(page).toHaveURL(/npm|\/$/);
    });

    test('should have adequate touch target size', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const selector = page.locator('.ecosystem-selector');
      const box = await selector.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });
  });

  test.describe('Nav Links', () => {
    test('nav links should be visible on tablet', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.tabletPortrait);
      await waitForLayoutStable(page);

      // Check for nav links (Upload, Methodology, About)
      const uploadLink = page.locator('.nav-link:has-text("Upload")');
      const methodologyLink = page.locator('.nav-link:has-text("Methodology")');
      const aboutLink = page.locator('.nav-link:has-text("About")');

      await expect(uploadLink).toBeVisible();
      await expect(methodologyLink).toBeVisible();
      await expect(aboutLink).toBeVisible();
    });

    test('nav links should navigate correctly on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      // Click on About link
      const aboutLink = page.locator('.nav-link:has-text("About")');
      await aboutLink.click();

      await expect(page).toHaveURL(/about/);
    });

    test('nav links should have adequate touch targets', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const navLinks = page.locator('.nav-link');
      const count = await navLinks.count();

      for (let i = 0; i < count; i++) {
        const box = await navLinks.nth(i).boundingBox();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(40);
        }
      }
    });
  });

  test.describe('Theme Toggle', () => {
    test('should be accessible on mobile', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileM);
      await waitForLayoutStable(page);

      const themeToggle = page.locator('.theme-toggle, [class*="theme"]');
      if (await themeToggle.isVisible()) {
        await expect(themeToggle).toBeVisible();

        // Should be clickable
        await themeToggle.click();

        // Should change theme
        const html = page.locator('html');
        const theme = await html.getAttribute('data-theme');
        expect(theme).toBeTruthy();
      }
    });
  });
});
