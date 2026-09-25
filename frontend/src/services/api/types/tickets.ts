/**
 * QR・チケット(FR-012)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate R3-11] FR-012 QR・チケット(tickets)。
// backend/app/api/v1/reservations.py (Gate R3-5)のticketエンドポイントに
// 対応するfrontend型。payloadはAPIから平文で返らない(has_payloadのみ)。
// 完全開示はrevealTicket()経由のみ(share_policy依存の権限判定+監査ログ)。

export type TicketStatus = 'active' | 'used' | 'expired' | 'revoked';

export type TicketSharePolicy = 'owner_editor' | 'all_collaborators';

export interface Ticket {
  id: string;
  reservation_id: string;
  ticket_type: string;
  holder_member_id: string | null;
  has_payload: boolean;
  barcode_format: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: TicketStatus;
  offline_allowed: boolean;
  share_policy: TicketSharePolicy;
  revision: number;
  created_at: string;
  updated_at: string | null;
}

export interface TicketCreateData {
  ticket_type: string;
  payload?: string;
  barcode_format?: string;
  valid_from?: string;
  valid_to?: string;
  status?: TicketStatus;
  offline_allowed?: boolean;
  share_policy?: TicketSharePolicy;
}

export interface TicketRevealResult {
  id: string;
  payload: string | null;
  barcode_format: string | null;
}
