/**
 * [Gate SpotFind] 写真・SNS から探すための純粋関数(画面から切り離して試験する)。
 *
 * - 写真: JPEG の Exif の GPS(撮った場所の緯度経度)を端末の中で読む。写真そのものはサーバーへ送らない
 * - SNS: 貼り付けた投稿の文から、ハッシュタグ・「」『』の中・位置の印(ピン)の後ろ・「〇〇へ/に行った」の地名らしい語を拾う。
 *   URL の中身は取りに行かない(SNS の利用規約・個人の投稿を集めないため)。URL だけの時は文を貼るよう案内する
 */

export interface GpsPoint { latitude: number; longitude: number; takenAt: string | null }

function ascii(view: DataView, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && off + i < view.byteLength; i += 1) {
    const c = view.getUint8(off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** JPEG(ArrayBuffer)の Exif から GPS を読む。無い・壊れている時は null */
export function readExifGps(buf: ArrayBuffer): GpsPoint | null {
  return readExifInfo(buf).gps;
}

/** [Gate PhotoMap] 撮影位置と撮影日時を別々に読む(位置を消しても日時は残るブラウザがある)。読むのは JPEG だけ */
export function readExifInfo(buf: ArrayBuffer): { gps: GpsPoint | null; takenAt: string | null } {
  const none = { gps: null, takenAt: null };
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return none;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && ascii(v, off + 4, 4) === 'Exif') return parseTiff(v, off + 10);
    if ((marker & 0xff00) !== 0xff00 || size < 2) return none;
    off += 2 + size;
  }
  return none;
}

/** Exif の "2026:04:10 15:12:00"(端末の時刻)を ISO にする。読めない時は null */
export function exifTimeToIso(value: string | null): string | null {
  const m = value?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  return Number.isNaN(d.getTime()) || +m[1]! < 2000 ? null : d.toISOString();
}

function parseTiff(v: DataView, base: number): { gps: GpsPoint | null; takenAt: string | null } {
  const none = { gps: null, takenAt: null };
  if (base + 8 > v.byteLength) return none;
  const little = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, little);
  const u32 = (o: number) => v.getUint32(base + o, little);
  const ifd0 = u32(4);
  let gpsOff = 0;
  let exifOff = 0;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i += 1) {
    const e = ifd0 + 2 + i * 12;
    if (base + e + 12 > v.byteLength) return none;
    const tag = u16(e);
    if (tag === 0x8825) gpsOff = u32(e + 8);
    if (tag === 0x8769) exifOff = u32(e + 8);
  }
  let takenAt: string | null = null;
  if (exifOff) {
    const m = u16(exifOff);
    for (let i = 0; i < m; i += 1) {
      const e = exifOff + 2 + i * 12;
      if (base + e + 12 > v.byteLength) break;
      if (u16(e) === 0x9003) takenAt = ascii(v, base + u32(e + 8), 19) || null;  // DateTimeOriginal
    }
  }
  if (!gpsOff) return { gps: null, takenAt };
  const rational = (o: number) => { const d = u32(o + 4); return d ? u32(o) / d : 0; };
  const triple = (o: number) => rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600;
  let latRef = 'N';
  let lonRef = 'E';
  let lat: number | null = null;
  let lon: number | null = null;
  const n = u16(gpsOff);
  for (let i = 0; i < n; i += 1) {
    const e = gpsOff + 2 + i * 12;
    if (base + e + 12 > v.byteLength) break;
    const tag = u16(e);
    if (tag === 1) latRef = ascii(v, base + e + 8, 1);
    if (tag === 3) lonRef = ascii(v, base + e + 8, 1);
    if (tag === 2) lat = triple(u32(e + 8));
    if (tag === 4) lon = triple(u32(e + 8));
  }
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return { gps: null, takenAt };
  if (latRef === 'S') lat = -lat;
  if (lonRef === 'W') lon = -lon;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { gps: null, takenAt };
  return { gps: { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lon * 1e6) / 1e6, takenAt }, takenAt };
}

const URL_RE = /https?:\/\/\S+/g;
const STOP = new Set(['旅行', '旅', '観光', '国内旅行', '女子旅', 'カフェ巡り', 'グルメ', '絶景', '写真好きな人と繋がりたい',
  'travel', 'trip', 'japan', 'instagood', 'photo', 'love', 'follow', '休日', '週末', '日帰り', '一人旅', '家族旅行']);

/** SNS の投稿の文から探す言葉の候補(最大 8)。URL は除く */
export function snsKeywords(text: string): { keywords: string[]; urlOnly: boolean } {
  const urls = text.match(URL_RE) ?? [];
  const body = text.replace(URL_RE, ' ');
  const out: string[] = [];
  const push = (w: string) => {
    const t = w.replace(/[_＿]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length < 2 || t.length > 30 || STOP.has(t.toLowerCase()) || /^\d+$/.test(t)) return;
    if (!out.includes(t)) out.push(t);
  };
  for (const m of body.matchAll(/[#＃]([^\s#＃、。,.!！?？()（）「」]+)/g)) push(m[1] ?? '');
  for (const m of body.matchAll(/[「『]([^」』]{2,30})[」』]/g)) push(m[1] ?? '');
  for (const m of body.matchAll(/(?:\u{1F4CD}|\u{1F4CC}|場所[:：]|at\s)\s*([^\s、。,\n]{2,30})/gu)) push(m[1] ?? '');
  for (const m of body.matchAll(/([一-龯ァ-ヶー]{2,15})(?:へ|に)(?:行って|行った|来た|きた|お出かけ|旅行)/g)) push(m[1] ?? '');
  return { keywords: out.slice(0, 8), urlOnly: out.length === 0 && urls.length > 0 && !body.trim() };
}

/** [Gate BookingFix] 説明欄・コメントの「01:20 内宮入口.宇治橋」の行から場所の名前を拾う */
export function spotsFromTimeline(text: string): { name: string; note: string | null }[] {
  const out: { name: string; note: string | null }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().normalize('NFKC').match(/^(?:\d{1,2}:)?\d{1,2}:\d{2}\s*[-–:]?\s*(.+)$/);
    if (!m) continue;
    const parts = m[1]!.split(/[.。・/|]/).map((p) => p.trim()).filter((p) => p && !/^(start|end|スタート|ゴール|opening|ending)$/i.test(p));
    if (parts.length === 0 || parts[0]!.length > 40) continue;
    if (!out.some((o) => o.name === parts[0])) out.push({ name: parts[0]!, note: parts.slice(1).join(' / ') || null });
  }
  return out;
}

export type FindModeKey = 'image' | 'voice' | 'sns';
export const FIND_MODE_HELP: Record<FindModeKey, string> = {
  image: '写真の撮影場所(位置情報)から、その周りの場所を探します。写真は端末の中で読み、送りません。',
  voice: '行きたい場所を話すと、文字にしてその言葉で探します。録音は保存しません。',
  sns: 'SNS の投稿の文(ハッシュタグ・場所の名前)を貼ると、探す言葉を拾います。URL の中身は取りに行きません。',
};
