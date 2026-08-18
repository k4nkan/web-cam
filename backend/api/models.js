import { readJson, sendError, sendJson, setCors } from '../src/http.js';
import { createModelTask, listStoredModels } from '../src/models.js';

export default async function handler(request, response) {
  setCors(response);
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  try {
    if (request.method === 'GET') {
      sendJson(response, 200, { models: await listStoredModels() });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJson(request);
    sendJson(response, 202, await createModelTask(body.image, body.name));
  } catch (error) {
    sendError(response, error);
  }
}
