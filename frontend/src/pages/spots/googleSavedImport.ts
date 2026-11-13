/**
 * [Gate GoogleSavedImport] Google マップの保存リスト(「行ってみたい」「お気に入り」など)を「行きたい場所」へ取り込む。
 *
 * 読むもの(Google データ エクスポート = Takeout の書き出し。この端末の中だけで読み、ファイルはサーバーへ送らない):
 * - 「保存済み(Saved)」の CSV(リスト 1 つに 1 ファイル。列は Title・Note・URL・Tags・Comment)
 * - 「マップ(マイプレイス)」の「保存した場所(Saved Places).json」(GeoJSON。位置・住所つき)
 * - 上の 2 つを含む Takeout の ZIP(中の .csv・.json を読む)
 * 位置は URL に書かれている時だけ使う(@緯度,経度・!3d緯度!4d経度・/search/緯度,経度・?q=緯度,経度)。推測しない。
 */

export interface ImportRow {
  key: string;
  name: string;
  note: string | null;
  url: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** どのリストか(ファイルの名前) */
  list: string;
  /** 「行きたい場所」に同じ場所があれば、その ID */
  duplicateOf: string | null;
}

export interface ExistingSpot {
  id: string; name: string; latitude: number | null; longitude: number | null; urls?: { url: string }[] | null;
}

const NAME_MAX = 200;
const NOTE_MAX = 2000;

/** CSV を行と列に(引用符・引用符の中の改行・"" の引用符・先頭の BOM に対応) */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function okPoint(lat: number | null, lng: number | null): [number, number] | null {
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return [lat, lng];
}

/** Google マップの URL に書かれた位置(無ければ null) */
export function coordsFromUrl(url: string | null | undefined): [number, number] | null {
  if (!url) return null;
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* そのまま */ }
  const pats = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /\/search\/(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/,
  ];
  for (const p of pats) {
    const m = p.exec(u);
    if (m) {
      const pt = okPoint(num(m[1]), num(m[2]));
      if (pt) return pt;
    }
  }
  return null;
}

/** URL の /place/<名前>/ から名前(題名が空の時だけ使う) */
export function nameFromUrl(url: string | null | undefined): string | null {
  const m = url ? /\/place\/([^/?#@]+)/.exec(url) : null;
  if (!m) return null;
  try {
    const n = decodeURIComponent(m[1]!.replace(/\+/g, ' ')).trim();
    return n || null;
  } catch {
    return null;
  }
}

const cleanUrl = (u: string | null | undefined): string | null => {
  const s = (u ?? '').trim();
  return /^https?:\/\//i.test(s) && s.length <= 2000 ? s : null;
};

const listName = (fileName: string) => fileName.replace(/^.*[\\/]/, '').replace(/\.(csv|json)$/i, '');

function row(list: string, i: number, name: string | null, note: string | null, url: string | null, address: string | null,
  point: [number, number] | null): ImportRow | null {
  const p = point ?? coordsFromUrl(url);
  // 名前の無い「ピン」は位置を名前にする(位置も無ければ取り込まない)
  const n = (name ?? '').trim() || nameFromUrl(url) || (address ?? '').trim()
    || (p ? `地図のピン(${p[0].toFixed(4)}, ${p[1].toFixed(4)})` : '');
  if (!n) return null;
  return {
    key: `${list}#${i}`, name: n.slice(0, NAME_MAX), note: (note ?? '').trim().slice(0, NOTE_MAX) || null, url: cleanUrl(url),
    address: (address ?? '').trim().slice(0, 500) || null, latitude: p?.[0] ?? null, longitude: p?.[1] ?? null, list,
    duplicateOf: null,
  };
}

/** 保存済み(Saved)の CSV → 行。見出しの名前で列を探す(英語・日本語) */
export function rowsFromCsv(text: string, fileName: string): ImportRow[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return [];
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ti = col('title', 'タイトル', '名前', 'name');
  const ni = col('note', 'メモ', 'notes');
  const ui = col('url', 'google maps url');
  const ci = col('comment', 'コメント');
  if (ti < 0 && ui < 0) return [];
  const list = listName(fileName);
  const out: ImportRow[] = [];
  rows.slice(1).forEach((r, i) => {
    const note = [ni >= 0 ? r[ni] : '', ci >= 0 ? r[ci] : ''].map((x) => (x ?? '').trim()).filter(Boolean).join('\n');
    const x = row(list, i, ti >= 0 ? r[ti] ?? null : null, note, ui >= 0 ? r[ui] ?? null : null, null, null);
    if (x) out.push(x);
  });
  return out;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 保存した場所(Saved Places).json(GeoJSON。新しい形・古い形の両方) → 行 */
export function rowsFromJson(text: string, fileName: string): ImportRow[] {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return []; }
  const features = Array.isArray(obj(data).features) ? obj(data).features as unknown[] : [];
  const list = listName(fileName);
  const out: ImportRow[] = [];
  features.forEach((f, i) => {
    const p = obj(obj(f).properties);
    const loc = obj(p.location ?? p.Location);
    const geo = obj(loc['Geo Coordinates']);
    const coords = obj(obj(f).geometry).coordinates;
    let point: [number, number] | null = null;
    if (Array.isArray(coords) && coords.length >= 2) point = okPoint(num(String(coords[1])), num(String(coords[0])));
    if (!point) point = okPoint(num(str(geo.Latitude) ?? undefined), num(str(geo.Longitude) ?? undefined));
    const name = str(loc.name) ?? str(loc['Business Name']) ?? str(p.Title) ?? str(p.title);
    const address = str(loc.address) ?? str(loc.Address);
    const url = str(p.google_maps_url) ?? str(p['Google Maps URL']);
    const note = str(p.Comment) ?? str(p.comment) ?? str(p.Note);
    const x = row(list, i, name, note, url, address, point);
    if (x) out.push(x);
  });
  return out;
}

// ===== ZIP(Takeout)。ブラウザの DecompressionStream で中の .csv・.json だけを読む =====

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw new Error('unsupported');
  const body = new Response(data as BodyInit).body;
  if (!body) throw new Error('unsupported');
  const stream = body.pipeThrough(new DS('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP の中の .csv・.json(名前と中身の文字) */
export async function readZipTexts(buf: ArrayBuffer): Promise<{ name: string; text: string }[]> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not_zip');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out: { name: string; text: string }[] = [];
  for (let n = 0; n < count && p + 46 <= bytes.length; n += 1) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(csv|json)$/i.test(name) || csize > 20 * 1024 * 1024) continue;
    if (v.getUint32(local, true) !== 0x04034b50) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    const body = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (body) out.push({ name, text: dec.decode(body) });
  }
  return out;
}

function rowsFromText(name: string, text: string): ImportRow[] {
  return /\.json$/i.test(name) ? rowsFromJson(text, name) : rowsFromCsv(text, name);
}

/** ファイルの中身(古いブラウザ・試験の環境では FileReader で読む) */
function readFile(f: File, as: 'text' | 'buffer'): Promise<string | ArrayBuffer> {
  if (as === 'text' && typeof f.text === 'function') return f.text();
  if (as === 'buffer' && typeof f.arrayBuffer === 'function') return f.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string | ArrayBuffer);
    r.onerror = () => reject(r.error);
    if (as === 'text') r.readAsText(f); else r.readAsArrayBuffer(f);
  });
}

