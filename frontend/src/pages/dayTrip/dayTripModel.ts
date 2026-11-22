/** [FR-061] ルートと寄り道の画面の計算(端末の中)。詳細設計 DD-2026-11-22-01 §4.1・§4.6 */
import type { AlongResult, DayTripLeg, Road } from '@/services/api/dayTrip';

/** place_finder.GENRES と同じ順(「すべて」を除く 14 種) */
export const GENRES: [string, string][] = [
  ['cafe', 'カフェ'], ['meal', '食事・ランチ'], ['japanese', '和食・郷土料理'], ['ramen', 'ラーメン・麺'], ['sweets', 'スイーツ・甘味'],
  ['izakaya', '居酒屋・夜ごはん'], ['sightseeing', '観光名所'], ['shrine', '神社・寺'], ['view', '景色・展望'], ['onsen', '温泉'],
  ['activity', '体験・遊び'], ['souvenir', '買い物・土産'], ['michinoeki', '道の駅'], ['hotel', '宿'],
];
export const ROAD_LABEL: Record<Road, string> = { highway: '高速', local: '下道', avoid_tolls: '有料を避ける', auto: 'おまかせ' };

export function durationText(seconds: number | null | undefined): string {
  if (seconds == null) return '時間 不明';
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}
export const kmText = (m: number | null | undefined) => (m == null ? '距離 不明' : `${Math.round(m / 100) / 10}km`);
export const tollText = (yen: number | null | undefined, road: Road) =>
  (yen == null ? (road === 'local' || road === 'avoid_tolls' ? '料金なし' : '料金 不明') : yen === 0 ? '料金なし' : `料金 約${yen.toLocaleString('ja-JP')}円`);

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  return (h ?? 0) * 60 + (m ?? 0);
}
export function toHhmm(min: number): string {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** 「ルートから 300m · 寄り道 +6分 · 12km 目」 */
export function rowLine(r: AlongResult): string {
  const off = r.off_m < 1000 ? `${r.off_m}m` : `${Math.round(r.off_m / 100) / 10}km`;
  return [`ルートから ${off}`, r.detour_min != null ? `寄り道 +${r.detour_min}分${r.exit_unknown ? '(高速を降りる場合 +約15分を含む)' : ''}` : null,
    `${r.at_km}km 目`].filter(Boolean).join(' · ');
}

export interface Added { key: string; leg: 'out' | 'back'; at_km: number; detour_min: number; stay_min: number }

/** その寄り道に着く見込み = 出発 + その点までの線の時間 + それより前の寄り道(寄り道の時間と滞在) */
export function arrivalAt(leg: DayTripLeg, totalKm: number, atKm: number, added: Added[]): string {
  const base = toMin(leg.depart_at);
  const along = totalKm > 0 && leg.duration_s ? (atKm / totalKm) * (leg.duration_s / 60) : 0;
  const before = added.filter((a) => a.leg === leg.leg && a.at_km < atKm).reduce((n, a) => n + a.detour_min + a.stay_min, 0);
  return toHhmm(base + along + before);
}

/** 家に着く見込み(帰りの到着 + 足した寄り道の分) */
export function homeEta(back: DayTripLeg | undefined, added: Added[]): string | null {
  if (!back?.depart_at || back.duration_s == null) return null;
  const extra = added.reduce((n, a) => n + a.detour_min + a.stay_min, 0);
  return toHhmm(toMin(back.depart_at) + back.duration_s / 60 + extra);
}

/** 「家に着く見込み 18:40(19:00 まで あと 20 分)」と越えたか */
export function etaText(eta: string | null, homeBy: string | null): { text: string; late: boolean } | null {
  if (!eta) return null;
  if (!homeBy) return { text: `家に着く見込み ${eta}`, late: false };
  const diff = toMin(homeBy) - toMin(eta);
  return diff >= 0 ? { text: `家に着く見込み ${eta}(${homeBy} まで あと ${diff} 分)`, late: false }
    : { text: `家に着く見込み ${eta}(${homeBy} を ${-diff} 分 過ぎます)`, late: true };
}

export const nextWidth = (w: number): number | null => ({ 300: 1000, 1000: 3000, 3000: 5000 } as Record<number, number>)[w] ?? null;

/** 比べる 2 つの道の使い方(選んでいる方と、もう片方) */
export function compareRoads(road: Road): [Road, Road] {
  if (road === 'local' || road === 'avoid_tolls') return [road, 'highway'];
  return [road, 'local'];
}
