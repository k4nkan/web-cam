import assert from 'node:assert/strict';
import test from 'node:test';
import { createTripoClient } from '../src/tripo.js';

test('Tripo client uses the current image-to-model contract', async () => {
  const calls = [];
  const client = createTripoClient({
    apiKey: 'test-key',
    baseUrl: 'https://tripo.test/v2/openapi',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      const data = url.endsWith('/task')
        ? { task_id: 'task-1' }
        : { task_id: 'task-1', status: 'running', progress: 25 };
      return Response.json({ code: 0, data });
    },
  });

  await client.createImageModelTask('https://blob.test/source.png', 'png');
  await client.getTask('task-1');

  assert.equal(calls[0].url, 'https://tripo.test/v2/openapi/task');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    type: 'image_to_model',
    model_version: 'v3.1-20260211',
    file: { type: 'png', url: 'https://blob.test/source.png' },
    texture: true,
    pbr: true,
    render_image: true,
  });
  assert.equal(calls[1].url, 'https://tripo.test/v2/openapi/task/task-1');
});

test('Tripo rate limits preserve Retry-After for frontend backoff', async () => {
  const client = createTripoClient({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json(
      { code: 2000, message: 'rate limited' },
      { status: 429, headers: { 'retry-after': '7', 'x-tripo-trace-id': 'trace-1' } },
    ),
  });

  await assert.rejects(
    client.createImageModelTask('https://blob.test/source.jpg'),
    (error) => error.status === 429 && error.retryAfter === 7 && error.traceId === 'trace-1',
  );
});
