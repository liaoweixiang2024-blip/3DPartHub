function decodeLatin1Bytes(value: string, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(Buffer.from(value, 'latin1'));
  } catch {
    return '';
  }
}

function filenameQualityScore(value: string) {
  if (!value) return -1000;
  const cjkCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const readableCount = (value.match(/[a-zA-Z0-9_\-\s()[\]（）【】.]/g) || []).length;
  const replacementCount = (value.match(/\uFFFD/g) || []).length;
  const controlCount = (value.match(/[\u0000-\u001f\u007f-\u009f]/g) || []).length;
  const mojibakeCount = (value.match(/[ÃÂâäåæçèéêëìíîïðñòóôõöùúûüýÿ¤¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿╔╗╚╝╠╣╦╩╬═║]/g) || [])
    .length;
  return cjkCount * 12 + readableCount - replacementCount * 50 - controlCount * 20 - mojibakeCount * 6;
}

export function fixMojibakeFilename(value: string) {
  const hasLatin1Mojibake = /[ÃÂâäåæçèéêëìíîïðñòóôõöùúûüýÿ]/.test(value);
  const candidates = [
    { value, bonus: 0 },
    { value: decodeLatin1Bytes(value, 'utf-8'), bonus: hasLatin1Mojibake ? 80 : 0 },
    { value: decodeLatin1Bytes(value, 'gbk'), bonus: 0 },
    { value: decodeLatin1Bytes(value, 'gb18030'), bonus: 0 },
  ].filter((item) => Boolean(item.value));
  return candidates.reduce((best, item) => {
    const score = filenameQualityScore(item.value) + item.bonus;
    const bestScore = filenameQualityScore(best.value) + best.bonus;
    return score > bestScore ? item : best;
  }, candidates[0]).value;
}

export function normalizeUploadFilename(value: string, fallback = 'unknown.step') {
  const normalized = String(value || '').replace(/\\/g, '/');
  const leaf = normalized.split('/').filter(Boolean).pop() || normalized || fallback;
  let decoded = leaf;
  try {
    decoded = decodeURIComponent(leaf);
  } catch {
    decoded = leaf;
  }
  return (
    fixMojibakeFilename(decoded)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
      .trim()
      .slice(0, 255) || fallback
  );
}
