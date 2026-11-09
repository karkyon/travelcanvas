/**
 * [Gate AddEventForm] 予定を追加する時の自動取得(スポットを編集と同じ情報を、名前・住所・旅行の位置から取る)。
 */
import { getPlaceInfo, type PlaceInfoCandidate, type PlaceInfoResult } from '@/services/api/planEdit';
import type { CreateScheduleItemData, EventCategory } from '@/types';
import { appendNotes, mergeUrlRows } from '@/components/places/placeHelpers';
import { usePlanStore } from '@/store/planStore';

export type NewEventData = Partial<CreateScheduleItemData>;

const CATS: EventCategory[] = ['sightseeing', 'activity', 'dining', 'shopping', 'accommodation', 'transportation', 'other'];

export function toCategory(c?: string | null): EventCategory | null {
  if (!c) return null;
  if ((CATS as string[]).includes(c)) return c as EventCategory;
  if (/rest|food|dining|cafe|meal|食/i.test(c)) return 'dining';
  if (/hotel|lodging|accom|宿/i.test(c)) return 'accommodation';
  if (/shop|store|market/i.test(c)) return 'shopping';
  if (/station|airport|transport/i.test(c)) return 'transportation';
  return 'sightseeing';
}

/** 名前(と住所・近くの位置)で自動取得し、候補の一覧と、一番上の候補を返す */
export async function lookupPlace(name: string, near: { latitude: number; longitude: number } | null,
  address?: string | null): Promise<{ result: PlaceInfoResult; best: PlaceInfoCandidate | null }> {
  // [Gate PlaceTripArea] 旅程の画面の旅行を渡す(位置・住所が無い時、旅行の目的地の近くを探す)
  const result = await getPlaceInfo({ name, latitude: near?.latitude, longitude: near?.longitude, address,
    plan_id: usePlanStore.getState().currentPlan?.id ?? null });
  return { result, best: result.candidates[0] ?? null };
}

/** 候補を入力へ入れる。overwrite でなければ空の欄だけ(利用者が入れた値は変えない) */
export function applyCandidate(prev: NewEventData, urlRows: string[], c: PlaceInfoCandidate, overwrite = true):
  { data: NewEventData; urlRows: string[] } {
  const take = <T,>(cur: T | undefined | null, v: T | null | undefined): T | undefined =>
    (v !== null && v !== undefined && v !== '' && (overwrite || cur === undefined || cur === null || cur === '') ? v : cur ?? undefined);
  const data: NewEventData = {
    ...prev,
    location_name: take(prev.location_name, prev.location_name ? null : c.name),
    address: take(prev.address, c.address),
    phone: take(prev.phone, c.phone),
    category: (overwrite || !prev.category ? toCategory(c.category) : null) ?? prev.category,
    latitude: take(prev.latitude, c.latitude),
    longitude: take(prev.longitude, c.longitude),
    notes: appendNotes(prev.notes ?? '', c.notes),
    dining: c.dining ?? prev.dining,
  };
  return { data, urlRows: mergeUrlRows(urlRows, c) };
}

/** 開始と滞在(時間・分)から終わりの時刻(23:59 で止める)。滞在が 0 なら空 */
export function endFrom(start: string, h: string, m: string): string {
  const s = /^(\d{1,2}):(\d{2})$/.exec(start);
  const mins = (Number(h) || 0) * 60 + (Number(m) || 0);
  if (!s || mins <= 0) return '';
  const total = Math.min(24 * 60 - 1, Number(s[1]) * 60 + Number(s[2]) + mins);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
