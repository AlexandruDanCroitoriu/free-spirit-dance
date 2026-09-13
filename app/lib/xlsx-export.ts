type ExportTable = { name: string; columns: string[]; rows: Record<string, unknown>[] };
export type { ExportTable };

const encoder = new TextEncoder();
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function uint16(value: number) { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff); }
function uint32(value: number) { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function zip(files: Array<{ name: string; content: string }>) {
  const entries = files.map(({ name, content }) => ({ name: encoder.encode(name), content: encoder.encode(content) }));
  let offset = 0;
  const localFiles: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  for (const entry of entries) {
    const checksum = crc32(entry.content);
    const local = join([uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0), uint32(checksum), uint32(entry.content.length), uint32(entry.content.length), uint16(entry.name.length), uint16(0), entry.name, entry.content]);
    localFiles.push(local);
    centralDirectory.push(join([uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0), uint32(checksum), uint32(entry.content.length), uint32(entry.content.length), uint16(entry.name.length), uint16(0), uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), entry.name]));
    offset += local.length;
  }
  const central = join(centralDirectory);
  return join([...localFiles, central, uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length), uint16(entries.length), uint32(central.length), uint32(offset), uint16(0)]);
}

function escapeXml(value: unknown) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); }
  return name;
}

function cell(reference: string, value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value ?? "")}</t></is></c>`;
}

function sheetXml(table: ExportTable) {
  const rows = [table.columns, ...table.rows.map((row) => table.columns.map((column) => row[column]))];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((values, rowIndex) => `<row r="${rowIndex + 1}">${values.map((value, columnIndex) => cell(`${columnName(columnIndex)}${rowIndex + 1}`, value)).join("")}</row>`).join("")}</sheetData></worksheet>`;
}

function readUint16(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8); }
function readUint32(bytes: Uint8Array, offset: number) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }

async function unzip(bytes: Uint8Array) {
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && readUint32(bytes, offset) === 0x04034b50) {
    const compression = readUint16(bytes, offset + 8);
    const size = readUint32(bytes, offset + 22);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    if (start + size > bytes.length) throw new Error("The export file is incomplete.");
    const compressed = bytes.slice(start, start + size);
    const content = compression === 0 ? compressed : compression === 8
      ? new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())
      : (() => { throw new Error("Choose a database export created by this app."); })();
    files.set(name, decoder.decode(content));
    offset = start + size;
  }
  return files;
}

function parseXml(xml: string) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("The export file is not valid.");
  return document;
}

function columnIndex(reference: string) {
  let value = 0;
  for (const character of reference.replace(/\d/g, "")) value = value * 26 + character.charCodeAt(0) - 64;
  return value - 1;
}

function cellValue(cell: Element): string | number | boolean {
  const type = cell.getAttribute("t");
  const text = type === "inlineStr" ? cell.getElementsByTagName("t")[0]?.textContent ?? "" : cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (type === "b") return text === "1";
  if (!type && text !== "" && Number.isFinite(Number(text))) return Number(text);
  return text;
}

function parseSheet(xml: string) {
  const rows = Array.from(parseXml(xml).getElementsByTagName("row")).map((row) => {
    const values: Array<string | number | boolean | null> = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const index = columnIndex(cell.getAttribute("r") ?? "");
      if (index < 0) throw new Error("The export file is not valid.");
      values[index] = cellValue(cell);
    }
    return values;
  });
  const columns = (rows.shift() ?? []).map((value) => typeof value === "string" ? value : "");
  if (!columns.length || columns.some((column) => !column)) throw new Error("The export file is not valid.");
  return { columns, rows: rows.map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null]))) };
}

export async function readWorkbook(file: File): Promise<ExportTable[]> {
  const files = await unzip(new Uint8Array(await file.arrayBuffer()));
  const workbook = files.get("xl/workbook.xml");
  if (!workbook) throw new Error("Choose a database export created by this app.");
  const sheets = Array.from(parseXml(workbook).getElementsByTagName("sheet"));
  if (!sheets.length) throw new Error("The export file is empty.");
  return sheets.map((sheet, index) => {
    const name = sheet.getAttribute("name");
    const xml = files.get(`xl/worksheets/sheet${index + 1}.xml`);
    if (!name || !xml) throw new Error("Choose a database export created by this app.");
    return { name, ...parseSheet(xml) };
  });
}

function sheetName(name: string, index: number, used: Set<string>) {
  const base = name.replace(/[\\/*?:\[\]]/g, "_").slice(0, 31) || `Sheet${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) { candidate = `${base.slice(0, 31 - String(suffix).length - 1)}_${suffix}`; suffix++; }
  used.add(candidate);
  return candidate;
}

export function downloadWorkbook(tables: ExportTable[], filename: string) {
  const names = new Set<string>();
  const sheets = tables.map((table, index) => ({ ...table, sheetName: sheetName(table.name, index, names) }));
  const files = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>" },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>` },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet) })),
  ];
  const url = URL.createObjectURL(new Blob([zip(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}
