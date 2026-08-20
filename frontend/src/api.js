const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status, retryAfterMs, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

function parseRetryAfter(response) {
  const value = response.headers.get('retry-after');
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - Date.now());
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(apiUrl(path), options);
  } catch (cause) {
    throw new ApiError('バックエンドAPIに接続できません。', { cause });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error || 'バックエンドAPIでエラーが発生しました。', {
      status: response.status,
      retryAfterMs: parseRetryAfter(response),
    });
  }
  return payload;
}

export async function listModels() {
  const payload = await request('/api/models');
  return payload.models || [];
}

export async function listPhotos() {
  const payload = await request('/api/photos');
  return payload.photos || [];
}

export async function savePhoto(image, id) {
  const payload = await request('/api/photos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, id }),
  });
  if (!payload.photo?.url) {
    throw new ApiError('バックエンドから写真URLが返りませんでした。');
  }
  return payload.photo;
}

export async function createModelTask(image, name) {
  const task = await request('/api/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, name }),
  });
  if (!task.taskId) {
    throw new ApiError('バックエンドからタスクIDが返りませんでした。');
  }
  return task;
}

export function getModelTask(taskId, name) {
  const params = new URLSearchParams({ taskId });
  if (name) {
    params.set('name', name);
  }
  return request(`/api/task?${params}`);
}
