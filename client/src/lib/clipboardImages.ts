const GENERIC_CLIPBOARD_IMAGE_NAMES = new Set(['image.png', 'image.jpg', 'image.jpeg', 'image.webp', 'image.gif']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']);

function imageExtension(file: File) {
  const extFromName = file.name.split('.').pop()?.toLowerCase();
  if (extFromName && IMAGE_EXTENSIONS.has(extFromName)) {
    return extFromName;
  }

  const extFromType = file.type.split('/')[1]?.toLowerCase();
  if (extFromType === 'jpeg') return 'jpg';
  return extFromType || 'png';
}

function timestampName() {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:T]/g, '');
  return `pasted-image-${stamp}${String(now.getMilliseconds()).padStart(3, '0')}`;
}

function isImageFile(file: File) {
  if (file.type.startsWith('image/')) return true;
  const extFromName = file.name.split('.').pop()?.toLowerCase();
  return Boolean(extFromName && IMAGE_EXTENSIONS.has(extFromName));
}

function normalizeClipboardImage(file: File) {
  if (file.name && !GENERIC_CLIPBOARD_IMAGE_NAMES.has(file.name.toLowerCase())) {
    return file;
  }

  return new File([file], `${timestampName()}.${imageExtension(file)}`, {
    type: file.type || 'image/png',
    lastModified: file.lastModified || Date.now(),
  });
}

export function getClipboardImageFile(clipboardData: DataTransfer | null | undefined) {
  if (!clipboardData) return null;

  for (const item of Array.from(clipboardData.items || [])) {
    if (item.kind !== 'file' || (item.type && !item.type.startsWith('image/'))) continue;
    const file = item.getAsFile();
    if (file && isImageFile(file)) return normalizeClipboardImage(file);
  }

  for (const file of Array.from(clipboardData.files || [])) {
    if (isImageFile(file)) return normalizeClipboardImage(file);
  }

  return null;
}
