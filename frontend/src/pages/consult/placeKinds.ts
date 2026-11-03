/**
 * [Gate PlaceKinds] 見つかった場所の種類(backend/app/services/place_kinds.py と同じキー)・表示・希望との照合。
 *
 * 種類ごとに絵文字・色・名前を決め、画像の無い場所でも何の場所か一目で分かるようにする。
 * 希望(旅行相談の「過ごし方」)と種類を照合し、合う場所を先に並べる。
 */
import type { LucideIcon } from 'lucide-react';
import {
  IcBath, IcBed, IcBuilding, IcCastle, IcCoffee, IcFerrisWheel, IcHome, IcLandmark, IcMapPin, IcMountain, IcShopping,
  IcTrees, IcUtensils,
} from '@/components/common/uiIcons';

export type PlaceKind = 'shrine_temple' | 'castle_history' | 'museum' | 'nature' | 'park' | 'onsen' | 'leisure'
  | 'town' | 'food' | 'cafe' | 'shop' | 'lodging' | 'other';

export const KIND_META: Record<PlaceKind, { label: string; icon: LucideIcon; bg: string; fg: string }> = {
  shrine_temple: { label: '神社・寺', icon: IcLandmark, bg: '#fbe9e7', fg: '#9a3412' },
  castle_history: { label: '城・史跡', icon: IcCastle, bg: '#f1ece4', fg: '#6b4f2a' },
  museum: { label: '博物館・美術館・水族館', icon: IcBuilding, bg: '#e8eef8', fg: '#1e3a8a' },
  nature: { label: '自然・景色', icon: IcMountain, bg: '#e6f4ea', fg: '#166534' },
  park: { label: '公園・庭園', icon: IcTrees, bg: '#ecf7e3', fg: '#3f6212' },
  onsen: { label: '温泉・湯', icon: IcBath, bg: '#fdeef3', fg: '#9d174d' },
  leisure: { label: 'テーマパーク・体験', icon: IcFerrisWheel, bg: '#f3e8ff', fg: '#6b21a8' },
  town: { label: '町並み・通り', icon: IcHome, bg: '#fef6e4', fg: '#92400e' },
  food: { label: '食事', icon: IcUtensils, bg: '#fff1e6', fg: '#c2410c' },
  cafe: { label: 'カフェ・甘味', icon: IcCoffee, bg: '#f6efe9', fg: '#78350f' },
  shop: { label: '買い物・市場', icon: IcShopping, bg: '#e0f2fe', fg: '#075985' },
  lodging: { label: '宿泊', icon: IcBed, bg: '#eef2f7', fg: '#334155' },
  other: { label: 'その他', icon: IcMapPin, bg: '#f1f5f9', fg: '#475569' },
};

export const KIND_ORDER: PlaceKind[] = ['shrine_temple', 'castle_history', 'museum', 'nature', 'park', 'onsen',
  'leisure', 'town', 'food', 'cafe', 'shop', 'lodging', 'other'];

export function asKind(v: string | null | undefined): PlaceKind {
  return v && v in KIND_META ? (v as PlaceKind) : 'other';
}

/** 過ごし方(旅行相談の preferences)→ 合う種類 */
const PREF_KINDS: Record<string, PlaceKind[]> = {
  quiet: ['shrine_temple', 'nature', 'park', 'castle_history'],
  calm: ['town', 'shrine_temple', 'museum', 'park', 'castle_history'],
  food: ['food', 'cafe', 'shop'],
  scenery: ['nature', 'park'],
  culture: ['shrine_temple', 'castle_history', 'museum', 'town'],
  onsen: ['onsen'],
};
const PREF_LABEL: Record<string, string> = {
  quiet: '静か', calm: '落ち着いた観光', food: '食', scenery: '絶景・自然', culture: '歴史・文化', onsen: '温泉',
};

/** この種類が合う希望(画面の「希望に合う: 歴史・文化」) */
export function matchedPrefs(kind: PlaceKind, prefs: string[]): string[] {
  return prefs.filter((p) => PREF_KINDS[p]?.includes(kind)).map((p) => PREF_LABEL[p] ?? p);
}

/** 人混みを避けたい希望の時は、テーマパーク・体験を後ろに回す */
export function avoidKind(kind: PlaceKind, prefs: string[]): boolean {
  return prefs.includes('quiet') && kind === 'leisure';
}
