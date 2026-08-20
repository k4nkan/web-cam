const maxImageBytes = 3 * 1024 * 1024;
const maxImageDimension = 2048;
const directMimeTypes = new Set(['image/jpeg', 'image/png']);

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('画像を読み込めません。')));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('画像を変換できません。')),
      'image/jpeg',
      quality,
    );
  });
}

async function loadImage(file) {
  if (globalThis.createImageBitmap) {
    return createImageBitmap(file);
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function compressImage(file) {
  let image;
  try {
    image = await loadImage(file);
  } catch (cause) {
    throw new Error('この画像形式を読み込めません。JPEGまたはPNGを選択してください。', { cause });
  }

  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const initialScale = Math.min(1, maxImageDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  let scale = initialScale;

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const quality = Math.max(0.56, 0.88 - attempt * 0.08);
      const blob = await canvasToJpeg(canvas, quality);
      if (blob.size <= maxImageBytes) {
        return readBlobAsDataUrl(blob);
      }
      scale *= 0.8;
    }
  } finally {
    image.close?.();
  }

  throw new Error('画像を3MB以下に変換できませんでした。');
}

export function readImageAsDataUrl(file) {
  if (directMimeTypes.has(file.type) && file.size <= maxImageBytes) {
    return readBlobAsDataUrl(file);
  }
  return compressImage(file);
}
