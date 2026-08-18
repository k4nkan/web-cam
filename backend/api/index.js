import healthHandler from './health.js';
import modelsHandler from './models.js';
import taskHandler from './task.js';

export default async function handler(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;

  if (pathname.startsWith('/api/health')) {
    await healthHandler(request, response);
    return;
  }

  if (pathname.startsWith('/api/models')) {
    await modelsHandler(request, response);
    return;
  }

  if (pathname.startsWith('/api/task')) {
    await taskHandler(request, response);
    return;
  }

  response.status(404).json({ error: 'Not found' });
}
