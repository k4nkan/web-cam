import { readFile } from 'node:fs/promises';
import { list, put } from '@vercel/blob';

const defaultDuckPath = new URL('../assets/duck.fbx', import.meta.url);
let defaultDuckUpload;

export async function saveBlob(pathname, body, contentType) {
  return put(
    pathname,
    body,
    {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    },
  );
}

export async function findModels() {
  const { blobs } = await list({ prefix: 'models/', limit: 1000 });
  const modelBlobs = await ensureDefaultDuck(blobs);
  return parseModels(modelBlobs);
}

export async function findPhotos() {
  const { blobs } = await list({ prefix: 'photos/', limit: 1000 });

  return blobs
    .map((blob) => {
      const match = blob.pathname.match(/^photos\/([^/]+)\.(jpg|png)$/);
      if (!match) {
        return undefined;
      }

      return {
        id: match[1],
        url: blob.url,
        createdAt: new Date(blob.uploadedAt).toISOString(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function parseModels(blobs) {
  const models = new Map();

  for (const blob of blobs) {
    const match = blob.pathname.match(/^models\/([^/]+)\/(model\.(glb|fbx)|preview\.[^/]+)$/);
    if (!match) {
      continue;
    }

    const [, id, filename, format] = match;
    const model = models.get(id) || {
      id,
      name: id === 'duck' ? 'duck' : `Tripo ${id.slice(0, 8)}`,
    };

    if (filename.startsWith('model.')) {
      model.modelUrl = blob.url;
      model.format = format;
    } else {
      model.previewUrl = blob.url;
    }
    models.set(id, model);
  }

  return [...models.values()]
    .filter((model) => model.modelUrl)
    .sort((a, b) => b.id.localeCompare(a.id));
}

async function ensureDefaultDuck(blobs) {
  if (blobs.some((blob) => blob.pathname === 'models/duck/model.fbx')) {
    return blobs;
  }

  defaultDuckUpload ||= (async () => {
    try {
      const body = await readFile(defaultDuckPath);
      return await saveBlob('models/duck/model.fbx', body, 'application/octet-stream');
    } catch (error) {
      defaultDuckUpload = undefined;
      throw error;
    }
  })();

  const savedDuck = await defaultDuckUpload;
  return [...blobs, { pathname: 'models/duck/model.fbx', url: savedDuck.url }];
}

export async function findModel(id) {
  const { blobs } = await list({ prefix: `models/${id}/`, limit: 10 });
  return parseModels(blobs).find((model) => model.id === id);
}
