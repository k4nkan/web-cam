import http from 'node:http';
import modelsHandler from './api/models.js';
import taskHandler from './api/task.js';

const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (request, response) => {
  if (request.url?.startsWith('/api/health')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.url?.startsWith('/api/models')) {
    await modelsHandler(request, response);
    return;
  }

  if (request.url?.startsWith('/api/task')) {
    await taskHandler(request, response);
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on http://0.0.0.0:${port}`);
});
