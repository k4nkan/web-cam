const tripoBaseUrl = process.env.TRIPO_API_BASE_URL || 'https://openapi.tripo3d.ai/v3';

function getHeaders() {
  const apiKey = process.env.TRIPO_API_KEY;
  if (!apiKey) {
    const error = new Error('TRIPO_API_KEY が設定されていません。');
    error.status = 500;
    throw error;
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function tripoRequest(path, options = {}) {
  const response = await fetch(`${tripoBaseUrl}${path}`, {
    ...options,
    headers: {
      ...getHeaders(),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== undefined && payload.code !== 0) {
    const error = new Error(payload.message || `Tripo API error (${response.status})`);
    error.status = 502;
    throw error;
  }
  return payload.data;
}

export function createImageModelTask(imageUrl) {
  return tripoRequest('/generation/image-to-model', {
    method: 'POST',
    body: JSON.stringify({
      input: imageUrl,
      model: process.env.TRIPO_MODEL || 'v3.1-20260211',
      texture: true,
      pbr: true,
    }),
  });
}

export function getTask(taskId) {
  return tripoRequest(`/tasks/${encodeURIComponent(taskId)}`);
}
