import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelGenerationQueue } from '../src/model-generation-queue.js';

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('condition was not met');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('only two generation tasks run and an expired task releases the next job', async () => {
  let createRequests = 0;
  const statuses = new Map();
  const failures = [];
  const queue = new ModelGenerationQueue({
    maxConcurrent: 2,
    pollInterval: 5,
    createTask: async () => {
      createRequests += 1;
      const taskId = `task-${createRequests}`;
      statuses.set(taskId, 'running');
      return { taskId };
    },
    getTask: async (taskId) => ({ status: statuses.get(taskId), progress: 10 }),
    onTaskFailure: (task) => failures.push(task?.taskId),
  });

  queue.enqueue({ image: 'one', name: 'one' });
  queue.enqueue({ image: 'two', name: 'two' });
  queue.enqueue({ image: 'three', name: 'three' });

  await waitFor(() => createRequests === 2);
  assert.deepEqual(queue.getState(), { activeCount: 2, queuedCount: 1 });

  statuses.set('task-1', 'expired');
  await waitFor(() => createRequests === 3);
  assert.deepEqual(failures, ['task-1']);
  assert.deepEqual(queue.getState(), { activeCount: 2, queuedCount: 0 });
  queue.stop();
});

test('a 429 create response waits and retries without opening another slot', async () => {
  let createRequests = 0;
  let retryDelay;
  const queue = new ModelGenerationQueue({
    maxConcurrent: 1,
    pollInterval: 5,
    createTask: async () => {
      createRequests += 1;
      if (createRequests === 1) {
        const error = new Error('rate limited');
        error.status = 429;
        error.retryAfterMs = 10;
        throw error;
      }
      return { taskId: 'task-1' };
    },
    getTask: async () => ({ status: 'expired' }),
    onCreateRetry: (_error, delay) => {
      retryDelay = delay;
    },
  });

  queue.enqueue({ image: 'one', name: 'one' });

  await waitFor(() => createRequests === 2);
  assert.equal(retryDelay, 10);
  await waitFor(() => queue.getState().activeCount === 0);
  queue.stop();
});

test('restoring the same task twice creates one polling loop', async () => {
  let taskRequests = 0;
  const queue = new ModelGenerationQueue({
    pollInterval: 5,
    createTask: async () => ({ taskId: 'unused' }),
    getTask: async () => {
      taskRequests += 1;
      return { status: 'expired' };
    },
  });

  const task = { taskId: 'task-restored', name: 'restored', progress: 20 };
  queue.restore([task, task]);

  await waitFor(() => queue.getState().activeCount === 0);
  assert.equal(taskRequests, 1);
  queue.stop();
});

test('one hundred queued jobs complete without exceeding two active tasks', async () => {
  let nextTaskId = 0;
  let completedTasks = 0;
  let maxActiveCount = 0;
  const queue = new ModelGenerationQueue({
    maxConcurrent: 2,
    pollInterval: 1,
    createTask: async () => ({ taskId: `task-${nextTaskId += 1}` }),
    getTask: async (taskId) => ({
      status: 'success',
      model: { id: taskId, modelUrl: `https://blob.test/${taskId}.glb` },
    }),
    onTaskSuccess: () => {
      completedTasks += 1;
    },
    onQueueChange: ({ activeCount }) => {
      maxActiveCount = Math.max(maxActiveCount, activeCount);
    },
  });

  for (let index = 0; index < 100; index += 1) {
    queue.enqueue({ image: `image-${index}`, name: `model-${index}` });
  }

  await waitFor(() => completedTasks === 100, 3000);
  assert.equal(maxActiveCount, 2);
  assert.deepEqual(queue.getState(), { activeCount: 0, queuedCount: 0 });
  queue.stop();
});

test('temporary polling errors back off and eventually complete once', async () => {
  let pollRequests = 0;
  let completedTasks = 0;
  const queue = new ModelGenerationQueue({
    pollInterval: 1,
    maxPollInterval: 4,
    createTask: async () => ({ taskId: 'task-retry' }),
    getTask: async () => {
      pollRequests += 1;
      if (pollRequests < 3) {
        throw new Error('temporary error');
      }
      return {
        status: 'success',
        model: { id: 'task-retry', modelUrl: 'https://blob.test/task-retry.glb' },
      };
    },
    onTaskSuccess: () => {
      completedTasks += 1;
    },
  });

  queue.enqueue({ image: 'image', name: 'retry' });

  await waitFor(() => completedTasks === 1);
  assert.equal(pollRequests, 3);
  assert.deepEqual(queue.getState(), { activeCount: 0, queuedCount: 0 });
  queue.stop();
});
