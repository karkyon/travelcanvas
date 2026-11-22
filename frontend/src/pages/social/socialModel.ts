/**
 * [FR-063] SNS の下書きとリールの計算(純粋関数)。詳細設計 DD-2026-11-22-01 §8.2・§8.4。
 */
export type Style = 'tiktok' | 'ig_reels' | 'shorts' | 'instagram' | 'x' | 'line';
export const STYLES: [Style, string][] = [
  ['tiktok', 'TikTok'], ['ig_reels', 'Instagram リール'], ['shorts', 'YouTube ショート'], ['instagram', 'Instagram(投稿)'],
  ['x', 'X'], ['line', 'LINE・メッセージ'],
];
export const REEL_STYLES: Style[] = ['tiktok', 'ig_reels', 'shorts'];
export const isReel = (s: Style) => REEL_STYLES.includes(s);
export type Template = 'flow' | 'simple' | 'map_first';
export const TEMPLATES: [Template, string][] = [['flow', '旅の流れ'], ['simple', 'シンプル'], ['map_first', '地図から始める']];
export const DURATIONS = [15, 30, 60] as const;

export const REEL_W = 1080;
export const REEL_H = 1920;
/** TikTok 等の画面の部品と重ならない範囲: 上 12%・下 22%・右 15% を避ける(左は 5% の余白) */
export const SAFE = { top: 0.12, bottom: 0.22, right: 0.15, left: 0.05 } as const;

export function safeRect(w = REEL_W, h = REEL_H): { x: number; y: number; w: number; h: number } {
  const x = Math.round(w * SAFE.left);
  const y = Math.round(h * SAFE.top);
  return { x, y, w: Math.round(w * (1 - SAFE.left - SAFE.right)), h: Math.round(h * (1 - SAFE.top - SAFE.bottom)) };
}

/** 1 コマの時間(秒): 長さを枚数で割り、1.5〜4 秒に収める */
export function frameSeconds(durationS: number, frames: number): number {
  if (frames <= 0) return 0;
  return Math.min(4, Math.max(1.5, durationS / frames));
}

/** 作る動画の本当の長さ(表紙 + 写真 + 地図のコマ + 最後のコマ。60 秒を超えない) */
export function plannedSeconds(durationS: number, photos: number, withMap: boolean): number {
  const per = frameSeconds(durationS, photos);
  return Math.min(60, Math.round((per * photos + (withMap ? 2 : 0) + 2) * 10) / 10);
}

/** 録る形式の順(iOS Safari・新しい Chrome は MP4) */
export const MIME_ORDER = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
export function pickMime(isSupported: (m: string) => boolean): { mime: string; ext: 'mp4' | 'webm'; mp4: boolean } | null {
  const m = MIME_ORDER.find((x) => { try { return isSupported(x); } catch { return false; } });
  if (!m) return null;
  const mp4 = m.startsWith('video/mp4');
  return { mime: m, ext: mp4 ? 'mp4' : 'webm', mp4 };
}
export const WEBM_NOTE = 'この端末では WebM になります。TikTok のアプリに入れられない時は、パソコンの Chrome か iPhone で作ってください';
export const MUSIC_NOTE = '音楽は TikTok・Instagram のアプリで付けてください';

/** 画質: 8Mbps。60 秒で約 60MB を超えたら 5Mbps で作り直す */
export const BITRATE_HIGH = 8_000_000;
export const BITRATE_LOW = 5_000_000;
export const MAX_BYTES = 60 * 1024 * 1024;

/** 字数の目安 */
export const CHAR_LIMIT: Record<Style, number> = { tiktok: 4000, ig_reels: 2200, shorts: 5000, instagram: 2200, x: 140, line: 1000 };
export function charInfo(text: string, style: Style): { count: number; limit: number; over: boolean; note: string | null } {
  const count = [...text].length;
  const limit = CHAR_LIMIT[style];
  return { count, limit, over: count > limit, note: style === 'tiktok' ? '画面に出るのは最初の 2 行ほど' : null };
}

/** ハッシュタグの札: 押すと入れたり外したりする(文の最後の行) */
export function toggleTag(text: string, tag: string): string {
  const lines = text.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const tags = last.split(/\s+/).filter((t) => t.startsWith('#'));
  const isTagLine = tags.length > 0 && tags.length === last.trim().split(/\s+/).length;
  if (isTagLine) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    lines[lines.length - 1] = next.join(' ');
    return (next.length ? lines : lines.slice(0, -1)).join('\n');
  }
  return `${text}${text ? '\n' : ''}${tag}`;
}
export const hasTag = (text: string, tag: string) => text.split(/\s+/).includes(tag);

/** 写真の枚数の範囲(リール 3〜20・投稿 1〜10) */
export const photoRange = (s: Style): [number, number] => (isReel(s) ? [3, 20] : [1, 10]);

export function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Ken Burns(1.00 → 1.08)と切り替えの重ね(0.3 秒)の不透明度 */
export function zoomAt(t: number, per: number): number { return 1 + 0.08 * Math.min(1, Math.max(0, t / per)); }
export function fadeAt(t: number, per: number, fade = 0.3): number {
  if (t < fade) return t / fade;
  if (t > per - fade) return Math.max(0, (per - t) / fade);
  return 1;
}
