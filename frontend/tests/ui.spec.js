import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('loading screen stays isolated until the initial catalog is ready', async ({ page }) => {
  let releaseCatalog;
  const catalogReady = new Promise((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route('**/api/models', async (route) => {
    await catalogReady;
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
  await expect(page.locator('#photoGalleryScreen')).toBeHidden();
  releaseCatalog();
  await expect(page.locator('.app')).toHaveClass(/state-home/);
});

test('camera UI states stay usable and screenshotable', async ({ page }, testInfo) => {
  const duckFbx = await readFile(new URL('../../backend/assets/duck.fbx', import.meta.url));
  let photoUploads = 0;
  await page.addInitScript(() => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.cameraStartCalls = 0;
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.cameraStartCalls += 1;
      return originalGetUserMedia(...args);
    };
  });
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
  await page.route('**/api/photos', async (route) => {
    if (route.request().method() === 'POST') {
      photoUploads += 1;
      const body = route.request().postDataJSON();
      expect(body.id).toMatch(/^\d{13}-[A-Za-z0-9-]{8,80}$/);
      expect(body.image).toMatch(/^data:image\/jpeg;base64,/);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          photo: {
            id: body.id,
            url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect width="200" height="200" fill="%235d9a61"/%3E%3C/svg%3E',
            createdAt: new Date().toISOString(),
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ photos: [] }),
    });
  });

  await page.goto('/');

  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await expect(page.locator('[data-action="add-model"]')).toBeVisible();
  await expect(page.locator('#startButton')).toBeEnabled();
  await expect(page.locator('#startButtonIcon')).toBeVisible();
  await expect(page.locator('#photoGalleryButton')).toBeVisible();
  await expect(page.locator('#photoGalleryButton')).toContainText('みんなの写真');
  const modelPickerBox = await page.locator('.model-picker').boundingBox();
  const modelGalleryBox = await page.locator('#modelGallery').boundingBox();
  const modelCards = page.locator('#modelGallery .model-card');
  const firstModelCardBox = await modelCards.first().boundingBox();
  const lastModelCardBox = await modelCards.last().boundingBox();
  expect(modelPickerBox.width).toBeLessThanOrEqual(420);
  expect(
    Math.abs(
      (firstModelCardBox.x + lastModelCardBox.x + lastModelCardBox.width) / 2
        - (modelGalleryBox.x + modelGalleryBox.width / 2),
    ),
  ).toBeLessThanOrEqual(2);
  const startBox = await page.locator('#startButton').boundingBox();
  const galleryBox = await page.locator('#photoGalleryButton').boundingBox();
  expect(galleryBox.y + galleryBox.height).toBeLessThanOrEqual(startBox.y);
  await page.screenshot({ path: testInfo.outputPath('home.png') });

  await page.locator('#startButton').evaluate((button) => {
    button.click();
    button.click();
    button.click();
    button.click();
  });
  await expect(page.locator('.app')).toHaveClass(/state-camera/);
  await expect.poll(() => page.evaluate(() => window.cameraStartCalls)).toBe(1);
  await expect(page.locator('#statusText')).toHaveText('撮影できるよ！！！');
  await expect(page.locator('#captureButton')).toBeEnabled();
  await expect(page.locator('#photoGalleryButton')).toBeHidden();
  await expect(page.locator('#switchCameraButton')).toBeEnabled();
  await expect(page.locator('#homeFromCameraButton')).toBeVisible();
  await expect(page.locator('.three-layer canvas')).toBeVisible();
  await expect(page.locator('.scale-control button')).toHaveCount(2);
  await expect(page.locator('#modelScaleRange')).toBeEnabled();

  await page.locator('[data-move="right"]').click({ clickCount: 4, delay: 40 });
  await page.locator('[data-move="up"]').click({ clickCount: 4, delay: 40 });
  await page.locator('[data-scale-limit="max"]').click({ clickCount: 6, delay: 20 });
  await expect(page.locator('#modelScaleRange')).toHaveValue('1.8');
  await page.locator('[data-scale-limit="min"]').click({ clickCount: 6, delay: 20 });
  await expect(page.locator('#modelScaleRange')).toHaveValue('0.5');
  await expect(page.locator('.three-layer canvas')).toBeVisible();

  const zoomScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  expect(zoomScale).toBe(1);

  await page.screenshot({ path: testInfo.outputPath('camera.png') });

  await page.locator('#captureButton').evaluate((button) => {
    button.click();
    button.click();
    button.click();
    button.click();
  });
  await expect(page.locator('.app')).toHaveClass(/state-preview/);
  await expect(page.locator('#homeFromPreviewButton')).toBeVisible();
  await expect(page.locator('#generateCapturedButton')).toHaveCount(0);
  await expect(page.locator('#photoSharePrompt')).toBeVisible();
  await expect(page.locator('#photoSharePrompt')).toContainText('みんなの写真');
  await expect(page.locator('#statusText')).toHaveText('撮影できたよ！！！ 公開するか選んでください。');
  expect(photoUploads).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('preview.png') });

  await page.locator('#confirmPhotoShareButton').evaluate((button) => {
    button.click();
    button.click();
    button.click();
    button.click();
  });
  await expect(page.locator('#photoSharePrompt')).toBeHidden();
  await expect(page.locator('#statusText')).toHaveText('みんなの写真に保存したよ！！！');
  expect(photoUploads).toBe(1);
  await expect(page.locator('#saveLink')).toHaveAttribute('href', /^(blob:|data:image\/jpeg)/);

  await page.locator('#retakeButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-camera/);
  await expect(page.locator('#statusText')).toHaveText('撮影できるよ！！！');

  await page.locator('#captureButton').click();
  await expect(page.locator('#photoSharePrompt')).toBeVisible();
  await page.locator('#declinePhotoShareButton').click();
  await expect(page.locator('#photoSharePrompt')).toBeHidden();
  await expect(page.locator('#statusText')).toHaveText('この写真はみんなの写真に公開していません。');
  expect(photoUploads).toBe(1);

  await page.locator('#retakeButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-camera/);

  await page.locator('#homeFromCameraButton').click();
  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await page.locator('#photoGalleryButton').click();
  await expect(page.locator('#photoGalleryScreen')).toBeVisible();
  await expect(page.locator('#photoGalleryGrid .photo-gallery-card')).toHaveCount(1);
  await expect(page.locator('#photoGalleryGrid img')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('photos.png') });
  await page.locator('#closePhotoGalleryButton').click();
  await expect(page.locator('#photoGalleryScreen')).toBeHidden();
  await expect(page.locator('.app')).toHaveClass(/state-home/);
});

