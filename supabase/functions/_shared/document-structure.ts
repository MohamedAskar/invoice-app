import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';

// Intake validation, not rendering: bounded syntax/metadata checks only. Unsupported
// structures fail closed. Never pass uploaded bytes to a general PDF/image decoder.
const MAX_PIXELS = 12_000_000;
const MAX_ITEMS = 4096;
const MAX_METADATA = 1024 * 1024;
const assert = (condition: unknown): void => { if (!condition) throw new Error('invalid_document'); };
const dimensions = (width: number, height: number) => width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= MAX_PIXELS;
function inflateBounded(data: Uint8Array, cap: number): Buffer {
  assert(Number.isSafeInteger(cap) && cap > 0);
  // node:zlib's info option returns this object; the Deno Node typings omit
  // its return overload. maxOutputLength is enforced inside the inflater.
  const result = inflateSync(data, {maxOutputLength: cap, info: true}) as unknown as {buffer: Buffer; engine: {bytesWritten: number}};
  assert(result.engine.bytesWritten === data.length && result.buffer.length <= cap);
  return result.buffer;
}

export function validPng(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8, chunks = 0, metadata = 0, width = 0, height = 0, depth = 0, color = 0;
  let palette = false, endedData = false, compressedLength = 0;
  const data: Uint8Array[] = [];
  while (pos < bytes.length) {
    assert(++chunks <= MAX_ITEMS && pos + 12 <= bytes.length);
    const length = view.getUint32(pos), end = pos + 12 + length;
    assert(end <= bytes.length);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    assert(/^[A-Za-z]{4}$/.test(type));
    let crc = 0xffffffff;
    for (let i = pos + 4; i < end - 4; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert(((crc ^ 0xffffffff) >>> 0) === view.getUint32(end - 4));
    if (chunks === 1) {
      assert(type === 'IHDR' && length === 13);
      width = view.getUint32(pos + 8); height = view.getUint32(pos + 12);
      depth = bytes[pos + 16]; color = bytes[pos + 17];
      assert(dimensions(width, height));
      assert(({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]} as Record<number,number[]>)[color]?.includes(depth));
      // Adam7 is deliberately unsupported: it needs separate pass accounting.
      assert(bytes[pos + 18] === 0 && bytes[pos + 19] === 0 && bytes[pos + 20] === 0);
    } else if (type === 'IDAT') {
      assert(!endedData && (color !== 3 || palette));
      data.push(bytes.subarray(pos + 8, end - 4)); compressedLength += length;
    } else if (type === 'IEND') {
      assert(length === 0 && end === bytes.length && compressedLength > 0);
      const channels = ({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];
      const row = Math.ceil(width * channels * depth / 8) + 1;
      const expected = row * height;
      // Exact output cap prevents bombs even when IHDR claims only one pixel.
      assert(expected <= 32 * 1024 * 1024);
      const inflated = inflateBounded(Buffer.concat(data, compressedLength), expected);
      assert(inflated.length === expected);
      for (let y = 0; y < height; y++) assert(inflated[y * row] <= 4);
      return true;
    } else {
      assert(type !== 'IHDR');
      if (data.length) endedData = true;
      metadata += length; assert(metadata <= MAX_METADATA);
      if (type === 'PLTE') { assert(!palette && !data.length && length > 0 && length <= 768 && length % 3 === 0 && color !== 0 && color !== 4 && (color !== 3 || length / 3 <= 2 ** depth)); palette = true; }
      else assert(type[0] === type[0].toLowerCase() && !['acTL', 'fcTL', 'fdAT'].includes(type)); // Unknown critical chunk / animation.
    }
    pos = end;
  }
  return false;
}

export function validJpeg(bytes: Uint8Array): boolean {
  let pos = 2, segments = 0, metadata = 0, components = 0, frame = false, progressive = false, scan = false, quantization = false, huffman = false;
  const ids = new Set<number>();
  while (pos < bytes.length) {
    assert(++segments <= MAX_ITEMS && bytes[pos++] === 255);
    while (bytes[pos] === 255) pos++;
    const marker = bytes[pos++];
    if (marker === 0xd9) return pos === bytes.length && frame && scan && quantization && huffman;
    assert(marker !== 0 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7) && pos + 2 <= bytes.length);
    const length = bytes[pos] * 256 + bytes[pos + 1], end = pos + length;
    assert(length >= 2 && end <= bytes.length);
    if (marker === 0xc0 || marker === 0xc2) {
      assert(!frame && length >= 11 && bytes[pos + 2] === 8);
      const height = bytes[pos + 3] * 256 + bytes[pos + 4], width = bytes[pos + 5] * 256 + bytes[pos + 6];
      components = bytes[pos + 7];
      assert(dimensions(width, height) && [1,3,4].includes(components) && length === 8 + 3 * components);
      for (let i = 0; i < components; i++) {
        const at = pos + 8 + i * 3, sampling = bytes[at + 1];
        assert(!ids.has(bytes[at]) && (sampling >> 4) >= 1 && (sampling >> 4) <= 4 && (sampling & 15) >= 1 && (sampling & 15) <= 4 && bytes[at + 2] <= 3);
        ids.add(bytes[at]);
      }
      frame = true; progressive = marker === 0xc2;
    } else if (marker === 0xdb) {
      let at = pos + 2;
      while (at < end) { const spec = bytes[at++]; assert((spec >> 4) <= 1 && (spec & 15) <= 3); at += 64 * ((spec >> 4) + 1); }
      assert(at === end && length > 2); quantization = true;
    } else if (marker === 0xc4) {
      let at = pos + 2;
      while (at < end) {
        const spec = bytes[at++]; assert((spec >> 4) <= 1 && (spec & 15) <= 3 && at + 16 <= end);
        let symbols = 0, slots = 1;
        for (let i = 0; i < 16; i++) { const count = bytes[at++]; symbols += count; slots = slots * 2 - count; assert(slots >= 0); }
        assert(symbols > 0 && symbols <= 256); at += symbols;
      }
      assert(at === end && length > 2); huffman = true;
    } else if (marker === 0xda) {
      assert(frame && quantization && huffman);
      const count = bytes[pos + 2]; assert(count > 0 && count <= components && length === 6 + count * 2);
      const scanIds = new Set<number>();
      for (let i = 0; i < count; i++) {
        const id = bytes[pos + 3 + i * 2], tables = bytes[pos + 4 + i * 2];
        assert(ids.has(id) && !scanIds.has(id) && (tables >> 4) <= 3 && (tables & 15) <= 3); scanIds.add(id);
      }
      const spectralStart = bytes[end - 3], spectralEnd = bytes[end - 2], approximation = bytes[end - 1];
      assert(spectralStart <= spectralEnd && spectralEnd <= 63 && (approximation >> 4) <= 13 && (approximation & 15) <= 13);
      if (!progressive) assert(spectralStart === 0 && spectralEnd === 63 && approximation === 0);
      else assert((spectralStart === 0 && spectralEnd === 0) || (spectralStart > 0 && count === 1));
      pos = end; let entropy = 0;
      while (pos < bytes.length) {
        if (bytes[pos] !== 255) { entropy++; pos++; continue; }
        const next = bytes[pos + 1];
        if (next === 0) { entropy++; pos += 2; }
        else if (next >= 0xd0 && next <= 0xd7) pos += 2;
        else break;
      }
      assert(entropy > 0); scan = true; continue;
    } else {
      assert((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe || marker === 0xdd);
      if (marker === 0xdd) assert(length === 4);
      metadata += length; assert(metadata <= MAX_METADATA);
    }
    pos = end;
  }
  return false;
}

type Value = number | string | null | Value[] | { [key: string]: Value };
type Dict = { [key: string]: Value };
const dictionary = (v: Value): Dict => { assert(v !== null && typeof v === 'object' && !Array.isArray(v)); return v as Dict; };
class PdfSyntax {
  pos = 0;
  constructor(readonly text: string, readonly budget: {remaining: number}) {}
  token(): string {
    const start = this.pos;
    while (this.pos < this.text.length) {
      if (/\s|\0/.test(this.text[this.pos])) this.pos++;
      else if (this.text[this.pos] === '%') { while (this.pos < this.text.length && !/[\r\n]/.test(this.text[this.pos])) this.pos++; }
      else break;
    }
    const at = this.pos, c = this.text[this.pos++];
    if (c === '(') {
      let depth = 1;
      while (depth && this.pos < this.text.length) {
        const ch = this.text[this.pos++];
        if (ch === '\\') this.pos++;
        else if (ch === '(') { depth++; assert(depth <= 24); }
        else if (ch === ')') depth--;
        assert(this.pos - at <= 65536);
      }
      assert(!depth);
    } else if ((c === '<' || c === '>') && this.text[this.pos] === c) this.pos++;
    else if (c === '<') { while (this.pos < this.text.length && this.text[this.pos] !== '>') { assert(/[\da-f\s]/i.test(this.text[this.pos++])); assert(this.pos - at <= 65536); } assert(this.text[this.pos++] === '>'); }
    else if (!'[]<>'.includes(c ?? '')) {
      while (this.pos < this.text.length && !/[\s\0()[\]<>/%]/.test(this.text[this.pos])) { this.pos++; assert(this.pos - at <= 256); }
    }
    this.budget.remaining -= this.pos - start; assert(this.budget.remaining >= 0 && c !== undefined);
    return this.text.slice(at, this.pos);
  }
  peek(): string { const at = this.pos; const token = this.token(); this.pos = at; return token; }
  value(depth = 0): Value {
    assert(depth <= 24); const t = this.token();
    if (t === '<<') {
      const result: Dict = Object.create(null); let count = 0;
      while (this.peek() !== '>>') { const key = this.token(); assert(key.startsWith('/') && ++count <= MAX_ITEMS && !(key in result)); result[key] = this.value(depth + 1); }
      this.token(); return result;
    }
    if (t === '[') {
      const result: Value[] = [];
      while (this.peek() !== ']') { assert(result.length < MAX_ITEMS); result.push(this.value(depth + 1)); }
      this.token(); return result;
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t)) {
      const number = Number(t); assert(Number.isFinite(number));
      const saved = this.pos;
      if (/^\d+$/.test(t) && /^\d+$/.test(this.peek())) {
        const generation = this.token(); if (this.peek() === 'R') { this.token(); return {ref: `${t} ${generation}`}; }
      }
      this.pos = saved; return number;
    }
    assert(t.startsWith('/') || t.startsWith('(') || t.startsWith('<') || ['true','false','null'].includes(t));
    return t;
  }
}

