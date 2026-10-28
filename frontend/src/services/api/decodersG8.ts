/**
 * [Gate G8] 分岐の区間・予約の変更と選んで採用・所有者の移譲・出典つきの訂正・定期の処理の記録 の応答の decoder
 * (使う画面が g8.ts 経由で読む。最初に読む JS に入れない)。
 */
import type {
  AdoptionPreview, AdoptResultG8, BaseReservation, BaseSegment, BranchResources, CorrectionRequest,
  CorrectionsOverview, OpsJob, OpsJobs, OwnershipInfo, OwnershipTransfer, PreviewConflict, PreviewItem, ReservationOp,
  ResourceSummary, SegmentOp, SelfCorrection,
} from './types/g8';
import {
  arrayOf, bool, decodeResponse, int, nonNegativeInt, nullable, num, object, oneOf, optional, record, str,
  type Decoder,
} from './decode';

const mode = oneOf('walking', 'driving', 'train', 'bus', 'ferry', 'flight', 'bicycle', 'taxi', 'mixed',
  'shinkansen', 'helicopter');  // [Gate G11]
const segStatus = oneOf('planned', 'confirmed', 'cancelled');

const baseSegment: Decoder<BaseSegment> = object<BaseSegment>({
  id: str, from_event_id: nullable(str), to_event_id: nullable(str), from_place_id: nullable(str),
  to_place_id: nullable(str), mode, status: segStatus, planned_departure_at: nullable(str),
  planned_arrival_at: nullable(str), last_departure_at: nullable(str), duration_minutes: nullable(num),
  distance_km: nullable(num), cost: nullable(str), currency: nullable(str), transport_number: nullable(str),
  platform: nullable(str), preparation_minutes: nonNegativeInt, buffer_before_minutes: nonNegativeInt,
  reservation_id: nullable(str),
});

const baseReservation: Decoder<BaseReservation> = object<BaseReservation>({
  id: str, label: str, type: str, status: str, event_id: nullable(str), event_ids: arrayOf(str), locked: bool,
  total_amount: nullable(num), currency: nullable(str), cancellation_deadline: nullable(str),
});

/** 変更の一覧は backend が検証済みの形(op ごとの必須の項目だけを確かめる) */
const segmentOp: Decoder<SegmentOp> = (raw, path) => {
  const v = record(raw, path);
  const op = oneOf('update', 'remove', 'add')(v.op, `${path}.op`);
  if (op === 'add') {
    str(v.key, `${path}.key`);
    record(v.fields, `${path}.fields`);
  } else {
    str(v.segment_id, `${path}.segment_id`);
    if (op === 'update') record(v.fields, `${path}.fields`);
  }
  return v as unknown as SegmentOp;
};

const reservationOp: Decoder<ReservationOp> = (raw, path) => {
  const v = record(raw, path);
  oneOf('relink', 'cancel')(v.op, `${path}.op`);
  str(v.reservation_id, `${path}.reservation_id`);
  return v as unknown as ReservationOp;
};

const resources: Decoder<BranchResources> = object<BranchResources>({
  algorithm_version: str, base_segments: arrayOf(baseSegment), base_reservations: arrayOf(baseReservation),
  segments: arrayOf(segmentOp), reservations: arrayOf(reservationOp), reservations_hidden: bool, costs_hidden: bool,
});

const resourceSummary: Decoder<ResourceSummary> = object<ResourceSummary>({
  segments_added: nonNegativeInt, segments_removed: nonNegativeInt, segments_updated: nonNegativeInt,
  reservations_relinked: nonNegativeInt, reservations_cancel_planned: nonNegativeInt,
});

/** 分岐案の詳細(BranchDetail)に G8 で足した項目。以前の応答(項目なし)は空として読む */
export interface BranchG8Extras {
  resources: BranchResources;
  resource_summary: ResourceSummary;
}

const emptyResources: BranchResources = {
  algorithm_version: 'branch-v1', base_segments: [], base_reservations: [], segments: [], reservations: [],
  reservations_hidden: false, costs_hidden: false,
};
const emptySummary: ResourceSummary = {
  segments_added: 0, segments_removed: 0, segments_updated: 0, reservations_relinked: 0,
  reservations_cancel_planned: 0,
};

const branchExtras: Decoder<BranchG8Extras> = object<BranchG8Extras>({
  resources: (v, path) => (v === undefined ? emptyResources : resources(v, path)),
  resource_summary: (v, path) => (v === undefined ? emptySummary : resourceSummary(v, path)),
});

const kind = oneOf('event', 'segment', 'reservation');
const previewItem: Decoder<PreviewItem> = object<PreviewItem>({
  op_id: str, kind, op: str, label: str, selected: bool, requires: arrayOf(str),
});
const previewConflict: Decoder<PreviewConflict> = object<PreviewConflict>({
  kind, op_id: str, op: optional(str), reason: str, fields: optional(arrayOf(str)), label: optional(str),
  title: optional(str),
});
const preview: Decoder<AdoptionPreview> = object<AdoptionPreview>({
  branch_id: str, algorithm_version: str, items: arrayOf(previewItem), conflicts: arrayOf(previewConflict),
  missing_dependencies: arrayOf(object({ op_id: str, requires: arrayOf(str) })),
  tasks: arrayOf(object({ title: str, due_at: nullable(str) })), reservations_hidden: bool, can_adopt: bool,
  partial: bool,
});
const adoptResult: Decoder<AdoptResultG8> = object<AdoptResultG8>({
  plan_revision: int, left_out: (v, path) => (v === undefined ? [] : arrayOf(str)(v, path)),
  tasks_created: (v, path) => (v === undefined ? 0 : nonNegativeInt(v, path)),
});

