/**
 * [Gate MemoryReel] 旅の思い出リールの表示の計算(純粋関数。reelModel.test.ts で確かめる)。
 *
 * - コマ(frame): 写真があれば写真を撮った順。無ければ予定の名前。どちらも無ければ旅行名の 1 コマ
 * - 経路の地図: 位置のある写真を撮った順に結ぶ(地図の絵は使わず、緯度・経度だけで形を描く)
 */
import type { MemoryReelData } from '@/services/api/memoryReel';

/** 1 コマを見せる時間(ミリ秒) */
export const FRAME_MS = 4500;

const WEEK = '日月火水木金土';

function ymd(iso: string | null | undefined): { y: number; m: number; d: number; w: string } | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { y, m: mo, d, w: WEEK[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]! };
}

/** "2025-08-09T06:12" → "8/9(土) 6:12"(時刻が無ければ日付だけ) */
export function formatWhen(localAt: string | null | undefined, time?: string | null): string | null {
  const d = ymd(localAt);
  if (!d) return null;
  const t = time ?? (localAt && localAt.length >= 16 ? localAt.slice(11, 16) : null);
  const hm = t ? ` ${Number(t.slice(0, 2))}:${t.slice(3, 5)}` : '';
  return `${d.m}/${d.d}(${d.w})${hm}`;
}

/** 旅の期間 "2025年8月9日〜10日" / "2025年8月30日〜9月1日" / "2025年12月31日〜2026年1月1日" */
export function reelDateRange(start: string | null, end: string | null): string | null {
  const s = ymd(start);
  if (!s) return null;
  const head = `${s.y}年${s.m}月${s.d}日`;
  const e = ymd(end);
  if (!e || (e.y === s.y && e.m === s.m && e.d === s.d)) return head;
  if (e.y !== s.y) return `${head}〜${e.y}年${e.m}月${e.d}日`;
  return e.m !== s.m ? `${head}〜${e.m}月${e.d}日` : `${head}〜${e.d}日`;
}

/** "2025-08-09" → "2025年8月" */
export function monthLabel(start: string | null | undefined): string | null {
  const s = ymd(start);
  return s ? `${s.y}年${s.m}月` : null;
}

/** 日数の言い方: 日帰り / 1泊2日 */
export function stayText(days: number): string | null {
  if (days < 1) return null;
  return days === 1 ? '日帰り' : `${days - 1}泊${days}日`;
}

export interface ReelFrame {
  key: string;
  /** 写真のコマだけ */
  memoryId: string | null;
  title: string;
  /** 「8/9(土) 6:12 · 二見興玉神社」 */
  sub: string | null;
  body: string | null;
  /** 撮った順の何枚目か(写真のコマだけ。経路の地図で今の点を探す) */
  photoIndex: number | null;
}

export function framesOf(data: MemoryReelData): ReelFrame[] {
  if (data.slides.length > 0) {
    return data.slides.map((s, i) => {
      const when = formatWhen(s.local_at);
      const place = s.place_name && s.place_name !== s.title ? s.place_name : null;
      return {
        key: s.memory_id, memoryId: s.memory_id, photoIndex: i,
        title: s.title || place || `${i + 1}枚目の写真`,
        sub: [when, place].filter(Boolean).join(' · ') || null,
        body: s.body,
      };
    });
  }
  if (data.fallback_events.length > 0) {
    return data.fallback_events.map((e, i) => ({
      key: `event-${i}`, memoryId: null, photoIndex: null, title: e.title,
      sub: formatWhen(e.local_date, e.local_time), body: null,
    }));
  }
  return [{ key: 'trip', memoryId: null, photoIndex: null, title: data.title,
    sub: reelDateRange(data.start_date, data.end_date), body: null }];
}

export interface RoutePoint { x: number; y: number; photoIndex: number }
export interface ReelRoute { points: RoutePoint[]; width: number; height: number }

/**
 * 位置のある写真を撮った順に、幅 100・高さ 62 の箱へ縦横比を保って収める(上が北)。
 * 位置が 2 か所未満(同じ場所だけを含む)なら null。
 */
export function routeOf(slides: MemoryReelData['slides'], width = 100, height = 62, pad = 7): ReelRoute | null {
  const raw = slides
    .map((s, i) => (s.latitude != null && s.longitude != null ? { lat: s.latitude, lng: s.longitude, i } : null))
    .filter((p): p is { lat: number; lng: number; i: number } => p !== null);
  if (raw.length < 2) return null;
  const meanLat = raw.reduce((a, p) => a + p.lat, 0) / raw.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const xs = raw.map((p) => p.lng * k);
  const ys = raw.map((p) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 1e-6 && spanY < 1e-6) return null;
  const scale = Math.min((width - pad * 2) / (spanX || 1e-9), (height - pad * 2) / (spanY || 1e-9));
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    width, height,
    points: raw.map((p, j) => ({
      x: round(offX + (xs[j]! - minX) * scale),
      y: round(offY + (maxY - ys[j]!) * scale),
      photoIndex: p.i,
    })),
  };
}

/** 今のコマの位置: その写真に位置が無ければ、それより前で一番近い点(無ければ最初の点) */
export function currentPoint(route: ReelRoute, photoIndex: number | null): RoutePoint {
  if (photoIndex == null) return route.points[0]!;
  let found = route.points[0]!;
  for (const p of route.points) {
    if (p.photoIndex <= photoIndex) found = p;
    else break;
  }
  return found;
}

/** 終わりの画面の数(写真・行った場所・一緒に行った人)。0 の物は出さない */
export function recapStats(data: MemoryReelData): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (data.photo_count > 0) out.push({ label: '写真', value: String(data.photo_count) });
  if (data.place_count > 0) out.push({ label: '行った場所', value: String(data.place_count) });
  if (data.note_count > 0) out.push({ label: 'メモ', value: String(data.note_count) });
  if (data.member_count > 1) out.push({ label: '一緒に', value: `${data.member_count}人` });
  return out;
}

/**
 * 「同じ場所でもう一度計画する」の行き先の続き("&destination=…")。新しい旅行の画面に行き先を入れて開く。
 * 使う側は `/planner?new=1${replanQuery(…)}` と固定のパスに続ける(移動先の安全の検査で固定のアプリ内パスと分かるように)
 */
export function replanQuery(data: { destination: string | null | undefined }): string {
  const dest = data.destination?.trim();
  return dest ? `&destination=${encodeURIComponent(dest)}` : '';
}
