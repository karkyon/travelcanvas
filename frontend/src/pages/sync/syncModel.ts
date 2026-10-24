/**
 * [Gate P11] 同期の競合の表示用の整形。
 */
import type { SyncConflict } from '@/services/api';

const FIELD_LABEL: Record<string, string> = {
  day_id: '日付', title: '予定名', description: 'メモ', event_type: '種類', local_start_time: '開始時刻',
  is_all_day: '終日', address: '住所', latitude: '緯度', longitude: '経度',
  // [Gate G6] OFF-02 日程・並び
  local_date: '日付', timezone_id: 'タイムゾーン', notes: '日のメモ', order: '予定の並び',
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '(なし)';
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
  return String(v);
};

/** 競合の対象の呼び方(予定・日程・予定の並び) */
export function conflictSubject(c: SyncConflict): string {
  if (c.entity_type === 'day') return '日程';
  if (c.entity_type === 'order') return '予定の並び';
  return '予定';
}

export function conflictSummary(c: SyncConflict): string {
  if (c.entity_type === 'order') {
    return 'この日の予定の並びを端末で変えた後に、サーバーでも予定が変わっています。並びを使うか、サーバーの並びを残すかを選んでください';
  }
  if (c.entity_type === 'day' && c.action === 'update' && c.server_deleted) {
    return 'この日程はサーバーで削除されたため、端末での変更は反映できません。「サーバーの内容を残す」で閉じてください';
  }
  if (c.entity_type === 'day' && c.action === 'delete') {
    return '端末で日程を削除しましたが、その間にサーバーで変更されています。削除するか、サーバーの内容を残すかを選んでください';
  }
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

/** 並び(予定のIDの並び、またはサーバーの {id,title} の並び)を予定名の並びにする */
function orderText(v: unknown, titles: Map<string, string>): string {
  if (!Array.isArray(v) || v.length === 0) return '(なし)';
  return v.map((x, i) => {
    if (x && typeof x === 'object' && 'id' in x) {
      const o = x as { id: unknown; title?: unknown };
      return `${i + 1}. ${typeof o.title === 'string' && o.title ? o.title : '(名前なし)'}`;
    }
    return `${i + 1}. ${titles.get(String(x)) ?? '(サーバーにない予定)'}`;
  }).join(' / ');
}

export function conflictRows(c: SyncConflict): ConflictRow[] {
  const d = c.conflict;
  if (!d) return [];
  if (c.entity_type === 'order') {
    const server = (d.server?.order ?? []) as unknown[];
    const titles = new Map<string, string>();
    for (const x of server) {
      if (x && typeof x === 'object' && 'id' in x) {
        const o = x as { id: unknown; title?: unknown };
        titles.set(String(o.id), typeof o.title === 'string' && o.title ? o.title : '(名前なし)');
      }
    }
    return [{ field: 'order', label: FIELD_LABEL.order!, mine: orderText(d.mine?.order, titles),
      server: c.server_deleted ? '(削除済み)' : orderText(server, titles) }];
  }
  return d.fields.map((f) => ({
    field: f,
    label: FIELD_LABEL[f] ?? f,
    mine: c.action === 'delete' ? '(削除)' : show(d.mine?.[f]),
    server: c.server_deleted ? '(削除済み)' : show((c.current ?? d.server ?? {})[f]),
  }));
}
