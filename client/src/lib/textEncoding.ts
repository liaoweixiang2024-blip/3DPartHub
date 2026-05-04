function bytesFromLatin1String(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function decodeLatin1Bytes(value: string, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(bytesFromLatin1String(value));
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

function textQualityScore(value: string) {
  if (!value) return -1000;
  const cjkCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const readableCount = (value.match(/[a-zA-Z0-9_\-\s()[\]（）【】.]/g) || []).length;
  const replacementCount = (value.match(/\uFFFD/g) || []).length;
  const controlCount = countControlChars(value);
  const mojibakeCount = (value.match(/[ÃÂâäåæçèéêëìíîïðñòóôõöùúûüýÿ¤¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿╔╗╚╝╠╣╦╩╬═║]/g) || [])
    .length;
  return cjkCount * 12 + readableCount - replacementCount * 50 - controlCount * 20 - mojibakeCount * 6;
}

function isControlChar(char: string) {
  const code = char.charCodeAt(0);
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function countControlChars(value: string) {
  let count = 0;
  for (const char of value) {
    if (isControlChar(char)) count += 1;
  }
  return count;
}

function stripControlChars(value: string) {
  let clean = '';
  for (const char of value) {
    if (!isControlChar(char)) clean += char;
  }
  return clean;
}

function fixMojibakeText(value: string) {
  if (!value) return '';
  const hasLatin1Mojibake = /[ÃÂâäåæçèéêëìíîïðñòóôõöùúûüýÿ]/.test(value);
  const candidates = [
    { value, bonus: 0 },
    { value: decodeLatin1Bytes(value, 'utf-8'), bonus: hasLatin1Mojibake ? 80 : 0 },
    { value: decodeLatin1Bytes(value, 'gbk'), bonus: 0 },
    { value: decodeLatin1Bytes(value, 'gb18030'), bonus: 0 },
  ].filter((item) => Boolean(item.value));

  return candidates.reduce((best, item) => {
    const score = textQualityScore(item.value) + item.bonus;
    const bestScore = textQualityScore(best.value) + best.bonus;
    return score > bestScore ? item : best;
  }, candidates[0]).value;
}

export function normalizeCadLabel(value: string | null | undefined, fallback = 'Part') {
  const decodedStepText = decodeStepUnicodeEscapes(String(value || ''));
  return stripControlChars(fixMojibakeText(decodedStepText)).trim().slice(0, 255) || fallback;
}
