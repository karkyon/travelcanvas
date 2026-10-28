/**
 * [Gate G8] FR-019 案の中の区間・予約の変更と選んで採用・FR-021 所有者の移譲・FR-039 出典つきの訂正・
 * FR-004 定期の処理の記録 の型(backend: branches.py の resources / adoption-preview、ownership.py、corrections.py、
 * admin.py /admin/ops/jobs)。
 */
export type EventRef = { event: string } | { key: string };

export type SegmentMode = 'walking' | 'driving' | 'train' | 'bus' | 'ferry' | 'flight' | 'bicycle' | 'taxi' | 'mixed'
  | 'shinkansen' | 'helicopter';  // [Gate G11]
export type SegmentStatus = 'planned' | 'confirmed' | 'cancelled';

export interface BaseSegment {
  id: string;
  from_event_id: string | null;
  to_event_id: string | null;
  from_place_id: string | null;
  to_place_id: string | null;
  mode: SegmentMode;
  status: SegmentStatus;
  planned_departure_at: string | null;
  planned_arrival_at: string | null;
  last_departure_at: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  cost: string | null;
  currency: string | null;
  transport_number: string | null;
  platform: string | null;
  preparation_minutes: number;
  buffer_before_minutes: number;
  reservation_id: string | null;
}

export interface BaseReservation {
  id: string;
  label: string;
  type: string;
  status: string;
  event_id: string | null;
  event_ids: string[];
  locked: boolean;
  total_amount: number | null;
  currency: string | null;
  cancellation_deadline: string | null;
}

export interface SegmentFields {
  mode?: SegmentMode;
  status?: SegmentStatus;
  duration_minutes?: number | null;
  distance_km?: number | null;
  cost?: string | number | null;
  currency?: string | null;
  planned_departure_at?: string | null;
  planned_arrival_at?: string | null;
  last_departure_at?: string | null;
  transport_number?: string | null;
  platform?: string | null;
  preparation_minutes?: number;
  buffer_before_minutes?: number;
  from?: EventRef;
  to?: EventRef;
}

export type SegmentOp =
  | { op: 'update'; segment_id: string; fields: SegmentFields }
  | { op: 'remove'; segment_id: string }
  | { op: 'add'; key: string; fields: SegmentFields & { from: EventRef; to: EventRef; mode: SegmentMode } };

export type ReservationOp =
  | { op: 'relink'; reservation_id: string; to: EventRef | null }
  | { op: 'cancel'; reservation_id: string; note: string | null };

export interface BranchResources {
  algorithm_version: string;
  base_segments: BaseSegment[];
  base_reservations: BaseReservation[];
  segments: SegmentOp[];
  reservations: ReservationOp[];
  reservations_hidden: boolean;
  costs_hidden: boolean;
}

export interface ResourceSummary {
  segments_added: number;
  segments_removed: number;
  segments_updated: number;
  reservations_relinked: number;
  reservations_cancel_planned: number;
}

export interface ResourcesInput {
  segments: SegmentOp[];
  reservations: ReservationOp[];
}

export type ResourceConflictReason =
  | 'changed_in_plan' | 'deleted_in_plan' | 'locked' | 'event_missing' | 'already_cancelled' | 'hidden';

export interface PreviewItem {
  op_id: string;
  kind: 'event' | 'segment' | 'reservation';
  op: string;
  label: string;
  selected: boolean;
  requires: string[];
}

export interface PreviewConflict {
  kind: 'event' | 'segment' | 'reservation';
  op_id: string;
  op?: string;
  reason: string;
  fields?: string[];
  label?: string;
  title?: string;
}

export interface AdoptionPreview {
  branch_id: string;
  algorithm_version: string;
  items: PreviewItem[];
  conflicts: PreviewConflict[];
  missing_dependencies: Array<{ op_id: string; requires: string[] }>;
  tasks: Array<{ title: string; due_at: string | null }>;
  reservations_hidden: boolean;
  can_adopt: boolean;
  partial: boolean;
}

export interface AdoptResultG8 {
  plan_revision: number;
  left_out: string[];
  tasks_created: number;
}

// ===== FR-021 所有者の移譲
export type TransferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type KeepRole = 'editor' | 'viewer' | 'none';

export interface OwnershipTransfer {
  id: string;
  plan_id: string;
  status: TransferStatus;
  from_name: string;
  to_name: string;
  keep_role: KeepRole;
  message: string | null;
  expires_at: string;
  created_at: string | null;
  responded_at: string | null;
  is_recipient: boolean;
  is_sender: boolean;
  plan_title?: string | null;
}

export interface OwnershipInfo {
  plan_id: string;
  role: string;
  pending: OwnershipTransfer | null;
  transfer_in_progress: boolean;
  candidates: Array<{ collaborator_id: string; name: string; role: string }>;
  can_transfer: boolean;
  transfer_days: number;
}

// ===== FR-039 訂正
export type CorrectionSource = 'self_statement' | 'official_document' | 'booking_document' | 'other';

export interface SelfCorrection {
  id: string;
  kind: 'self';
  field: 'username' | 'email';
  field_label: string;
  before: string | null;
  after: string | null;
  source: CorrectionSource;
  source_label: string;
  source_note: string | null;
  verification: 'password' | 'session';
  status: 'applied' | 'reverted';
  created_at: string | null;
  reverted_at: string | null;
}

export interface CorrectionRequest {
  id: string;
  kind: 'request';
  plan_id: string;
  field: string;
  field_label: string | null;
  current_value: string | null;
  proposed_value: string | null;
  source: CorrectionSource;
  source_label: string;
  source_note: string | null;
  status: 'open' | 'resolved' | 'declined';
  resolution_note: string | null;
  created_at: string | null;
  resolved_at: string | null;
  requester_name?: string;
  plan_title?: string | null;
}

export interface CorrectionsOverview {
  history: SelfCorrection[];
  requests: CorrectionRequest[];
  fields: Array<{ field: 'username' | 'email'; label: string; requires_password: boolean }>;
  sources: Array<{ source: CorrectionSource; label: string }>;
  current: { username: string | null; email: string | null };
}

// ===== FR-004 定期の処理
export type JobState = 'ok' | 'overdue' | 'failing' | 'never';

export interface OpsJob {
  job: string;
  expected_minutes: number;
  state: JobState;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_ok: boolean | null;
  last_error: string | null;
  last_success_at: string | null;
  minutes_since_success: number | null;
  consecutive_failures: number;
}

export interface OpsJobs {
  jobs: OpsJob[];
  attention: string[];
}
