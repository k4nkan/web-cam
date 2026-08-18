import { expect, test } from '@playwright/test';

test('camera UI states stay usable and screenshotable', async ({ page }, testInfo) => {
  const modelResponse = await page.request.get('/material/duck.fbx');
  expect(modelResponse.ok()).toBeTruthy();

  await page.goto('/');

  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await expect(page.locator('#modelPreview canvas')).toBeVisible();
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

test('model generation returns to the model picker while pending', async ({ page }) => {
  await page.route('**/api/models', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ taskId: 'task-pending-1', status: 'queued', progress: 0 }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [] }),
    });
  });
  await page.route('**/api/task*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ taskId: 'task-pending-1', status: 'running', progress: 12 }),
    });
  });

  await page.goto('/');
  await page.setInputFiles('#modelImageInput', {
    name: 'sample.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('sample image'),
  });
  await page.getByRole('button', { name: '画像からモデル生成' }).click();

  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await expect(page.locator('#modelSelect option[value="task-pending-1"]')).toBeDisabled();
  await expect(page.locator('#modelSelect option[value="task-pending-1"]')).toContainText('生成中');
});
