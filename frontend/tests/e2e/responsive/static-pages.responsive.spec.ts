/**
 * Responsive tests for static pages (Methodology, About)
 * Tests content layout and readability
 */

import { test, expect, hasHorizontalScroll, waitForLayoutStable } from '../../fixtures/responsive.fixture';
import { VIEWPORTS } from '../../fixtures/viewports';

test.describe('Methodology Page Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/methodology');
    await page.waitForLoadState('networkidle');
  });

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

  test('category cards should be visible on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);
    await waitForLayoutStable(page);

    const categoryCards = page.locator('.category-card, [class*="category"]');
    const count = await categoryCards.count();

    if (count > 0) {
      // All cards should be visible
      for (let i = 0; i < count; i++) {
        await expect(categoryCards.nth(i)).toBeVisible();
      }
    }
  });

  test('content should be readable on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);
    await waitForLayoutStable(page);

    // Main content container should fit within viewport
    const content = page.locator('.about-page, .main-content');
    const box = await content.first().boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(VIEWPORTS.mobileM.width);
  });

  test('headings should be appropriately sized on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);
    await waitForLayoutStable(page);

    const h1 = page.locator('h1').first();
    if (await h1.isVisible()) {
      const fontSize = await h1.evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize)
      );

      // Font size should be reasonable for mobile (not too large)
      expect(fontSize).toBeLessThanOrEqual(28);
      expect(fontSize).toBeGreaterThanOrEqual(16);
    }
  });
});

test.describe('About Page Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
  });

  test('should not have horizontal scroll on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);
    await waitForLayoutStable(page);

    const hasScroll = await hasHorizontalScroll(page);
    expect(hasScroll).toBe(false);
  });

  test('disclaimer cards should stack on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);
    await waitForLayoutStable(page);

    const disclaimerCards = page.locator('.disclaimer-card, [class*="disclaimer"]');
    const count = await disclaimerCards.count();

    if (count >= 2) {
      const firstCard = await disclaimerCards.nth(0).boundingBox();
      const secondCard = await disclaimerCards.nth(1).boundingBox();

      if (firstCard && secondCard) {
        // Cards should stack vertically (second card below first)
        expect(secondCard.y).toBeGreaterThan(firstCard.y);
      }
    }
  });

  test('links should be tappable on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);
    await waitForLayoutStable(page);

    // Find a link and verify it's clickable
    const methodologyLink = page.locator('a:has-text("Methodology")').first();
    if (await methodologyLink.isVisible()) {
      await methodologyLink.click();
      await expect(page).toHaveURL(/methodology/);
    }
  });

  test('content should be readable width on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);
    await waitForLayoutStable(page);

    // Paragraphs should have readable line length
    const paragraphs = page.locator('p');
    const count = await paragraphs.count();

    if (count > 0) {
      const firstParagraph = paragraphs.first();
      const box = await firstParagraph.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeLessThanOrEqual(VIEWPORTS.mobileM.width);
    }
  });
});

test.describe('Cross-Page Navigation on Mobile', () => {
  test('can navigate between pages on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobileM);

    // Start at home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Go to Methodology
    await page.locator('.nav-link:has-text("Methodology")').click();
    await expect(page).toHaveURL(/methodology/);

    // Go to About
    await page.locator('.nav-link:has-text("About")').click();
    await expect(page).toHaveURL(/about/);

    // Go to Upload
    await page.locator('.nav-link:has-text("Upload")').click();
    await expect(page).toHaveURL(/upload/);

    // Go back home via brand link
    await page.locator('.nav-brand').click();
    await expect(page).toHaveURL(/\/$/);
  });
});
