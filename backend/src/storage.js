import { list, put } from '@vercel/blob';

function withToken(options) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { ...options, token } : options;
}

export async function saveBlob(pathname, body, contentType) {
  return put(
    pathname,
    body,
    withToken({
      access: 'public',
      addRandomSuffix: false,
      contentType,
    }),
  );
}

export async function findModels() {
  const { blobs } = await list(withToken({ prefix: 'models/', limit: 1000 }));
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
