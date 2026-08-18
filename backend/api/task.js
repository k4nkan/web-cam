import { getQuery, sendError, sendJson, setCors } from '../src/http.js';
import { getModelTask } from '../src/models.js';

export default async function handler(request, response) {
  setCors(response);
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const taskId = getQuery(request, 'taskId');
    const name = getQuery(request, 'name');
    if (!taskId) {
      sendJson(response, 400, { error: 'taskId is required' });
      return;
    }
    sendJson(response, 200, await getModelTask(taskId, name));
  } catch (error) {
    sendError(response, error);
  }
}
