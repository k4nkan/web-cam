const defaultBaseUrl = 'https://api.tripo3d.ai/v2/openapi';
const defaultTimeoutMs = 30_000;

function parseRetryAfter(value) {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

export function createTripoClient({
  apiKey,
  baseUrl,
  fetchImpl = globalThis.fetch,
  modelVersion,
  timeoutMs = defaultTimeoutMs,
} = {}) {
  function getHeaders() {
    const resolvedApiKey = apiKey || process.env.TRIPO_API_KEY;
    if (!resolvedApiKey) {
      const error = new Error('TRIPO_API_KEY が設定されていません。');
      error.status = 500;
      throw error;
    }

    return {
      Authorization: `Bearer ${resolvedApiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async function request(path, options = {}) {
    let response;

    try {
      const resolvedBaseUrl = baseUrl || process.env.TRIPO_API_BASE_URL || defaultBaseUrl;
      response = await fetchImpl(`${resolvedBaseUrl}${path}`, {
        ...options,
        headers: {
          ...getHeaders(),
          ...options.headers,
        },
        signal: options.signal || AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const error = new Error('Tripo APIに接続できませんでした。', { cause });
      error.status = cause?.name === 'TimeoutError' ? 504 : 502;
      throw error;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      const error = new Error(payload.message || `Tripo API error (${response.status})`);
      error.status = response.status === 429 ? 429 : 502;
      error.retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      error.traceId = response.headers.get('x-tripo-trace-id') || undefined;
      throw error;
    }

    if (!payload.data) {
      const error = new Error('Tripo APIのレスポンス形式が不正です。');
      error.status = 502;
      throw error;
    }

    return payload.data;
  }

  return {
    createImageModelTask(imageUrl, fileType = 'jpg') {
      return request('/task', {
        method: 'POST',
        body: JSON.stringify({
          type: 'image_to_model',
          model_version: modelVersion || process.env.TRIPO_MODEL || 'v3.1-20260211',
          file: {
            type: fileType,
            url: imageUrl,
          },
          texture: true,
          pbr: true,
          render_image: true,
        }),
      });
    },

    getTask(taskId) {
      return request(`/task/${encodeURIComponent(taskId)}`);
    },
  };
}

const tripoClient = createTripoClient();

export const createImageModelTask = tripoClient.createImageModelTask;
export const getTask = tripoClient.getTask;
