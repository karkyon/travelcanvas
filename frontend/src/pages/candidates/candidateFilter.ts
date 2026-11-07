/**
 * [Gate CandidateFilters] 候補箱の絞り込み・並べ替え(画面の中だけで行う。サーバーへは送らない)。
 *
 * 参考にしたもの: Google マップの「保存済み」(リストとラベル・地図の距離)、食べログ・ホットペッパー(エリア・ジャンルの絞り込みと
 * 並べ替え)、じゃらん(エリアの段階の絞り込み)、Wanderlog(行きたい場所のカテゴリ・距離順)、Notion・Pinterest(タグ・表示の切り替え)。
 */
import type { PlanCandidateItem } from '@/services/api';

export type StatusFilter = 'active' | 'open' | 'scheduled' | 'dismissed' | 'all';
export type SortKey = 'priority' | 'new' | 'name' | 'distance';
export type KindKey = 'food' | 'sight' | 'shop' | 'stay' | 'activity' | 'move' | 'other';

export const KIND_LABEL: Record<KindKey, string> = {
  food: '食事・カフェ', sight: '観光・名所', shop: '買い物・市場', stay: '宿', activity: '体験・遊ぶ', move: '交通', other: 'その他',
};
const KIND_WORDS: Array<[KindKey, RegExp]> = [
  ['food', /restaurant|cafe|food|dining|bar|pub|fast_food|bakery|ice_cream|食|料理|カフェ|喫茶|レストラン|ラーメン|寿司|居酒屋|スイーツ/i],
  ['stay', /hotel|hostel|guest_house|motel|accommodation|ryokan|camp|宿|ホテル|旅館|民宿/i],
  ['shop', /shop|market|mall|store|souvenir|shopping|marketplace|買い物|市場|店|土産|商店|マルシェ/i],
  ['activity', /aquarium|zoo|theme_park|spa|onsen|activity|leisure|sports|温泉|水族館|動物園|体験|遊園地/i],
  ['move', /station|airport|ferry|bus|parking|transport|駅|空港|港|駐車/i],
  ['sight', /tourism|attraction|museum|castle|shrine|temple|park|viewpoint|sightseeing|historic|monument|garden|wikipedia|神社|寺|城|美術館|博物館|公園|名所|絶景|展望/i],
];

export function kindOf(c: Pick<PlanCandidateItem, 'category' | 'title'>): KindKey {
  const text = `${c.category ?? ''} ${c.title}`;
  return KIND_WORDS.find(([, re]) => re.test(c.category ?? ''))?.[0] ?? KIND_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'other';
}

const PREF = '(北海道|東京都|京都府|大阪府|[^\\s都道府県]{2,3}県)';
/** 住所のエリア(市区町村。無ければ都道府県)。住所が無ければ null */
export function areaOf(address: string | null | undefined): string | null {
  const a = (address ?? '').replace(/^〒?\s*\d{3}-?\d{4}\s*/, '').trim();
  if (!a) return null;
  const m = new RegExp(`^${PREF}?\\s*(.+?郡.+?[町村]|.+?市|.+?区|.+?[町村])`).exec(a);
  if (m?.[2] && m[2].length <= 10) return m[2];
  return new RegExp(`^${PREF}`).exec(a)?.[1] ?? null;
}

export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number | null; longitude: number | null }): number | null {
  if (b.latitude === null || b.longitude === null) return null;
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface CandidateFilter {
  q: string;
  status: StatusFilter;
  kinds: KindKey[];
  areas: string[];
  tags: string[];
  priority: number | null;
  sort: SortKey;
}
export const EMPTY_FILTER: CandidateFilter = { q: '', status: 'active', kinds: [], areas: [], tags: [], priority: null, sort: 'priority' };

export function isFiltered(f: CandidateFilter): boolean {
  return !!f.q.trim() || f.status !== 'active' || f.kinds.length > 0 || f.areas.length > 0 || f.tags.length > 0 || f.priority !== null;
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

export function applyFilter(items: PlanCandidateItem[], f: CandidateFilter,
  base?: { latitude: number; longitude: number } | null): PlanCandidateItem[] {
  const q = norm(f.q.trim());
  const out = items.filter((c) => {
    if (f.status === 'active' && c.status === 'dismissed') return false;
    if (f.status !== 'active' && f.status !== 'all' && c.status !== f.status) return false;
    if (f.kinds.length && !f.kinds.includes(kindOf(c))) return false;
    if (f.areas.length && !f.areas.includes(areaOf(c.address) ?? '住所なし')) return false;
    if (f.tags.length && !f.tags.every((t) => (c.tags ?? []).includes(t))) return false;
    if (f.priority !== null && c.priority !== f.priority) return false;
    if (q) {
      const hay = norm([c.title, c.note, c.address, c.source_label, c.created_by, ...(c.tags ?? [])].filter(Boolean).join(' '));
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const by: Record<SortKey, (a: PlanCandidateItem, b: PlanCandidateItem) => number> = {
    priority: (a, b) => a.priority - b.priority || (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    new: (a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    name: (a, b) => a.title.localeCompare(b.title, 'ja'),
    distance: (a, b) => {
      if (!base) return 0;
      const da = distanceKm(base, a) ?? Infinity;
      const db = distanceKm(base, b) ?? Infinity;
      return da - db;
    },
  };
  return [...out].sort(by[f.sort]);
}

/** 絞り込みの選択肢(件数つき)。候補にある値だけを出す */
export function facets(items: PlanCandidateItem[]) {
  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    kinds: count(items.map(kindOf)),
    areas: count(items.map((c) => areaOf(c.address) ?? '住所なし')),
    tags: count(items.flatMap((c) => c.tags ?? [])),
  };
}

/** タグの入力(「、」「,」・空白で区切る。前の「#」は外す) */
export function parseTags(text: string): string[] {
  return text.split(/[,、，\s]+/).map((t) => t.replace(/^[#＃]+/, '').trim()).filter(Boolean);
}
