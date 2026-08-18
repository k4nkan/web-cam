const maxBodyBytes = 8 * 1024 * 1024;

export function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

export function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}

export function sendError(response, error) {
  const status = error.status || 500;
  console.error(error);
  sendJson(response, status, { error: error.message || 'Internal server error' });
}

export async function readJson(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new Error('画像データが大きすぎます。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('JSONを読み取れません。');
    error.status = 400;
    throw error;
  }
}

export function getQuery(request, key) {
  const url = new URL(request.url, 'http://localhost');
  return url.searchParams.get(key);
}
