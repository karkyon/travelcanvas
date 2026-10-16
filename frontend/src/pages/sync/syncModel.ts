/**
 * [Gate P11] 同期の競合の表示用の整形。
 */
import type { SyncConflict } from '@/services/api';

const FIELD_LABEL: Record<string, string> = {
  day_id: '日付', title: '予定名', description: 'メモ', event_type: '種類', local_start_time: '開始時刻',
  is_all_day: '終日', address: '住所', latitude: '緯度', longitude: '経度',
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '(なし)';
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
  return String(v);
};

export function conflictSummary(c: SyncConflict): string {
  if (c.action === 'update' && c.server_deleted) {
    return 'この予定はサーバーで削除されたため、端末での変更は反映できません。「サーバーの内容を残す」で閉じてください';
  }
  if (c.action === 'delete') {
    return '端末で削除しましたが、その間にサーバーで変更されています。削除するか、サーバーの内容を残すかを選んでください';
  }
  return c.message ?? '端末で編集を始めた後に、サーバーでも変更されています';
}

export interface ConflictRow {
  field: string;
  label: string;
  mine: string;
  server: string;
}

export function conflictRows(c: SyncConflict): ConflictRow[] {
  const d = c.conflict;
  if (!d) return [];
  return d.fields.map((f) => ({
    field: f,
    label: FIELD_LABEL[f] ?? f,
    mine: c.action === 'delete' ? '(削除)' : show(d.mine?.[f]),
    server: c.server_deleted ? '(削除済み)' : show((c.current ?? d.server ?? {})[f]),
  }));
}
