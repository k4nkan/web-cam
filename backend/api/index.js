import healthHandler from './health.js';
import modelsHandler from './models.js';
import taskHandler from './task.js';
import { sendJson } from '../src/http.js';

export default async function handler(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const route = {
    '/api/health': healthHandler,
    '/api/models': modelsHandler,
    '/api/task': taskHandler,
  }[pathname];

  if (route) {
    await route(request, response);
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}
