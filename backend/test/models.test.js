import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelService } from '../src/models.js';

test('concurrent polling for one completed task is coalesced and saved once', async () => {
  let taskRequests = 0;
  const assetRequests = [];
  const savedPaths = [];
  const storageClient = {
    findModel: async () => undefined,
    findModels: async () => [],
    saveBlob: async (pathname) => {
      savedPaths.push(pathname);
      return { url: `https://blob.test/${pathname}` };
    },
  };
  const tripoClient = {
    getTask: async () => {
      taskRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        status: 'success',
        output: {
          pbr_model: 'https://tripo.test/model.glb',
          rendered_image: 'https://tripo.test/preview.png',
        },
      };
    },
  };
  const service = createModelService({
    storageClient,
    tripoClient,
    fetchImpl: async (url) => {
      assetRequests.push(url);
      return new Response(Buffer.from(url));
    },
  });

  const results = await Promise.all(
    Array.from({ length: 100 }, () => service.getModelTask('task-1', 'sample')),
  );

  assert.equal(taskRequests, 1);
  assert.deepEqual(assetRequests.sort(), [
    'https://tripo.test/model.glb',
    'https://tripo.test/preview.png',
  ]);
  assert.deepEqual(savedPaths, [
    'models/task-1/preview.png',
    'models/task-1/model.glb',
  ]);
  assert.ok(results.every((result) => result.model.modelUrl.endsWith('/model.glb')));
});

test('expired tasks return a terminal error without downloading assets', async () => {
  let assetRequests = 0;
  const service = createModelService({
    storageClient: {
      findModel: async () => undefined,
      findModels: async () => [],
      saveBlob: async () => ({ url: 'https://blob.test/model.glb' }),
    },
    tripoClient: {
      getTask: async () => ({ status: 'expired', progress: 80 }),
    },
    fetchImpl: async () => {
      assetRequests += 1;
      return new Response();
    },
  });

  const result = await service.getModelTask('task-expired');

  assert.equal(result.status, 'expired');
  assert.match(result.error, /失敗/);
  assert.equal(assetRequests, 0);
});
