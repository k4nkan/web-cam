const maxImageBytes = 3 * 1024 * 1024;

export function parseImageDataUrl(image) {
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
