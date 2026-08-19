import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('loading screen stays isolated until the initial catalog is ready', async ({ page }) => {
  await page.route('**/api/models', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [] }),
    });
  });

  await page.goto('/');

  await expect(page.locator('#loadingScreen')).toBeVisible();
  await expect(page.locator('.loading-duck')).toHaveCount(4);
  await expect(page.locator('.loading-label')).toHaveCount(0);
  await expect(page.locator('.home-screen')).toBeHidden();
  await expect(page.locator('.stage')).toBeHidden();
  await expect(page.locator('.preview-screen')).toBeHidden();
  await expect(page.locator('.app')).toHaveClass(/state-home/);
});

test('camera UI states stay usable and screenshotable', async ({ page }, testInfo) => {
  const duckFbx = await readFile(new URL('../../backend/assets/duck.fbx', import.meta.url));
  await page.route('**/api/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [{ id: 'duck', name: 'duck', modelUrl: '/duck.fbx', format: 'fbx' }],
      }),
    });
  });
  await page.route('**/duck.fbx', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: duckFbx,
    });
  });

  await page.goto('/');

  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await expect(page.locator('[data-action="add-model"]')).toBeVisible();
  await expect(page.locator('#startButton')).toBeEnabled();
  await expect(page.locator('#startButtonIcon')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png') });

  await page.locator('#startButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-camera/);
  await expect(page.locator('#statusText')).toHaveText('撮影できるよ！！！');
  await expect(page.locator('#captureButton')).toBeEnabled();
  await expect(page.locator('#switchCameraButton')).toBeEnabled();
  await expect(page.locator('#homeFromCameraButton')).toBeVisible();
  await expect(page.locator('.three-layer canvas')).toBeVisible();

  await page.locator('[data-move="right"]').click({ clickCount: 4, delay: 40 });
  await page.locator('[data-move="up"]').click({ clickCount: 4, delay: 40 });
  await page.locator('#modelScaleRange').evaluate((range) => {
    range.value = range.max;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#modelScaleRange')).toHaveValue('1.8');
  await expect(page.locator('.three-layer canvas')).toBeVisible();

  const zoomScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  expect(zoomScale).toBe(1);

  await page.screenshot({ path: testInfo.outputPath('camera.png') });

  await page.locator('#captureButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-preview/);
  await expect(page.locator('#homeFromPreviewButton')).toBeVisible();
  await expect(page.locator('#generateCapturedButton')).toHaveCount(0);
  await expect(page.locator('#statusText')).toHaveText('撮影できたよ！！！');
  await expect(page.locator('#saveLink')).toHaveAttribute('href', /^(blob:|data:image\/jpeg)/);
  await page.screenshot({ path: testInfo.outputPath('preview.png') });

  await page.locator('#retakeButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-camera/);
  await expect(page.locator('#statusText')).toHaveText('撮影できるよ！！！');

  await page.locator('#homeFromCameraButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-home/);
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
  await expect(page.locator('#startButton')).toBeDisabled();
  await expect(page.locator('#startButtonLabel')).toContainText('モデルがありません');
  await expect(page.locator('#startButtonIcon')).toBeHidden();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-action="add-model"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'sample.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('sample image'),
  });

  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await expect(page.locator('#startButton')).toBeDisabled();
  await expect(page.locator('#startButtonLabel')).toContainText('モデル');
  await expect(page.locator('#modelSelect option[value="task-pending-1"]')).toBeDisabled();
  await expect(page.locator('#modelSelect option[value="task-pending-1"]')).toContainText('生成中');
  await expect(page.locator('#modelGallery [data-model-id="task-pending-1"]')).toContainText('作成中... 12%');
  await expect(page.locator('[data-action="add-model"]')).toBeVisible();
});

test('stored models are shown as selectable gallery cards', async ({ page }) => {
  const duckFbx = await readFile(new URL('../../backend/assets/duck.fbx', import.meta.url));
  await page.route('**/model.fbx', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: duckFbx,
    });
  });
  await page.route('**/api/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [
          {
            id: 'duck',
            name: 'duck',
            modelUrl: '/model.fbx',
            format: 'fbx',
            previewUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="120"%3E%3Crect width="200" height="120" fill="%2390a080"/%3E%3C/svg%3E',
          },
        ],
      }),
    });
  });

  await page.goto('/');

  const card = page.locator('#modelGallery [data-model-id="duck"]');
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toBeVisible();
  await card.click();
  await expect(card).toHaveClass(/is-selected/);
});

test('add card opens the native image picker', async ({ page }) => {
  await page.goto('/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-action="add-model"]').click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser).toBeTruthy();
});
