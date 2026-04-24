import { expect, type Locator, type Page } from "@playwright/test";

export const MOBILE_SAFE_AREA_TOLERANCE_PX = 6;
export const MIN_TAP_TARGET_PX = 44;

async function getRequiredBox(target: Locator, label: string) {
  await target.scrollIntoViewIfNeeded();
  await expect(target, `${label} should be visible before measuring`).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${label} should expose a bounding box`).not.toBeNull();
  return box!;
}

export async function tap(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  await target.tap();
}

export async function tapWithControlReveal(page: Page, target: Locator) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.dispatchEvent("body", "touchstart");
    try {
      await tap(target);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(120);
    }
  }
  throw lastError;
}

export async function expectMinimumTapTarget(target: Locator, label: string, minSize = MIN_TAP_TARGET_PX) {
  const box = await getRequiredBox(target, label);
  expect(box.width, `${label} width should meet ${minSize}px minimum`).toBeGreaterThanOrEqual(minSize);
  expect(box.height, `${label} height should meet ${minSize}px minimum`).toBeGreaterThanOrEqual(minSize);
}

export async function expectNoHorizontalOverflow(page: Page, maxOverflowPx = 1) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return Math.max(doc.scrollWidth, body.scrollWidth) - doc.clientWidth;
  });
  expect(overflow, "horizontal overflow should stay within tolerance").toBeLessThanOrEqual(maxOverflowPx);
}

export async function expectVisibleInViewport(
  page: Page,
  target: Locator,
  label: string,
  tolerancePx = MOBILE_SAFE_AREA_TOLERANCE_PX,
) {
  const box = await getRequiredBox(target, label);
  const viewport = page.viewportSize();
  expect(viewport, "viewport size should be available").not.toBeNull();
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  expect(left, `${label} should not render left of viewport`).toBeGreaterThanOrEqual(-tolerancePx);
  expect(right, `${label} should not render right of viewport`).toBeLessThanOrEqual(viewport!.width + tolerancePx);
  expect(top, `${label} should not render above viewport`).toBeGreaterThanOrEqual(-tolerancePx);
  expect(bottom, `${label} should not render below viewport`).toBeLessThanOrEqual(viewport!.height + tolerancePx);
}

export async function expectNoVerticalOverlap(
  upper: Locator,
  lower: Locator,
  labels: { upper: string; lower: string },
  tolerancePx = 1,
) {
  const upperBox = await getRequiredBox(upper, labels.upper);
  const lowerBox = await getRequiredBox(lower, labels.lower);
  const upperBottom = upperBox.y + upperBox.height;
  const lowerTop = lowerBox.y;
  expect(
    upperBottom,
    `${labels.upper} should not overlap ${labels.lower}`,
  ).toBeLessThanOrEqual(lowerTop + tolerancePx);
}

export async function simulatePullToRefreshGesture(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) return;
  // Keep naming aligned with intent: trigger touch lifecycle events plus overscroll-like movement.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("touchstart"));
    window.dispatchEvent(new Event("touchmove"));
    window.dispatchEvent(new Event("touchend"));
  });
  const centerX = Math.floor(viewport.width / 2);
  await page.mouse.move(centerX, 30);
  await page.mouse.down();
  await page.mouse.move(centerX, Math.min(viewport.height - 20, 250), { steps: 12 });
  await page.mouse.up();
}
