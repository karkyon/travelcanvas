/**
 * [Gate G8] 所有者の移譲・出典つきの訂正・定期の処理の記録 の応答の decoder
 * (使う画面が g8.ts 経由で読む。最初に読む JS に入れない)。
 */
import type {
  CorrectionRequest, CorrectionsOverview, OpsJob, OpsJobs, OwnershipInfo, OwnershipTransfer, SelfCorrection,
} from './types/g8';
import {
  arrayOf, bool, decodeResponse, nonNegativeInt, nullable, object, oneOf, optional, str,
  type Decoder,
} from './decode';

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
