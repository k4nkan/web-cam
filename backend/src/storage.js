import { list, put } from '@vercel/blob';

function getToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    const error = new Error('BLOB_READ_WRITE_TOKEN が設定されていません。');
    error.status = 500;
    throw error;
  }
  return token;
}

export async function saveBlob(pathname, body, contentType) {
  return put(pathname, body, {
    access: 'public',
    addRandomSuffix: false,
    contentType,
    token: getToken(),
  });
}

export async function findModels() {
  const { blobs } = await list({ prefix: 'models/', limit: 1000, token: getToken() });
  const models = new Map();

  for (const blob of blobs) {
    const match = blob.pathname.match(/^models\/([^/]+)\/(model\.glb|preview\.[^/]+)$/);
    if (!match) {
      continue;
    }

    const [, id, filename] = match;
    const model = models.get(id) || {
      id,
      name: `Tripo ${id.slice(0, 8)}`,
    };

    if (filename === 'model.glb') {
      model.modelUrl = blob.url;
    } else {
      model.previewUrl = blob.url;
    }
    models.set(id, model);
  }

  return [...models.values()]
    .filter((model) => model.modelUrl)
    .sort((a, b) => b.id.localeCompare(a.id));
}

export async function findModel(id) {
  return (await findModels()).find((model) => model.id === id);
}
