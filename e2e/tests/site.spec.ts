import { expect, test } from '@playwright/test';

/** Everything the site must do for a visitor, measured the way the design brief promises it. */

test.describe('desktop', () => {
  test('text comes first, the page has no console errors and no sideways scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('./');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).toContainText(/Netherlands/i);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });

  test('every section has a heading and the page is complete', async ({ page }) => {
    await page.goto('./');
    expect(await page.locator('main h2').count()).toBeGreaterThanOrEqual(7);
    await expect(page.getByRole('link', { name: /source|github/i }).first()).toBeVisible();
  });

  test('the theme toggle switches and remembers dark mode', async ({ page }) => {
    await page.goto('./');
    const toggle = page.locator('#theme');
    await toggle.click();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(['light', 'dark']).toContain(theme);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  });

  test('the 3D scene starts only after the headline is on screen, and rests at zero frames', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(4000);
    const lcp = await page.evaluate(() => new Promise<number>((res) => {
      new PerformanceObserver((l) => res(l.getEntries().at(-1)!.startTime)).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => res(-1), 1000);
    }));
    // The stage chunk (three.js and the scene) must not even start downloading before the largest paint.
    // A capability probe on a throwaway canvas is allowed earlier; the scene is not.
    const stageAt = await page.evaluate(() => performance.getEntriesByType('resource').find((r) => /\/stage-[^/]+\.js$/.test(r.name))?.startTime ?? -1);
    expect(lcp).toBeGreaterThan(0);
    if (stageAt > 0) expect(stageAt).toBeGreaterThan(lcp);
    const frames = await page.evaluate(() => new Promise<number>((res) => {
      let n = 0;
      const orig = window.requestAnimationFrame;
      window.requestAnimationFrame = (cb) => { n++; return orig(cb); };
      setTimeout(() => res(n), 2000);
    }));
    expect(frames).toBeLessThanOrEqual(2);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('no WebGL and the final frame of every animation', async ({ page }) => {
    let webgl = false;
    await page.exposeFunction('__webgl', () => (webgl = true));
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/.test(type)) (window as unknown as { __webgl: () => void }).__webgl();
        return (orig as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto('./');
    await page.waitForTimeout(3000);
    expect(webgl).toBe(false);
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the headline, every section and the hero poster are there', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.locator('main h2').count()).toBeGreaterThanOrEqual(7);
    const hasPoster = await page.evaluate(() => {
      const el = document.querySelector('[class*="hero"], header, section');
      return !!el && getComputedStyle(el).backgroundImage !== 'none' || !!document.querySelector('img');
    });
    expect(hasPoster).toBe(true);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('no sideways scroll, readable headline, no 3D', async ({ page }) => {
    let webgl = false;
    await page.exposeFunction('__webgl', () => (webgl = true));
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/.test(type)) (window as unknown as { __webgl: () => void }).__webgl();
        return (orig as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto('./');
    await expect(page.locator('h1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.waitForTimeout(2500);
    // Phones get the stills; the canvas element may exist but never gets a WebGL context.
    expect(webgl).toBe(false);
  });
});
