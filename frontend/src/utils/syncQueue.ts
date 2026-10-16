/**
 * [Gate P11] オフライン編集の操作キュー(FR-033、DOC-03 §11.1 Offline state)。
 *
 * 通信できない時の予定の作成・変更・削除を、端末(localStorage)へ operation_id 付きで溜め、通信が戻ったら
 * POST /plans/{id}/sync で送られた順に送る。同じ operation_id の再送はサーバーが二重に適用しないため、
 * 送信の結果を受け取れなかった場合も安全に送り直せる。
 * - 予約番号・チケット等の機密値は溜めない(対象は予定の名前・時刻・場所などだけ)
 * - ストレージが使えない(プライベートモード等)場合も画面を止めず、溜められなかったことを返す
 * - 競合した数はサーバーが正(一覧は /sync/conflicts)。端末には画面に出す件数だけを覚える
 */
import type { SyncAction, SyncEventFields, SyncOperationInput, SyncResult } from '@/services/api';

export interface QueuedOperation extends SyncOperationInput {
  /** 画面に出す予定名(未同期の一覧用) */
  label: string;
}

const queueKey = (planId: string) => `tc_sync_queue_${planId}`;
const conflictKey = (planId: string) => `tc_sync_conflicts_${planId}`;
const DEVICE_KEY = 'tc_device_id';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // 古い環境向け(RFC4122 v4の形式)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = newId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'unknown-device';
  }
}

function isQueued(v: unknown): v is QueuedOperation {
  const o = v as QueuedOperation;
  return !!o && typeof o.operation_id === 'string' && o.entity_type === 'event'
    && (o.action === 'create' || o.action === 'update' || o.action === 'delete');
}

export function loadQueue(planId: string): QueuedOperation[] {
  try {
    const raw = localStorage.getItem(queueKey(planId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueued) : [];
  } catch {
    return [];
  }
}

function saveQueue(planId: string, ops: QueuedOperation[]): boolean {
  try {
    if (ops.length === 0) localStorage.removeItem(queueKey(planId));
    else localStorage.setItem(queueKey(planId), JSON.stringify(ops));
    return true;
  } catch {
    return false;
  }
}

/** 値が無い項目を除く(送らない項目と「空にする」を区別するため、nullは残す) */
function definedFields(fields: SyncEventFields): SyncEventFields {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as SyncEventFields;
}

export function enqueue(
  planId: string,
  op: { action: SyncAction; entity_id?: string | null; temp_id?: string | null; base_revision?: number | null;
    fields?: SyncEventFields; label: string },
): QueuedOperation | null {
  const queued: QueuedOperation = {
    operation_id: newId(), entity_type: 'event', action: op.action, entity_id: op.entity_id ?? null,
    temp_id: op.temp_id ?? null, base_revision: op.base_revision ?? null,
    fields: op.fields ? definedFields(op.fields) : undefined, client_at: new Date().toISOString(), label: op.label,
  };
  return saveQueue(planId, [...loadQueue(planId), queued]) ? queued : null;
}

/** 送信の結果を当てる: 処理が終わった操作(適用・既に適用・競合・拒否)を外し、作成された予定の仮IDを本当のIDへ置き換える。 */
export function applyResults(planId: string, results: SyncResult[]): QueuedOperation[] {
  const done = new Set(results.map((r) => r.operation_id));
  const mapping = new Map<string, string>();
  for (const r of results) {
    if (r.temp_id && r.entity_id && (r.status === 'applied' || r.status === 'already_applied')) {
      mapping.set(r.temp_id, r.entity_id);
    }
  }
  const remaining = loadQueue(planId)
    .filter((o) => !done.has(o.operation_id))
    .map((o) => (o.entity_id && mapping.has(o.entity_id) ? { ...o, entity_id: mapping.get(o.entity_id)! } : o));
  saveQueue(planId, remaining);
  return remaining;
}

/** 送信する形(画面用のlabelを除く) */
export function toPayload(ops: QueuedOperation[]): SyncOperationInput[] {
  return ops.map((o) => {
    const rest: SyncOperationInput & { label?: string } = { ...o };
    delete rest.label;
    return rest;
  });
}

export function loadConflictCount(planId: string): number {
  try {
    const n = Number(localStorage.getItem(conflictKey(planId)) ?? '0');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function saveConflictCount(planId: string, count: number): void {
  try {
    if (count > 0) localStorage.setItem(conflictKey(planId), String(count));
    else localStorage.removeItem(conflictKey(planId));
  } catch {
    // 件数の表示だけなので、保存できなくても続ける
  }
}

/** 通信できなかった(サーバーから応答が無い)失敗か。権限・競合などサーバーが答えた失敗は溜めない。 */
export function isNetworkError(error: unknown): boolean {
  const e = error as { response?: unknown; code?: string; message?: string } | null | undefined;
  if (!e || e.response) return false;
  if (e.code === 'ERR_NETWORK' || e.code === 'NETWORK_ERROR' || e.code === 'ECONNABORTED') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return e.message === 'Network Error';
}
