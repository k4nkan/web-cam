import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoService } from '../src/photos.js';

const photoId = '1755648000000-12345678-abcd-4000-8000-123456789abc';
const image = `data:image/jpeg;base64,${Buffer.from('photo').toString('base64')}`;

test('concurrent retries for one photo are saved to one Blob path', async () => {
  const savedPaths = [];
  const service = createPhotoService({
    storageClient: {
      findPhotos: async () => [],
      saveBlob: async (pathname) => {
        savedPaths.push(pathname);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { url: `https://blob.test/${pathname}` };
      },
    },
  });

  const results = await Promise.all(
    Array.from({ length: 100 }, () => service.savePhoto(image, photoId)),
  );

  assert.deepEqual(savedPaths, [`photos/${photoId}.jpg`]);
  assert.ok(results.every((photo) => photo.id === photoId));
  assert.ok(results.every((photo) => photo.url.endsWith(`/${photoId}.jpg`)));
});

test('invalid photo input is rejected before writing to Blob', async () => {
  let saved = false;
  const service = createPhotoService({
    storageClient: {
      findPhotos: async () => [],
      saveBlob: async () => {
        saved = true;
      },
    },
  });

  await assert.rejects(() => service.savePhoto('not-an-image', photoId), {
    status: 400,
  });
  assert.throws(() => service.savePhoto(image, '../photo'), {
    status: 400,
  });
  assert.equal(saved, false);
});