export interface ReadResult { rows: ImportRow[]; files: string[]; skipped: string[] }

/** 選んだファイル(.csv・.json・.zip)を読む。読めないファイルは skipped に */
export async function readImportFiles(files: File[]): Promise<ReadResult> {
  const rows: ImportRow[] = [];
  const used: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    try {
      const parts = /\.zip$/i.test(f.name) || f.type === 'application/zip'
        ? await readZipTexts(await readFile(f, 'buffer') as ArrayBuffer)
        : [{ name: f.name, text: await readFile(f, 'text') as string }];
      let got = 0;
      for (const part of parts) {
        const r = rowsFromText(part.name, part.text);
        if (r.length) { rows.push(...r); used.push(listName(part.name)); got += r.length; }
      }
      if (!got) skipped.push(f.name);
    } catch {
      skipped.push(f.name);
    }
  }
  return { rows: dedupeRows(rows), files: used, skipped };
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s・·\-‐–—()（）「」『』]/g, '');

function meters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 取り込むファイルの中の重複(同じ URL か、同じ名前で近い位置)を 1 つにまとめる(リストの名前は足す) */
export function dedupeRows(rows: ImportRow[]): ImportRow[] {
  const out: ImportRow[] = [];
  for (const r of rows) {
    const same = out.find((o) => (r.url && o.url === r.url) || (norm(o.name) === norm(r.name)
      && (o.latitude === null || r.latitude === null || meters([o.latitude, o.longitude!], [r.latitude, r.longitude!]) < 150)));
    if (!same) { out.push({ ...r }); continue; }
    if (!same.list.split('・').includes(r.list)) same.list = `${same.list}・${r.list}`;
    same.note = same.note ?? r.note;
    same.address = same.address ?? r.address;
    if (same.latitude === null && r.latitude !== null) { same.latitude = r.latitude; same.longitude = r.longitude; }
    same.url = same.url ?? r.url;
  }
  return out;
}

/** 「行きたい場所」に既にある場所(同じ URL・同じ名前で 150m 以内・位置が無ければ同じ名前)に印を付ける */
export function markDuplicates(rows: ImportRow[], spots: ReadonlyArray<ExistingSpot>): ImportRow[] {
  return rows.map((r) => {
    const hit = spots.find((s) => (r.url && (s.urls ?? []).some((u) => u.url === r.url))
      || (norm(s.name) === norm(r.name) && (r.latitude === null || s.latitude === null || s.longitude === null
        || meters([r.latitude, r.longitude!], [s.latitude, s.longitude]) < 150)));
    return { ...r, duplicateOf: hit ? hit.id : null };
  });
}
