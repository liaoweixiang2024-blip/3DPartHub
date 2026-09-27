import type { SelectionComponent } from '../api/selections';

// 子零件批量导入列名 → 基础字段映射（表头模式识别用，精确匹配、忽略英文大小写）
const KIT_BASE_FIELD_HEADERS: Record<string, 'name' | 'modelNo' | 'qty'> = {
  零件名: 'name',
  名称: 'name',
  name: 'name',
  型号: 'modelNo',
  型号编号: 'modelNo',
  model: 'modelNo',
  modelno: 'modelNo',
  数量: 'qty',
  qty: 'qty',
};

/**
 * 解析批量导入的子零件文本。两种模式：
 * 1) 表头模式（推荐，Excel 直接连表头粘贴）：首个非空行任一列名精确命中基础字段名即视为表头，
 *    基础列（名称/型号/数量）列序任意，其余列头（编码、品牌、备注……）作为附加参数列存入 specs，
 *    列数不设上限；名称缺省时回落型号；数量非法的行计入 badLines 并跳过。
 * 2) 无表头（向后兼容）：制表符（Excel 直接粘贴）/逗号/连续空格分隔，按「零件名 型号 数量」位置解析
 *    （两列时第二列纯数字按「型号 数量」，单列视为型号数量 1）；第 4 列起自动命名为「列4」…存入 specs。
 * 以 # 开头的行视为注释跳过。badLines 为 1 起的行号。
 */
export function parseKitComponentLines(text: string): { items: SelectionComponent[]; badLines: number[] } {
  const items: SelectionComponent[] = [];
  const badLines: number[] = [];
  const rawLines = text.split(/\r?\n/);

  // 只 trim 不滤空：表头模式靠列位对应，空单元格必须占位（否则后面的列会整体左移）；
  // 无表头模式自行 filter(Boolean) 兼容旧行为
  const splitLine = (line: string): string[] => {
    let tokens: string[];
    if (line.includes('\t')) tokens = line.split('\t');
    else if (line.includes(',')) tokens = line.split(',');
    else if (/\s{2,}/.test(line)) tokens = line.split(/\s{2,}/);
    else tokens = line.split(' ');
    return tokens.map((token) => token.trim());
  };

  // 表头识别：首个非空、非 # 行若任一列名命中基础字段则按表头模式解析
  let headerMap: Array<'name' | 'modelNo' | 'qty' | `spec:${string}`> | null = null;
  let firstDataLine = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = splitLine(line);
    const isHeader = tokens.some(
      (token) => KIT_BASE_FIELD_HEADERS[token] || KIT_BASE_FIELD_HEADERS[token.toLowerCase()],
    );
    if (isHeader) {
      headerMap = tokens.map((token) => {
        const base = KIT_BASE_FIELD_HEADERS[token] || KIT_BASE_FIELD_HEADERS[token.toLowerCase()];
        return base ?? (`spec:${token}` as `spec:${string}`);
      });
      firstDataLine = i + 1;
    }
    break;
  }

  for (let i = firstDataLine; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = splitLine(line);
    if (!tokens.some(Boolean)) continue;

    if (headerMap) {
      const comp: SelectionComponent = { name: '', modelNo: '', qty: 1, specs: {} };
      let valid = true;
      let hasValue = false;
      tokens.forEach((value, colIdx) => {
        const target = headerMap![colIdx];
        if (!target || !value) return;
        hasValue = true;
        if (target === 'name') comp.name = value;
        else if (target === 'modelNo') comp.modelNo = value;
        else if (target === 'qty') {
          const parsed = parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < 1) {
            badLines.push(i + 1);
            valid = false;
            return;
          }
          comp.qty = parsed;
        } else {
          comp.specs![target.slice(5)] = value;
        }
      });
      if (!valid || !hasValue) continue;
      if (!comp.name) comp.name = comp.modelNo || '';
      items.push(comp);
      continue;
    }

    // 无表头：位置解析（向后兼容，过滤空列），第 4 列起自动命名进 specs
    const denseTokens = tokens.filter(Boolean);
    let name = '';
    let modelNo = '';
    let qty = 1;
    if (denseTokens.length >= 3) {
      name = denseTokens[0];
      modelNo = denseTokens[1];
      const parsed = parseInt(denseTokens[2], 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        badLines.push(i + 1);
        continue;
      }
      qty = parsed;
    } else if (denseTokens.length === 2) {
      if (/^\d+$/.test(denseTokens[1])) {
        modelNo = denseTokens[0];
        name = denseTokens[0];
        qty = parseInt(denseTokens[1], 10);
      } else {
        name = denseTokens[0];
        modelNo = denseTokens[1];
      }
    } else {
      modelNo = denseTokens[0];
      name = denseTokens[0];
    }
    const specs: Record<string, string> = {};
    for (let j = 3; j < denseTokens.length; j++) {
      if (denseTokens[j]) specs[`列${j + 1}`] = denseTokens[j];
    }
    items.push({ name, modelNo, qty, specs });
  }
  return { items, badLines };
}
