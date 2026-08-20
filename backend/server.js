import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import handler from './api/index.js';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '.env'),
});

const port = Number(process.env.PORT || 3000);
const server = http.createServer(handler);

server.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on http://0.0.0.0:${port}`);
});
