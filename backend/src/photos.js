import { parseImageDataUrl } from './image-data.js';
import * as storage from './storage.js';

const photoIdPattern = /^\d{13}-[A-Za-z0-9-]{8,80}$/;

function validatePhotoId(id) {
  if (!photoIdPattern.test(id || '')) {
    const error = new Error('有効な写真IDを指定してください。');
    error.status = 400;
    throw error;
  }
}

export function createPhotoService({ storageClient = storage } = {}) {
  const inFlightUploads = new Map();

  return {
    listStoredPhotos() {
      return storageClient.findPhotos();
    },

    savePhoto(image, id) {
      validatePhotoId(id);

      const currentUpload = inFlightUploads.get(id);
      if (currentUpload) {
        return currentUpload;
      }

      const upload = (async () => {
        const source = parseImageDataUrl(image);
        const saved = await storageClient.saveBlob(
          `photos/${id}.${source.extension}`,
          source.body,
          source.contentType,
        );

        return {
          id,
          url: saved.url,
          createdAt: new Date(Number(id.slice(0, 13))).toISOString(),
        };
      })().finally(() => inFlightUploads.delete(id));

      inFlightUploads.set(id, upload);
      return upload;
    },
  };
}

const photoService = createPhotoService();

export const listStoredPhotos = photoService.listStoredPhotos;
export const savePhoto = photoService.savePhoto;
