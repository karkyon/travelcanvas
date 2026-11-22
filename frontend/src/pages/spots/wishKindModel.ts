/**
 * [FR-062] 行きたい場所の画面の札(今度・また・エリア)・残した元の文・地域でまとめる・近い順(端末の中だけ)。
 * 詳細設計 DD-2026-11-22-01 §7.1。wish_kind が無い今までの行は「今度行きたい」に数える。
 */
import type { WishSpot } from '@/services/api/spotIntake';

export type WishTab = 'all' | 'next' | 'again' | 'area';
export const WISH_TABS: [WishTab, string][] = [['all', 'すべて'], ['next', '今度行きたい'], ['again', 'また行きたい'], ['area', 'エリア']];
export const KIND_LABEL: Record<Exclude<WishTab, 'all'>, string> = { next: '今度行きたい', again: 'また行きたい', area: 'エリア' };
/** 地図の印の形(色だけで分けない): 今度 ♡・また ★・エリア ◯ */
export const KIND_MARK: Record<Exclude<WishTab, 'all'>, string> = { next: '♡', again: '★', area: '◯' };

export function kindOf(s: Pick<WishSpot, 'wish_kind' | 'wish_scope'>): Exclude<WishTab, 'all'> {
  if (s.wish_scope === 'area') return 'area';
  return s.wish_kind === 'again' ? 'again' : 'next';
}

export function kindCounts(list: WishSpot[]): Record<WishTab, number> {
  const c: Record<WishTab, number> = { all: list.length, next: 0, again: 0, area: 0 };
  for (const s of list) c[kindOf(s)] += 1;
  return c;
}

const md = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `(${d.getMonth() + 1}/${d.getDate()})`;
};

/** 残した元の 1 行(例: 「伊勢・おかげ横丁の旅(11/28)の当日に保存 · 『時間がなくて行けず』」) */
export function sourceText(s: WishSpot): string | null {
  const label = s.source_label ?? null;
  const parts: string[] = [];
  switch (s.source_kind) {
    case 'today': parts.push(label ? `${label}${md(s.created_at)}の当日に保存` : '旅の当日に保存'); break;
    case 'route': parts.push(label ? `日帰り『${label}』のルートから保存` : '日帰りのルートから保存'); break;
    case 'visit': case 'memory': parts.push(label ? `${label}の記録から保存` : '旅の記録から保存'); break;
    case 'sns': parts.push('SNS から保存'); break;
    case 'import': parts.push('取り込みで保存'); break;
    case 'quick': parts.push('♡ で保存'); break;
    default: break;
  }
  if (s.wish_note) parts.push(`『${s.wish_note}』`);
  if ((s.again_count ?? 0) > 0) parts.push(`また行きたい ${s.again_count} 回`);
  return parts.length ? parts.join(' · ') : null;
}

const PREF = /(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/;
const CITY = /(.+?[市区町村郡])/;
/** 住所の都道府県・市区町村(見出し)。住所が無い時は「住所なし」 */
export function regionOf(address: string | null | undefined): string {
  const a = (address ?? '').replace(/^〒?\s*\d{3}-?\d{4}\s*/, '').replace(/^日本[、,\s]*/, '').trim();
  if (!a) return '住所なし';
  const p = PREF.exec(a);
  if (!p) return a.split(/[\s,、]/)[0] || '住所なし';
  const rest = a.slice((p.index ?? 0) + p[1]!.length);
  const c = CITY.exec(rest);
  return c ? `${p[1]} ${c[1]}` : p[1]!;
}

export function groupByRegion(list: WishSpot[]): { region: string; items: WishSpot[] }[] {
  const m = new Map<string, WishSpot[]>();
  for (const s of list) {
    const r = regionOf(s.address);
    m.set(r, [...(m.get(r) ?? []), s]);
  }
  return [...m.entries()].sort(([a], [b]) => (a === '住所なし' ? 1 : b === '住所なし' ? -1 : a.localeCompare(b, 'ja')))
    .map(([region, items]) => ({ region, items }));
}

const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** 近い順(位置はサーバーに送らない。位置の無い場所は最後) */
export function sortNear(list: WishSpot[], here: { lat: number; lng: number }): WishSpot[] {
  const d = (s: WishSpot) => (s.latitude != null && s.longitude != null ? distanceM(here.lat, here.lng, s.latitude, s.longitude) : Infinity);
  return [...list].sort((a, b) => d(a) - d(b));
}

/** ここから日帰り: 新しい旅行の画面を日帰りで、この場所を目的地にして開く */
export const dayTripHref = (id: string) => `/planner?new=1&mode=day&spot=${encodeURIComponent(id)}`;