export function validPdfStructure(bytes: Uint8Array): boolean {
  // Latin-1 preserves offsets, bounded by the caller's 15 MB raw cap.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const budget = {remaining: MAX_METADATA};
  const parser = new PdfSyntax(text, budget);
  const objects = new Map<string, Value>();
  const objectStreams: {dict: Dict; data: Uint8Array}[] = [];
  let root: Value = null, xrefOffset = -1, objectCount = 0;
  while (true) {
    const token = parser.peek();
    if (token === 'xref') {
      parser.token(); xrefOffset = text.lastIndexOf('xref', parser.pos - 1);
      while (parser.peek() !== 'trailer') {
        const first = Number(parser.token()), count = Number(parser.token());
        assert(Number.isSafeInteger(first) && first >= 0 && Number.isSafeInteger(count) && count > 0 && count <= MAX_ITEMS);
        for (let i = 0; i < count; i++) {
          const offset = Number(parser.token()), generation = Number(parser.token()), kind = parser.token();
          assert(Number.isSafeInteger(offset) && Number.isSafeInteger(generation) && ['n','f'].includes(kind));
          if (kind === 'n') assert(text.startsWith(`${first + i} ${generation} obj`, offset));
        }
      }
      parser.token(); const trailer = dictionary(parser.value()); assert(!trailer['/Encrypt'] && !trailer['/Prev']); root = trailer['/Root'];
      break;
    }
    if (token === 'startxref') break;
    assert(++objectCount <= MAX_ITEMS);
    const id = parser.token(), offset = parser.pos - id.length, generation = parser.token();
    assert(/^\d+$/.test(id) && Number(id) > 0 && /^\d+$/.test(generation) && parser.token() === 'obj');
    const key = `${id} ${generation}`; assert(!objects.has(key));
    const value = parser.value(); objects.set(key, value);
    if (parser.peek() === 'stream') {
      parser.token(); const dict = dictionary(value), length = dict['/Length'];
      assert(typeof length === 'number' && Number.isSafeInteger(length) && length >= 0);
      if (text[parser.pos] === '\r') parser.pos++;
      assert(text[parser.pos++] === '\n');
      const end = parser.pos + (length as number); assert(end <= bytes.length);
      const data = bytes.subarray(parser.pos, end); parser.pos = end;
      assert(parser.token() === 'endstream');
      if (dict['/Type'] === '/ObjStm') objectStreams.push({dict, data});
      if (dict['/Type'] === '/XRef') {
        assert(!dict['/Encrypt'] && !dict['/Prev'] && !dict['/DecodeParms']);
        const size = dict['/Size'], widths = dict['/W'], indexes = dict['/Index'] ?? [0, size];
        assert(typeof size === 'number' && Number.isSafeInteger(size) && size > 0 && size <= MAX_ITEMS);
        assert(Array.isArray(widths) && widths.length === 3 && widths.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 4));
        assert(Array.isArray(indexes) && indexes.length > 0 && indexes.length <= MAX_ITEMS && indexes.length % 2 === 0);
        let entries = 0;
        for (let i = 0; i < (indexes as Value[]).length; i += 2) {
          const start = (indexes as number[])[i], count = (indexes as number[])[i + 1];
          assert(Number.isSafeInteger(start) && Number.isSafeInteger(count) && start >= 0 && count > 0 && start + count <= (size as number)); entries += count;
        }
        const row = (widths as number[]).reduce((sum, n) => sum + n, 0);
        assert(entries <= MAX_ITEMS && row > 0);
        const expected = entries * row;
        assert(!dict['/Filter'] || dict['/Filter'] === '/FlateDecode');
        const decoded = dict['/Filter'] ? inflateBounded(data, expected) : data;
        assert(decoded.length === expected); budget.remaining -= expected; assert(budget.remaining >= 0);
        root = dict['/Root']; xrefOffset = offset;
      }
    }
    assert(parser.token() === 'endobj');
  }
  assert(parser.token() === 'startxref');
  const startxref = Number(parser.token()); assert(startxref === xrefOffset && startxref >= 0);
  assert(/^\s*%%EOF\s*$/.test(text.slice(parser.pos)));
  let expanded = 0;
  for (const {dict, data} of objectStreams) {
    assert(dict['/Filter'] === '/FlateDecode' && !dict['/DecodeParms'] && !dict['/Extends']);
    const count = dict['/N'], first = dict['/First'];
    assert(typeof count === 'number' && Number.isSafeInteger(count) && count > 0 && objectCount + count <= MAX_ITEMS);
    assert(typeof first === 'number' && Number.isSafeInteger(first) && first > 0 && first <= 65536);
    const result = inflateBounded(data, Math.min(256 * 1024, MAX_METADATA - expanded));
    expanded += result.length;
    assert(expanded < MAX_METADATA && (first as number) < result.length);
    const contents = result.toString('latin1'), header = new PdfSyntax(contents.slice(0, first as number), budget);
    const entries: {id: string; offset: number}[] = [];
    for (let i = 0; i < (count as number); i++) {
      const id = header.token(), offset = Number(header.token());
      assert(/^\d+$/.test(id) && Number(id) > 0 && Number.isSafeInteger(offset) && offset >= 0 && (!i || offset > entries[i - 1].offset)); entries.push({id, offset});
    }
    assert(/^\s*$/.test(header.text.slice(header.pos)));
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], begin = (first as number) + entry.offset, end = i + 1 < entries.length ? (first as number) + entries[i + 1].offset : contents.length;
      assert(begin < end && end <= contents.length && !objects.has(`${entry.id} 0`));
      const syntax = new PdfSyntax(contents.slice(begin, end), budget), value = syntax.value();
      assert(/^\s*$/.test(syntax.text.slice(syntax.pos))); objects.set(`${entry.id} 0`, value); objectCount++;
    }
  }
  const resolve = (value: Value): Dict => { const ref = dictionary(value).ref; assert(typeof ref === 'string' && objects.has(ref)); return dictionary(objects.get(ref as string)!); };
  const catalog = resolve(root); assert(catalog['/Type'] === '/Catalog');
  const visited = new Set<string>(); let pages = 0;
  const walk = (ref: Value, media: Value, depth: number): number => {
    assert(depth <= 24); const key = dictionary(ref).ref as string; assert(!visited.has(key)); visited.add(key);
    const node = resolve(ref), box = node['/MediaBox'] ?? media;
    if (node['/Type'] === '/Page') {
      assert(Array.isArray(box) && box.length === 4 && box.every(n => typeof n === 'number' && Number.isFinite(n)));
      const coords = box as number[]; assert(coords[2] > coords[0] && coords[3] > coords[1] && coords[2] - coords[0] <= 14400 && coords[3] - coords[1] <= 14400);
      assert(++pages <= 1000); return 1;
    }
    assert(node['/Type'] === '/Pages' && Array.isArray(node['/Kids']));
    let total = 0; for (const child of node['/Kids'] as Value[]) total += walk(child, box, depth + 1);
    assert(total > 0 && node['/Count'] === total); return total;
  };
  walk(catalog['/Pages'], null, 0);
  return pages > 0;
}
