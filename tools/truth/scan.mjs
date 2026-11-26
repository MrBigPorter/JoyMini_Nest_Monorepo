/** 行内事实标记：`<!-- truth: PH_GCASH.fee -->`（design D2）。 */
export const MARKER_PATTERN = /<!--\s*truth:\s*([A-Za-z0-9_.-]+)\s*-->/g;

const SEPARATOR_CELL = /^:?-{3,}:?$/;
const MIN_CHANNEL_COLUMNS = ["Method", "Fee"];

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(line) {
  if (!line || !line.trim().startsWith("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

function normalizeLabel(cell) {
  return (cell ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\*\*/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function extractMarkers(line) {
  return [...line.matchAll(MARKER_PATTERN)].map((match) => match[1]);
}

function stripMarkers(line) {
  return line.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * 扫描一篇文档里的渠道表格，把每一行绑定到登记项。
 *
 * 只认「表头含 Method 与 Fee」的表格；表格外的标记不构成声明。
 * 任何无法绑定的情况都产出 errors 条目，从不跳过（design D4）。
 *
 * @returns {{ docId: string, rows: Array, errors: Array }}
 */
export function scanDocument({ docId, content, registry }) {
  const lines = content.split(/\r?\n/);
  const rows = [];
  const errors = [];
  const seenKeys = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith("|")) continue;
    if (!isSeparator(lines[index + 1])) continue;

    const header = splitRow(lines[index]);
    if (!MIN_CHANNEL_COLUMNS.every((column) => header.includes(column))) continue;

    const methodIndex = header.indexOf("Method");
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rawLine = lines[rowIndex];
      if (!rawLine.trim().startsWith("|")) break;

      const lineNumber = rowIndex + 1;
      const cells = splitRow(stripMarkers(rawLine));
      const label = normalizeLabel(cells[methodIndex]);

      if (cells.length !== header.length) {
        errors.push({
          kind: "table-shape",
          docId,
          line: lineNumber,
          rowLabel: label,
          message: `${docId}:${lineNumber} 单元格数 ${cells.length} 与表头 ${header.length} 不符：${rawLine.trim()}`,
        });
        continue;
      }

      const markers = extractMarkers(rawLine);
      const values = Object.fromEntries(header.map((column, columnIndex) => [column, cells[columnIndex]]));

      if (markers.length === 0) {
        errors.push({
          kind: "missing-marker",
          docId,
          line: lineNumber,
          rowLabel: label,
          message: `${docId}:${lineNumber} 渠道行「${label}」没有 truth 标记，无法判定它声明了哪项事实`,
        });
      }

      for (const key of markers) {
        const fact = registry.facts[key];
        if (!fact) {
          errors.push({
            kind: "unknown-key",
            docId,
            line: lineNumber,
            rowLabel: label,
            key,
            message: `${docId}:${lineNumber} 标记指向未登记的键「${key}」`,
          });
          continue;
        }
        if (fact.docId !== docId) {
          errors.push({
            kind: "foreign-key",
            docId,
            line: lineNumber,
            rowLabel: label,
            key,
            message: `${docId}:${lineNumber} 键「${key}」登记在 ${fact.docId}，不能在本篇声明`,
          });
          continue;
        }
        if (seenKeys.has(key)) {
          errors.push({
            kind: "duplicate-key",
            docId,
            line: lineNumber,
            rowLabel: label,
            key,
            message: `${docId}:${lineNumber} 键「${key}」已在该文档其它行声明过`,
          });
          continue;
        }
        seenKeys.add(key);
      }

      rows.push({ line: lineNumber, label, cells: values, markers });
    }

    index += 1;
  }

  for (const [key, fact] of Object.entries(registry.facts)) {
    if (fact.docId !== docId) continue;
    if (seenKeys.has(key)) continue;
    errors.push({
      kind: "missing-declaration",
      docId,
      key,
      rowLabel: fact.row,
      message: `${docId} 的渠道表里没有登记项「${key}」（预期行：${fact.row}）——配置支持但文档未声明`,
    });
  }

  return { docId, rows, errors };
}
