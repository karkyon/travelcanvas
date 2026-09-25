/**
 * [Gate M9-FE-C2b] 誤った値が流れ込むと実害が大きい応答のdecoder。
 *
 * - revision: 楽観的並行制御(If-Match)に使う版番号。数値以外が混入すると
 *   以降の更新が全て409(競合)になるか、誤った版で上書きしかねない。
 * - 当日モード(NOW/NEXT): 旅行当日に表示する時刻・場所。欠落は誤案内に直結する。
 * - 文書のダウンロードURL: 署名付きURLと有効期限。
 * - 予約・チケットの開示(reveal): 確認番号・PIN・QR payloadなど秘匿情報。
 *
 * 各decoderの形状は backend の Pydantic モデル/戻り値に合わせている
 * (backend/app/api/v1/plans.py TodayResponse、reservations.py
 *  ReservationRevealResponse/TicketRevealResponse、documents.py download-url、
 *  plans.py/segments.py/route_options.py の削除・Undo応答)。
 */
import type { ReservationRevealResult, TicketRevealResult, TodayEvent, TodayResponse } from './types';
import { bool, int, nullable, num, object, str, type Decoder } from './decode';

export interface RevisionResult {
  revision: number;
}

export const revisionResult: Decoder<RevisionResult> = object<RevisionResult>({ revision: int });

export const todayEvent: Decoder<TodayEvent> = object<TodayEvent>({
  id: str,
  title: str,
  event_type: str,
  start_at: nullable(str),
  end_at: nullable(str),
  local_start_time: nullable(str),
  address: nullable(str),
  latitude: nullable(num),
  longitude: nullable(num),
  has_ticket: bool,
  reservation_id: nullable(str),
});

export const todayResponse: Decoder<TodayResponse> = object<TodayResponse>({
  plan_id: str,
  today_date: nullable(str),
  timezone_id: nullable(str),
  server_time: str,
  now_event: nullable(todayEvent),
  next_event: nullable(todayEvent),
  minutes_until_next: nullable(int),
});

export interface DownloadUrlResult {
  url: string;
  expires_at: number;
}

export const downloadUrlResult: Decoder<DownloadUrlResult> = object<DownloadUrlResult>({
  url: str,
  expires_at: int,
});

export const reservationRevealResult: Decoder<ReservationRevealResult> = object<ReservationRevealResult>({
  id: str,
  confirmation_number: nullable(str),
  pin: nullable(str),
});

export const ticketRevealResult: Decoder<TicketRevealResult> = object<TicketRevealResult>({
  id: str,
  payload: nullable(str),
  barcode_format: nullable(str),
});
