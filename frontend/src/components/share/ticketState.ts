/**
 * [Gate TripKit] SC-12 チケットの状態(使用済み・期限切れ・取消・有効期間の前)を文字で返す。
 */
import type { Ticket } from '@/services/api';

const STATUS_WORD: Record<string, string> = { used: '使用済みのチケットです', expired: '有効期限が切れています', revoked: '取り消されたチケットです' };

export function ticketWarning(t: Ticket, nowMs: number): string | null {
  if (STATUS_WORD[t.status]) return STATUS_WORD[t.status]!;
  const to = t.valid_to ? Date.parse(t.valid_to) : NaN;
  if (!Number.isNaN(to) && to < nowMs) return '有効期限が切れています';
  const from = t.valid_from ? Date.parse(t.valid_from) : NaN;
  if (!Number.isNaN(from) && from > nowMs) return 'まだ有効期間の前です';
  return null;
}

