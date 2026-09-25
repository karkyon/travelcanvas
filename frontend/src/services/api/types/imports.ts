/**
 * 予約取込(FR-011)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate R3-9] FR-011予約取込(import_jobs/extraction_candidates)。
// backend/app/api/v1/imports.py (Gate R3-7)に対応するfrontend型。
// AI/OCR provider未導入のため、ジョブは作成時点でreview_requiredとなり、
// 候補は利用者自身が登録する(docs/adr/ADR-import-minimal.md参照)。

export type ImportFieldPath =
  | 'type' | 'status' | 'provider_name' | 'confirmation_number' | 'pin'
  | 'holder_name' | 'guest_count' | 'start_at' | 'end_at' | 'timezone_id'
  | 'total_amount' | 'currency' | 'payment_status' | 'cancellation_deadline'
  | 'contact_phone' | 'contact_url' | 'notes';

export interface ImportJob {
  id: string;
  plan_id: string;
  document_id: string | null;
  provider: string;
  status: 'uploaded' | 'scanning' | 'extracting' | 'review_required' | 'confirmed' | 'rejected'
    | 'quarantined' | 'retry_wait' | 'failed';
  consent_given: boolean;
  error_message: string | null;
  result_reservation_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ExtractionCandidate {
  id: string;
  import_job_id: string;
  field_path: string;
  value: string | null;
  confidence: number;
  evidence_locator: string | null;
  review_status: 'pending' | 'accepted' | 'rejected';
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ImportJobDetail extends ImportJob {
  candidates: ExtractionCandidate[];
}

export interface ImportJobCreateData {
  document_id?: string;
  consent_given: boolean;
}

export interface ExtractionCandidateCreateData {
  field_path: ImportFieldPath;
  value: string;
  confidence?: number;
  evidence_locator?: string;
}
