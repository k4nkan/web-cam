import { readJson, sendError, sendJson, setCors } from '../src/http.js';
import { listStoredPhotos, savePhoto } from '../src/photos.js';

export default async function handler(request, response) {
  setCors(request, response);
  response.setHeader('cache-control', 'no-store');

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  try {
    if (request.method === 'GET') {
      sendJson(response, 200, { photos: await listStoredPhotos() });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(response, 400, { error: 'JSON object is required' });
      return;
    }

    sendJson(response, 201, { photo: await savePhoto(body.image, body.id) });
  } catch (error) {
    sendError(response, error);
  }
}
