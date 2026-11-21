/**
 * [Gate② FC-041] 変更・取消のメールを元の予約の履歴へまとめる(backend/app/api/v1/reservations.py の absorb・history)。
 * 自動ではまとめない。「同じ予約かもしれません(予約番号が同じ)」の組を、利用者が選んだ時だけ呼ぶ。
 * 予約の画面を開いた時だけ読む(CompleteTravelAPI には足さない)。
 */
import { api } from './index';
import { arrayOf, decodeResponse, nullable, object, optional, str, type Decoder } from './decode';

export type AbsorbKind = 'change' | 'cancel';
export interface ReservationHistoryEntry {
  id: string; kind: string; source_reservation_id?: string | null; fields: string[]; created_at?: string | null;
}

const entry: Decoder<ReservationHistoryEntry> = object<ReservationHistoryEntry>({
  id: str, kind: str, source_reservation_id: optional(nullable(str)), fields: arrayOf(str),
  created_at: optional(nullable(str)),
});

/** source(変更・取消のメールから入った予約)を target(元の予約)へまとめる。ifMatch は target の revision */
export async function absorbReservation(planId: string, targetId: string, sourceId: string, kind: AbsorbKind,
  ifMatch: number): Promise<void> {
  await api.post(`/plans/${planId}/reservations/${targetId}/absorb`, { source_reservation_id: sourceId, kind },
    { headers: { 'If-Match': String(ifMatch) } });
}

export async function getReservationHistory(planId: string, reservationId: string): Promise<ReservationHistoryEntry[]> {
  const r = await api.get(`/plans/${planId}/reservations/${reservationId}/history`);
  return decodeResponse(r.data, arrayOf(entry), 'GET /plans/{plan_id}/reservations/{reservation_id}/history');
}
