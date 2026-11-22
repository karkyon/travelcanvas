/**
 * 文書ウォレット(FR-013)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate R3-10/M7改訂] FR-013文書ウォレット(documents/document_links)。
// backend/app/api/v1/documents.py (Gate R3-6→M5→M7)に対応するfrontend型。
// [Gate M7 P0-01/P0-02] 旧クライアント指定storage_key方式の登録API
// (createDocument/DocumentCreateData)はbackend側で410 Goneとなったため
// 削除した。文書作成は`uploadDocument`(実multipartアップロード)のみを
// 経路とする。`storage_key`は内部のObject Storage参照でありbackendの
// 通常レスポンスから除外されたため、frontend型からも削除した。

export type DocumentClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export interface TravelDocument {
  id: string;
  plan_id: string;
  owner_user_id: string | null;
  classification: DocumentClassification;
  document_type: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size: number | null;
  sha256: string | null;
  malware_status: string;
  ocr_status: string;
  retention_until: string | null;
  revision: number;
  created_at: string;
  updated_at: string | null;
  /** [Gate TripKitFix] 一覧だけで返る。予約・チケット・予定などへの関連の件数(単体の取得では null) */
  link_count?: number | null;
  /** [Gate TripKitFix] この文書を領収書にしている支出の件数(支出の名前・金額は返らない) */
  receipt_count?: number | null;
  /** [Gate② FC-045] 版(差し替えで 1 つ増える)と、差し替えた前の版 */
  version?: number;
  replaces_document_id?: string | null;
  superseded_at?: string | null;
}

export interface DocumentLink {
  id: string;
  document_id: string;
  entity_type: string;
  entity_id: string;
  relation_type: string;
  display_order: number;
  created_at: string;
}
