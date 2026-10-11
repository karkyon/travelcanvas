/**
 * データポータビリティ(FR-039)APIの型
 *
 * [Gate P6] backend/app/api/v1/data_export.py に対応する。エクスポートはJSONファイル(travelcanvas-export v1)。
 */
export interface RetentionItem {
  key: 'deleted_plan' | 'quick_draft' | 'documents' | 'audit' | 'backup' | 'exported';
  label: string;
  period: string;
  note: string;
}

export interface RetentionInfo {
  plan_delete_grace_days: number;
  quick_draft_expired_retention_days: number;
  quick_draft_promoted_retention_days: number;
  items: RetentionItem[];
}

export interface DataExportFile {
  blob: Blob;
  filename: string;
  /** 応答ヘッダー X-Content-SHA256(内容の確認用)。無ければ null */
  sha256: string | null;
}
