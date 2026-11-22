/** [FR-061] 新しい旅行(日帰り)の入力と確かめ */
import type { DayTripPlace, Road } from '@/services/api/dayTrip';

export interface DayTripDraft {
  dest: DayTripPlace | null; destAddress: string | null;
  origin: DayTripPlace | null; originKind: 'here' | 'home' | 'input' | null;
  road: Road; date: string; depart: string; homeBy: string;
}
export const emptyDayTrip = (date = ''): DayTripDraft => ({ dest: null, destAddress: null, origin: null, originKind: null, road: 'auto',
  date, depart: '09:00', homeBy: '' });

/** 保存の前の確かめ(画面の文・コード) */
export function dayTripProblem(d: DayTripDraft): { code: string; text: string } | null {
  if (!d.dest) return { code: 'day_trip_dest_missing', text: '最初に行きたい場所(目的地)を選んでください' };
  if (d.dest.lat == null || d.dest.lng == null) return { code: 'day_trip_dest_unlocated', text: '目的地の位置が分かりません。候補から選び直してください' };
  if (!d.origin) return { code: 'day_trip_origin_missing', text: '出発地を選んでください' };
  if (!d.date) return { code: 'day_trip_date_missing', text: '出発日を入れてください' };
  if (d.homeBy && d.homeBy <= d.depart) return { code: 'day_trip_time_order', text: '家に着きたい時刻は出発の後にしてください' };
  return null;
}

export const pendingKey = (planId: string) => `tc_daytrip_pending:${planId}`;
