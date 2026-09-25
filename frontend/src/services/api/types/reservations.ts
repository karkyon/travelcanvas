/**
 * 予約管理(FR-010)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// backend/app/api/v1/reservations.py (Gate R3-0/R3-1)に対応するfrontend型。
// confirmation_number/pinはAPIから平文で返らない(masked表示のみ)。
// 完全開示はrevealReservation()経由のみ(監査ログ必須、backend側で強制)。

export interface Reservation {
  id: string;
  plan_id: string;
  event_id: string | null;
  place_id: string | null;
  type: string;
  status: string;
  provider_name: string | null;
  confirmation_number_masked: string | null;
  has_pin: boolean;
  holder_name: string | null;
  guest_count: number | null;
  start_at: string | null;
  end_at: string | null;
  timezone_id: string | null;
  total_amount: number | null;
  currency: string | null;
  payment_status: string | null;
  cancellation_deadline: string | null;
  contact_phone: string | null;
  contact_url: string | null;
  notes: string | null;
  revision: number;
  created_at: string;
  updated_at: string | null;
}

export interface ReservationRevealResult {
  id: string;
  confirmation_number: string | null;
  pin: string | null;
}

export interface ReservationParticipant {
  id: string;
  reservation_id: string;
  plan_member_id: string | null;
  name: string;
  seat: string | null;
  special_request: string | null;
  revision: number;
  created_at: string;
  updated_at: string | null;
}

export interface ReservationCreateData {
  type: string;
  status?: string;
  provider_name?: string;
  confirmation_number?: string;
  pin?: string;
  holder_name?: string;
  guest_count?: number;
  event_id?: string;
  place_id?: string;
  start_at?: string;
  end_at?: string;
  timezone_id?: string;
  total_amount?: number;
  currency?: string;
  payment_status?: string;
  cancellation_deadline?: string;
  contact_phone?: string;
  contact_url?: string;
  notes?: string;
}

export type ReservationUpdateData = Partial<ReservationCreateData>;

// [Gate R3-3] event_reservations中間表(複数イベント紐付け)。
// backend/app/api/v1/reservations.py の create_event_link/list_event_links/
// update_event_link/delete_event_link に対応。
export interface ReservationEventLink {
  id: string;
  event_id: string;
  reservation_id: string;
  relation_type: 'primary' | 'required' | 'related' | string;
  is_locked: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface ReservationEventLinkCreateData {
  event_id: string;
  relation_type?: 'primary' | 'required' | 'related';
  is_locked?: boolean;
}

export interface ReservationEventLinkUpdateData {
  relation_type?: 'primary' | 'required' | 'related';
  is_locked?: boolean;
}
