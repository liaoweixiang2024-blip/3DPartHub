function decodeLatin1Bytes(value: string, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(Buffer.from(value, 'latin1'));
  } catch {
    return '';
  }
}

function decodeStepUnicodeEscapes(value: string) {
  return value
    .replace(/\\X([24])\\([\da-fA-F\s]+?)\\X0\\/g, (match, width: string, rawHex: string) => {
      const hex = rawHex.replace(/\s+/g, '');
      const unit = width === '4' ? 8 : 4;
      if (!hex || hex.length % unit !== 0) return match;

      let decoded = '';
      for (let i = 0; i < hex.length; i += unit) {
        const codePoint = Number.parseInt(hex.slice(i, i + unit), 16);
        if (!Number.isFinite(codePoint)) return match;
        try {
          decoded += String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return decoded || match;
    })
    .replace(/\\X\\([0-9a-fA-F]{2})/g, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCharCode(codePoint) : match;
    });
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

export function fixMojibakeText(value: string) {
  if (!value) return '';
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

export function fixMojibakeFilename(value: string) {
  return fixMojibakeText(value);
}

function cleanDisplayText(value: string, fallback: string) {
  return (
    value
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
      .trim()
      .slice(0, 255) || fallback
  );
}

export function normalizeUploadFilename(value: string, fallback = 'unknown.step') {
  const normalized = String(value || '');
  // Browsers normally send File.name without a path. Some legacy clients may
  // still include Windows-style fake paths; strip those while keeping "/" in
  // model numbers such as SCFM-1/2.
  const leaf = normalized.split('\\').filter(Boolean).pop() || normalized || fallback;
  let decoded = leaf;
  try {
    decoded = decodeURIComponent(leaf);
  } catch {
    decoded = leaf;
  }
  return cleanDisplayText(fixMojibakeFilename(decoded), fallback);
}

export function normalizeCadLabel(value: string | null | undefined, fallback = 'Part') {
  const decodedStepText = decodeStepUnicodeEscapes(String(value || ''));
  return cleanDisplayText(fixMojibakeText(decodedStepText), fallback);
}