// ===== FR-021
const transferStatus = oneOf('pending', 'accepted', 'declined', 'cancelled', 'expired');
const transfer: Decoder<OwnershipTransfer> = object<OwnershipTransfer>({
  id: str, plan_id: str, status: transferStatus, from_name: str, to_name: str,
  keep_role: oneOf('editor', 'viewer', 'none'), message: nullable(str), expires_at: str, created_at: nullable(str),
  responded_at: nullable(str), is_recipient: bool, is_sender: bool, plan_title: optional(nullable(str)),
});
const ownershipInfo: Decoder<OwnershipInfo> = object<OwnershipInfo>({
  plan_id: str, role: str, pending: nullable(transfer), transfer_in_progress: bool,
  candidates: arrayOf(object({ collaborator_id: str, name: str, role: str })), can_transfer: bool,
  transfer_days: nonNegativeInt,
});

// ===== FR-039
const source = oneOf('self_statement', 'official_document', 'booking_document', 'other');
const selfCorrection: Decoder<SelfCorrection> = object<SelfCorrection>({
  id: str, kind: oneOf('self'), field: oneOf('username', 'email'), field_label: str, before: nullable(str),
  after: nullable(str), source, source_label: str, source_note: nullable(str),
  verification: oneOf('password', 'session'), status: oneOf('applied', 'reverted'), created_at: nullable(str),
  reverted_at: nullable(str),
});
const correctionRequest: Decoder<CorrectionRequest> = object<CorrectionRequest>({
  id: str, kind: oneOf('request'), plan_id: str, field: str, field_label: nullable(str),
  current_value: nullable(str), proposed_value: nullable(str), source, source_label: str,
  source_note: nullable(str), status: oneOf('open', 'resolved', 'declined'), resolution_note: nullable(str),
  created_at: nullable(str), resolved_at: nullable(str), requester_name: optional(str),
  plan_title: optional(nullable(str)),
});
const correctionsOverview: Decoder<CorrectionsOverview> = object<CorrectionsOverview>({
  history: arrayOf(selfCorrection), requests: arrayOf(correctionRequest),
  fields: arrayOf(object({ field: oneOf('username', 'email'), label: str, requires_password: bool })),
  sources: arrayOf(object({ source, label: str })),
  current: object({ username: nullable(str), email: nullable(str) }),
});

// ===== FR-004
const opsJob: Decoder<OpsJob> = object<OpsJob>({
  job: str, expected_minutes: nonNegativeInt, state: oneOf('ok', 'overdue', 'failing', 'never'),
  last_started_at: nullable(str), last_finished_at: nullable(str), last_ok: nullable(bool), last_error: nullable(str),
  last_success_at: nullable(str), minutes_since_success: nullable(nonNegativeInt),
  consecutive_failures: nonNegativeInt,
});
const opsJobs: Decoder<OpsJobs> = object<OpsJobs>({ jobs: arrayOf(opsJob), attention: arrayOf(str) });

export interface G8Types {
  branchExtras: BranchG8Extras;
  preview: AdoptionPreview;
  adopt: AdoptResultG8;
  ownershipInfo: OwnershipInfo;
  transfer: OwnershipTransfer;
  transfers: OwnershipTransfer[];
  corrections: CorrectionsOverview;
  selfCorrection: SelfCorrection;
  correctionRequest: CorrectionRequest;
  correctionRequests: CorrectionRequest[];
  opsJobs: OpsJobs;
}

const G8: { [K in keyof G8Types]: [Decoder<G8Types[K]>, string] } = {
  branchExtras: [branchExtras, 'GET /plans/{plan_id}/branches/{branch_id}'],
  preview: [preview, 'GET /plans/{plan_id}/branches/{branch_id}/adoption-preview'],
  adopt: [adoptResult, 'POST /plans/{plan_id}/branches/{branch_id}/adopt'],
  ownershipInfo: [ownershipInfo, 'GET /plans/{plan_id}/ownership-transfer'],
  transfer: [transfer, 'POST /plans/{plan_id}/ownership-transfer'],
  transfers: [arrayOf(transfer), 'GET /ownership-transfers/incoming'],
  corrections: [correctionsOverview, 'GET /privacy/corrections'],
  selfCorrection: [selfCorrection, 'POST /privacy/corrections'],
  correctionRequest: [correctionRequest, 'POST /plans/{plan_id}/correction-requests'],
  correctionRequests: [arrayOf(correctionRequest), 'GET /plans/{plan_id}/correction-requests'],
  opsJobs: [opsJobs, 'GET /admin/ops/jobs'],
};

export function decodeG8<K extends keyof G8Types>(key: K, data: unknown): G8Types[K] {
  const [decoder, label] = G8[key];
  return decodeResponse(data, decoder, label);
}
