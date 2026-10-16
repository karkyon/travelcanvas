/**
 * オフライン編集・同期(FR-033)APIの型
 *
 * [Gate P11] backend/app/api/v1/sync.py・app/services/sync.py に対応する。
 * 端末に溜めた予定の操作(作成・変更・削除)を operation_id 付きで送り、操作ごとの結果を受け取る。
 * 同じ operation_id の再送は already_applied(二重に適用しない)。競合は利用者が解決するまでサーバーに残る。
 */
export type SyncAction = 'create' | 'update' | 'delete';
export type SyncResultStatus = 'applied' | 'already_applied' | 'conflicted' | 'rejected';

export interface SyncEventFields {
  day_id?: string;
  title?: string;
  description?: string | null;
  event_type?: string;
  local_start_time?: string | null;
  is_all_day?: boolean;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface SyncOperationInput {
  operation_id: string;
  entity_type: 'event';
  action: SyncAction;
  /** 予定のID、または端末で作った予定の仮のID */
  entity_id?: string | null;
  /** 作成する予定の仮のID(後続の操作から参照する) */
  temp_id?: string | null;
  /** 編集を始めた時の本案のrevision(変更・削除で必須) */
  base_revision?: number | null;
  fields?: SyncEventFields;
  client_at?: string;
}

export interface SyncConflictDetail {
  fields: string[];
  mine: Record<string, unknown> | null;
  server: Record<string, unknown> | null;
  server_deleted: boolean;
  deleted_by_me?: boolean;
  title?: string | null;
}

export interface SyncResult {
  operation_id: string;
  status: SyncResultStatus;
  code: string | null;
  message: string | null;
  entity_id: string | null;
  temp_id: string | null;
  resulting_revision: number | null;
  conflict: SyncConflictDetail | null;
}

export interface SyncResponse {
  plan_id: string;
  plan_revision: number;
  results: SyncResult[];
  summary: { applied: number; already_applied: number; conflicted: number; rejected: number };
  pack_refresh_required: boolean;
}

export interface SyncConflict {
  operation_id: string;
  action: SyncAction;
  code: string | null;
  message: string | null;
  entity_id: string | null;
  title: string | null;
  conflict: SyncConflictDetail | null;
  /** サーバーの今の値(削除済みならnull) */
  current: Record<string, unknown> | null;
  server_deleted: boolean;
  created_at: string | null;
}

export interface SyncConflictList {
  plan_id: string;
  plan_revision: number;
  conflicts: SyncConflict[];
}

export interface SyncResolveResult {
  operation_id: string;
  status: 'resolved_mine' | 'resolved_server';
  plan_revision: number;
}
