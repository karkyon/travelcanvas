/**
 * [Gate BookingBadge] 旅程の予定ごとの予約の状態(GET /plans/{id}/booking-status)と、予約を予定につなぐ。
 * 最初に読む JS を小さく保つため、旅程の画面(後から読む)がここを直接 import する。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface BookingReservation {
  id: string; type: string; type_label: string; status: string; provider_name: string | null; guest_count: number | null;
  /** 旅先の時刻 "YYYY-MM-DD HH:MM" */
  start: string | null; end: string | null;
}
export interface EventBooking {
  /** booked 予約済み・issue 予約済みで食い違いあり・suggest 合いそうな予約がある(まだつないでいない)・none まだ */
  state: 'booked' | 'issue' | 'suggest' | 'none';
  issues: string[];
  reservations: BookingReservation[];
  suggestions: BookingReservation[];
}
export interface BookingStatus { party_size: number | null; events: Record<string, EventBooking> }

export async function getBookingStatus(planId: string): Promise<BookingStatus> {
  return (await api.get(`/plans/${planId}/booking-status`, SILENT)).data as BookingStatus;
}

/** 予約を予定につなぐ(event_reservations の primary) */
export async function linkReservationToEvent(planId: string, reservationId: string, eventId: string): Promise<void> {
  await api.post(`/plans/${planId}/reservations/${reservationId}/events`, { event_id: eventId, relation_type: 'primary' }, SILENT);
}