test('model generation returns to the model picker while pending', async ({ page }) => {
  const sourceWebp = await readFile(new URL('../public/images/tobisuke.webp', import.meta.url));
  await page.route('**/api/models', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().image).toMatch(/^data:image\/jpeg;base64,/);
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
    name: 'sample.webp',
    mimeType: 'image/webp',
    buffer: sourceWebp,
  });

  await expect(page.locator('.app')).toHaveClass(/state-home/);
  await expect(page.locator('#startButton')).toBeDisabled();
  await expect(page.locator('#startButtonLabel')).toContainText('モデル');
  await expect(page.locator('#modelSelect option[value="task-pending-1"]')).toBeDisabled();
  await expect(page.locator('#modelSelect option[value="task-pending-1"]')).toContainText('生成中');
  await expect(page.locator('#modelGallery [data-model-id="task-pending-1"]')).toContainText('作成中... 12%');
  await expect(page.locator('[data-action="add-model"]')).toBeVisible();
});

test('model generation starts at most two Tripo tasks and queues the rest', async ({ page }) => {
  let createRequests = 0;
  let releaseFirstTask = false;

  await page.route('**/api/models', async (route) => {
    if (route.request().method() === 'POST') {
      createRequests += 1;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          taskId: `task-${createRequests}`,
          status: 'queued',
          progress: 0,
        }),
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
    const taskId = new URL(route.request().url()).searchParams.get('taskId');
    const expired = taskId === 'task-1' && releaseFirstTask;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        taskId,
        status: expired ? 'expired' : 'running',
        progress: 12,
        error: expired ? 'test expired' : undefined,
      }),
    });
  });

  await page.goto('/');

  async function upload(name) {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-action="add-model"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name,
      mimeType: 'image/jpeg',
      buffer: Buffer.from(name),
    });
  }

  await upload('one.jpg');
  await upload('two.jpg');
  await expect.poll(() => createRequests).toBe(2);

  await upload('three.jpg');
  await page.waitForTimeout(100);
  expect(createRequests).toBe(2);

  releaseFirstTask = true;
  await expect.poll(() => createRequests, { timeout: 5000 }).toBe(3);
});

test('stored models are shown as selectable gallery cards', async ({ page }, testInfo) => {
  const duckFbx = await readFile(new URL('../../backend/assets/duck.fbx', import.meta.url));
  const previewUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="120"%3E%3Crect width="200" height="120" fill="%2390a080"/%3E%3C/svg%3E';
  const models = ['duck', 'camera', 'person', 'box'].map((id) => ({
    id,
    name: id,
    modelUrl: '/model.fbx',
    format: 'fbx',
    previewUrl,
  }));
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
      body: JSON.stringify({ models }),
    });
  });

  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 2560, height: 1200 });
  }
  await page.goto('/');

  const galleryCards = page.locator('#modelGallery .model-card');
  await expect(galleryCards).toHaveCount(5);
  if (testInfo.project.name === 'desktop') {
    const firstCardBox = await galleryCards.first().boundingBox();
    const lastCardBox = await galleryCards.last().boundingBox();
    const gallerySize = await page.locator('#modelGallery').evaluate((gallery) => ({
      clientWidth: gallery.clientWidth,
      scrollWidth: gallery.scrollWidth,
    }));
    expect(lastCardBox.y).toBeGreaterThan(firstCardBox.y);
    expect(gallerySize.scrollWidth).toBeLessThanOrEqual(gallerySize.clientWidth + 1);
    await page.screenshot({ path: testInfo.outputPath('models.png') });
  }

  const card = page.locator('#modelGallery [data-model-id="duck"]');
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toBeVisible();
  await card.click();
  await expect(card).toHaveClass(/is-selected/);
});

test('add card opens the native image picker', async ({ page }) => {
  await page.route('**/api/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [] }),
    });
  });
  await page.goto('/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-action="add-model"]').click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser).toBeTruthy();
});
