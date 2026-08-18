import { findModel, findModels, saveBlob } from './storage.js';
import { createImageModelTask, getTask } from './tripo.js';

function parseImageDataUrl(image) {
  const match = image?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error('JPEG、PNG、WebPの画像データを指定してください。');
    error.status = 400;
    throw error;
  }

  return {
    contentType: match[1],
    extension: match[1].split('/')[1].replace('jpeg', 'jpg'),
    body: Buffer.from(match[2], 'base64'),
  };
}

export async function listStoredModels() {
  return findModels();
}

export async function createModelTask(image, name) {
  const source = parseImageDataUrl(image);
  const sourceBlob = await saveBlob(
    `uploads/${crypto.randomUUID()}.${source.extension}`,
    source.body,
    source.contentType,
  );
  const task = await createImageModelTask(sourceBlob.url);

  return {
    taskId: task.task_id,
    name: name?.trim() || undefined,
    status: 'queued',
    progress: 0,
  };
}

export async function getModelTask(taskId, name) {
  const existingModel = await findModel(taskId);
  if (existingModel) {
    return {
      taskId,
      status: 'success',
      progress: 100,
      model: existingModel,
    };
  }

  const task = await getTask(taskId);
  const result = {
    taskId,
    status: task.status,
    progress: task.progress || 0,
  };

  if (task.status !== 'success') {
    if (['failed', 'cancelled', 'banned'].includes(task.status)) {
      result.error = task.message || 'Tripoでモデル生成に失敗しました。';
    }
    return result;
  }

  const modelUrl = task.output?.model_url;
  if (!modelUrl) {
    const error = new Error('TripoからGLBモデルURLが返りませんでした。');
    error.status = 502;
    throw error;
  }

  const modelResponse = await fetch(modelUrl);
  if (!modelResponse.ok) {
    const error = new Error('生成されたGLBモデルを取得できませんでした。');
    error.status = 502;
    throw error;
  }

  const savedModel = await saveBlob(
    `models/${taskId}/model.glb`,
    Buffer.from(await modelResponse.arrayBuffer()),
    'model/gltf-binary',
  );

  let previewUrl = task.output?.rendered_image_url;
  if (previewUrl) {
    const previewResponse = await fetch(previewUrl);
    if (previewResponse.ok) {
      const previewBlob = await saveBlob(
        `models/${taskId}/preview.png`,
        Buffer.from(await previewResponse.arrayBuffer()),
        'image/png',
      );
      previewUrl = previewBlob.url;
    }
  }

  result.model = {
    id: taskId,
    name: name?.trim() || `Tripo ${taskId.slice(0, 8)}`,
    modelUrl: savedModel.url,
    previewUrl,
  };
  return result;
}
