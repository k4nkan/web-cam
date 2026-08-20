import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoUploadQueue } from '../src/photo-upload-queue.js';

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('condition was not met');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('one hundred photos upload without exceeding two active requests', async () => {
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let completed = 0;
  const queue = new PhotoUploadQueue({
    maxConcurrent: 2,
    upload: async (_image, id) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;
      return { id, url: `https://blob.test/${id}.jpg` };
    },
    onSuccess: () => {
      completed += 1;
    },
  });

  for (let index = 0; index < 100; index += 1) {
    queue.enqueue({ id: `photo-${index}`, image: `image-${index}` });
  }

  await waitFor(() => completed === 100);
  assert.equal(maxActiveRequests, 2);
  assert.deepEqual(queue.getState(), { activeCount: 0, queuedCount: 0 });
  queue.stop();
});

test('temporary errors retry the same photo without opening another slot', async () => {
  let requests = 0;
  let completed = 0;
  const retryDelays = [];
  const queue = new PhotoUploadQueue({
    maxConcurrent: 1,
    retryDelay: 1,
    upload: async (_image, id) => {
      requests += 1;
      if (requests < 3) {
        const error = new Error('temporary');
        error.status = requests === 1 ? 429 : 503;
        error.retryAfterMs = requests === 1 ? 2 : undefined;
        throw error;
      }
      return { id, url: `https://blob.test/${id}.jpg` };
    },
    onRetry: (_job, _error, delay) => retryDelays.push(delay),
    onSuccess: () => {
      completed += 1;
    },
  });

  assert.equal(queue.enqueue({ id: 'photo-retry', image: 'image' }), true);
  assert.equal(queue.enqueue({ id: 'photo-retry', image: 'duplicate' }), false);

  await waitFor(() => completed === 1);
  assert.equal(requests, 3);
  assert.deepEqual(retryDelays, [2, 2]);
  assert.deepEqual(queue.getState(), { activeCount: 0, queuedCount: 0 });
  queue.stop();
});

test('invalid requests fail once without retrying', async () => {
  let requests = 0;
  let failures = 0;
  const queue = new PhotoUploadQueue({
    retryDelay: 1,
    upload: async () => {
      requests += 1;
      const error = new Error('invalid');
      error.status = 400;
      throw error;
    },
    onFailure: () => {
      failures += 1;
    },
  });

  queue.enqueue({ id: 'photo-invalid', image: 'image' });

  await waitFor(() => failures === 1);
  assert.equal(requests, 1);
  queue.stop();
});
