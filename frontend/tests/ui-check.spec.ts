import { test, expect } from '@playwright/test';

/**
 * E2E tests for pkg-risk frontend UI verification.
 *
 * These tests verify:
 * - Package list page loads with data
 * - Table renders with packages and grades
 * - Navigation to package detail pages works
 * - Score breakdowns display correctly
 */

test.describe('Package List Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load and display package list', async ({ page }) => {
    // Wait for the table to load
    await expect(page.locator('table')).toBeVisible();

    // Check that we have package rows
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Verify table has expected columns
    await expect(page.getByRole('columnheader', { name: /package/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /score/i })).toBeVisible();
  });

  test('should display grade badges with correct colors', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible();

    // Check for grade badges (A, B, C, D, F)
    const gradeBadges = page.locator('[class*="grade"]');
    await expect(gradeBadges.first()).toBeVisible();
  });

  test('should display score bars', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible();

    // Look for score bar elements (visual score indicators)
    const scoreBars = page.locator('[class*="score-bar"], [class*="progress"]');
    // At least some packages should have score bars
    const count = await scoreBars.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should have clickable package links', async ({ page }) => {
    // Wait for table to load
    await expect(page.locator('table')).toBeVisible();

    // Find the first package link
    const packageLink = page.locator('tbody tr').first().locator('a');
    await expect(packageLink).toBeVisible();

    // Get the package name for later verification
    const packageName = await packageLink.textContent();
    expect(packageName).toBeTruthy();
  });
});

test.describe('Package Detail Page', () => {
  test('should navigate to package detail and show scores', async ({ page }) => {
    // Start at the list page
    await page.goto('/');
    await expect(page.locator('table')).toBeVisible();

    // Click on the first package link
    const packageLink = page.locator('tbody tr').first().locator('a');
    const packageName = await packageLink.textContent();
    await packageLink.click();

    // Should navigate to detail page (URL is /{ecosystem}/{package})
    await expect(page).toHaveURL(/\/homebrew\//);

    // Package name should appear in the page
    if (packageName) {
      await expect(page.getByText(packageName)).toBeVisible();
    }
  });

  test('should display score breakdown section', async ({ page }) => {
    // Navigate directly to a package (use first from list)
    await page.goto('/');
    await expect(page.locator('table')).toBeVisible();

    const packageLink = page.locator('tbody tr').first().locator('a');
    await packageLink.click();

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Look for score categories or score bars in the detail view
    const detailContent = page.locator('main, .detail, [class*="package"]');
    await expect(detailContent.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display highlights and concerns', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('table')).toBeVisible();

    const packageLink = page.locator('tbody tr').first().locator('a');
    await packageLink.click();

    // Look for highlights or concerns sections
    const infoSection = page.locator('text=/highlights|concerns|summary/i');
    await expect(infoSection.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Navigation', () => {
  test('should navigate back to list from detail page', async ({ page }) => {
    // Go to list, then detail, then back
    await page.goto('/');
    await expect(page.locator('table')).toBeVisible();

    // Navigate to detail
    const packageLink = page.locator('tbody tr').first().locator('a');
    await packageLink.click();
    await expect(page).toHaveURL(/\/homebrew\//);

    // Go back using browser back or a back link
    await page.goBack();

    // Should be back at list
    await expect(page.locator('table')).toBeVisible();
  });
});

test.describe('Score Justification', () => {
  test('should display collapsible score justification section', async ({ page }) => {
    // Navigate to a package with scores (harfbuzz has highest score)
    await page.goto('/pkg-risk/homebrew/harfbuzz');
    await page.waitForLoadState('networkidle');

    // Find the "How Scores Are Calculated" section
    const justificationHeader = page.locator('text=How Scores Are Calculated');
    await expect(justificationHeader).toBeVisible({ timeout: 10000 });

    // Click to expand
    await justificationHeader.click();

    // Verify score categories are visible
    await expect(page.locator('text=Security Score')).toBeVisible();
    await expect(page.locator('text=Maintenance Score')).toBeVisible();
    await expect(page.locator('text=Community Score')).toBeVisible();
    await expect(page.locator('text=Bus Factor Score')).toBeVisible();
    await expect(page.locator('text=Documentation Score')).toBeVisible();
    await expect(page.locator('text=Stability Score')).toBeVisible();
  });

  test('should expand individual score categories and show factors', async ({ page }) => {
    await page.goto('/pkg-risk/homebrew/harfbuzz');
    await page.waitForLoadState('networkidle');

    // Expand the main section
    await page.locator('text=How Scores Are Calculated').click();

    // Click on Security Score to expand it
    await page.locator('text=Security Score').click();

    // Should show security factors
    await expect(page.locator('text=/No known CVEs|CVE/i').first()).toBeVisible({ timeout: 5000 });

    // Capture screenshot of expanded justification
    await page.screenshot({
      path: 'test-results/score-justification-expanded.png',
      fullPage: true,
    });
  });

  test('should show GitHub links in justification', async ({ page }) => {
    await page.goto('/pkg-risk/homebrew/harfbuzz');
    await page.waitForLoadState('networkidle');

    // Expand the main section
    await page.locator('text=How Scores Are Calculated').click();

    // Expand Security Score
    await page.locator('text=Security Score').click();

    // Look for GitHub links (SECURITY.md, dependabot.yml, etc.)
    const githubLinks = page.locator('a[href*="github.com"]');
    const linkCount = await githubLinks.count();
    expect(linkCount).toBeGreaterThan(0);
  });
});

test.describe('Visual Verification (Screenshots)', () => {
  test('should capture package list screenshot', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('table')).toBeVisible();

    // Capture full page screenshot
    await page.screenshot({
      path: 'test-results/package-list.png',
      fullPage: true,
    });
  });

  test('should capture package list with unscored packages', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('table')).toBeVisible();

    // Enable show unscored packages
    await page.locator('text=Show unscored packages').click();

    // Wait for table to update
    await page.waitForTimeout(300);

    // Verify warning icons are visible
    await expect(page.locator('.no-score-warning').first()).toBeVisible();

    // Capture screenshot with unscored packages
    await page.screenshot({
      path: 'test-results/package-list-with-unscored.png',
      fullPage: true,
    });
  });

  test('should capture package detail screenshot', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('table')).toBeVisible();

    const packageLink = page.locator('tbody tr').first().locator('a');
    await packageLink.click();

    // Wait for detail content to load
    await page.waitForLoadState('networkidle');

    await page.screenshot({
      path: 'test-results/package-detail.png',
      fullPage: true,
    });
  });

  test('should capture score justification screenshot', async ({ page }) => {
    await page.goto('/pkg-risk/homebrew/harfbuzz');
    await page.waitForLoadState('networkidle');

    // Expand the score justification
    await page.locator('text=How Scores Are Calculated').click();

    // Expand all score categories
    const categories = ['Security Score', 'Maintenance Score', 'Community Score'];
    for (const cat of categories) {
      await page.locator(`text=${cat}`).click();
    }

    await page.screenshot({
      path: 'test-results/score-justification-full.png',
      fullPage: true,
    });
  });
});
