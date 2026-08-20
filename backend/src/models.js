import * as storage from './storage.js';
import * as tripo from './tripo.js';

const maxImageBytes = 3 * 1024 * 1024;
const assetDownloadTimeoutMs = 60_000;
const failedTaskStatuses = new Set(['failed', 'cancelled', 'banned', 'expired', 'unknown']);

function parseImageDataUrl(image) {
  const match = image?.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error('JPEGまたはPNGの画像データを指定してください。');
    error.status = 400;
    throw error;
  }

  if (match[2].length > Math.ceil(maxImageBytes * 4 / 3) + 4) {
    const error = new Error('画像データが大きすぎます。3MB以下にしてください。');
    error.status = 413;
    throw error;
  }

  const body = Buffer.from(match[2], 'base64');
  if (body.length > maxImageBytes) {
    const error = new Error('画像データが大きすぎます。3MB以下にしてください。');
    error.status = 413;
    throw error;
  }

  return {
    contentType: match[1],
    extension: match[1].split('/')[1].replace('jpeg', 'jpg'),
    body,
  };
}

function normalizeName(name, taskId) {
  return name?.trim().slice(0, 120) || `Tripo ${taskId.slice(0, 8)}`;
}

export function createModelService({
  storageClient = storage,
  tripoClient = tripo,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const inFlightTaskChecks = new Map();

  async function downloadAsset(url, message) {
    let response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(assetDownloadTimeoutMs),
      });
    } catch (cause) {
      const error = new Error(message, { cause });
      error.status = cause?.name === 'TimeoutError' ? 504 : 502;
      throw error;
    }

    if (!response.ok) {
      const error = new Error(message);
      error.status = 502;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async function finalizeModel(task, taskId, name) {
    const modelUrl = task.output?.pbr_model || task.output?.model || task.output?.base_model;
    if (!modelUrl) {
      const error = new Error('TripoからGLBモデルURLが返りませんでした。');
      error.status = 502;
      throw error;
    }

    const previewSourceUrl = task.output?.rendered_image;
    const [modelBody, previewBody] = await Promise.all([
      downloadAsset(modelUrl, '生成されたGLBモデルを取得できませんでした。'),
      previewSourceUrl
        ? downloadAsset(previewSourceUrl, 'モデルのプレビュー画像を取得できませんでした。')
          .catch((error) => {
            logger.warn(error.message);
            return undefined;
          })
        : undefined,
    ]);

    let previewUrl;
    if (previewBody) {
      const previewBlob = await storageClient.saveBlob(
        `models/${taskId}/preview.png`,
        previewBody,
        'image/png',
      );
      previewUrl = previewBlob.url;
    }

    const savedModel = await storageClient.saveBlob(
      `models/${taskId}/model.glb`,
      modelBody,
      'model/gltf-binary',
    );

    return {
      id: taskId,
      name: normalizeName(name, taskId),
      modelUrl: savedModel.url,
      previewUrl,
    };
  }

  async function resolveModelTask(taskId, name) {
    const existingModel = await storageClient.findModel(taskId);
    if (existingModel) {
      return {
        taskId,
        status: 'success',
        progress: 100,
        model: existingModel,
      };
    }

    const task = await tripoClient.getTask(taskId);
    const result = {
      taskId,
      status: task.status,
      progress: task.progress || 0,
    };

    if (task.status !== 'success') {
      if (failedTaskStatuses.has(task.status)) {
        result.error = task.message || 'Tripoでモデル生成に失敗しました。';
      }
      return result;
    }

    result.model = await finalizeModel(task, taskId, name);
    return result;
  }

  return {
    listStoredModels() {
      return storageClient.findModels();
    },

    async createModelTask(image, name) {
      const source = parseImageDataUrl(image);
      const sourceBlob = await storageClient.saveBlob(
        `uploads/${crypto.randomUUID()}.${source.extension}`,
        source.body,
        source.contentType,
      );
      const task = await tripoClient.createImageModelTask(sourceBlob.url, source.extension);
      if (!task.task_id) {
        const error = new Error('TripoからタスクIDが返りませんでした。');
        error.status = 502;
        throw error;
      }

      return {
        taskId: task.task_id,
        name: name?.trim().slice(0, 120) || undefined,
        status: 'queued',
        progress: 0,
      };
    },

    getModelTask(taskId, name) {
      const currentRequest = inFlightTaskChecks.get(taskId);
      if (currentRequest) {
        return currentRequest;
      }

      const request = resolveModelTask(taskId, name)
        .finally(() => inFlightTaskChecks.delete(taskId));
      inFlightTaskChecks.set(taskId, request);
      return request;
    },
  };
}

const modelService = createModelService();

export const listStoredModels = modelService.listStoredModels;
export const createModelTask = modelService.createModelTask;
export const getModelTask = modelService.getModelTask;
