import { expect, test } from '@playwright/test';

test('camera UI states stay usable and screenshotable', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await page.screenshot({ path: testInfo.outputPath('home.png') });

  await page.getByRole('button', { name: 'カメラ起動' }).click();
  await expect(page.locator('.app')).toHaveClass(/state-camera/);
  await expect(page.locator('#captureButton')).toBeEnabled();
  await expect(page.locator('#switchCameraButton')).toBeEnabled();
  await expect(page.locator('.three-layer canvas')).toBeVisible();

  await page.locator('[data-move="right"]').click({ clickCount: 4, delay: 40 });
  await page.locator('[data-move="up"]').click({ clickCount: 4, delay: 40 });
  await page.locator('#modelScaleRange').evaluate((range) => {
    range.value = '1.35';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const zoomScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  expect(zoomScale).toBe(1);

  await page.screenshot({ path: testInfo.outputPath('camera.png') });

  await page.locator('#captureButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-preview/);
  await expect(page.locator('#saveLink')).toHaveAttribute('href', /^(blob:|data:image\/jpeg)/);
  await page.screenshot({ path: testInfo.outputPath('preview.png') });
});
