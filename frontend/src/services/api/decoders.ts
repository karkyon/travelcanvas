/**
 * [Gate M9-FE-C2b] 誤った値が流れ込むと実害が大きい応答のdecoder。
 *
 * - revision: 楽観的並行制御(If-Match)に使う版番号。数値以外が混入すると
 *   以降の更新が全て409(競合)になるか、誤った版で上書きしかねない。
 * - 当日モード(NOW/NEXT): 旅行当日に表示する時刻・場所。欠落は誤案内に直結する。
 * - 文書のダウンロードURL: 署名付きURLと有効期限。
 * - 予約・チケットの開示(reveal): 確認番号・PIN・QR payloadなど秘匿情報。
 *
 * 各decoderの形状は backend の Pydantic モデル/戻り値に合わせている
 * (backend/app/api/v1/plans.py TodayResponse、reservations.py
 *  ReservationRevealResponse/TicketRevealResponse、documents.py download-url、
 *  plans.py/segments.py/route_options.py の削除・Undo応答)。
 *
 * [Gate M9-FE-C2b-2] 予約・参加者・イベント紐付け・チケット・移動区間・経路候補・
 * 予約取込・文書の一覧/詳細/作成/更新応答へ拡大。列挙値の許容集合はbackendの定義
 * (segments.py MODES/STATUSES、route_options.py STATUSES/REALTIME_STATUSES、
 *  models.py ImportJobStatus/ExtractionCandidateReviewStatus/DocumentClassification/
 *  TicketStatus/TicketSharePolicy)と一致させている。実backendの応答で検証した契約
 * fixture: __fixtures__/backendContractResponses.json。
 */
import type { VisitAssessment, VisitCorrectionResult, VisitItem, VisitsOverview } from './types/visits';
import type { CandidateList, PlaceInfo, PlanCandidateItem, PlanPlaces } from './types/candidates';
import type { SearchHit, SearchResults } from './types/planSearch';
import type { PublicSharedReservation, ShareFieldInfo, ShareFieldKey, SharePolicyCatalog, SharePreview, ShareWithheld } from './types/share';
import type { AdoptRouteOptionResponse, Collaborator, InsertionPreview, LegPreview, OptimizationProposal, PlaceDetail, PublicSharedDay, PublicSharedEvent, PublicSharedPlan, RoutePreview, ShareLink, DocumentLink, ExtractionCandidate, ImportJob, ImportJobDetail, Reservation, ReservationEventLink, ReservationParticipant, ReservationRevealResult, RouteLeg, RouteOption, Ticket, TicketRevealResult, TodayEvent, TodayResponse, TravelDocument, TravelSegment, ConstraintValue, PlanConstraint, AdminManageResult, AdminPagination, AdminSystemStats, AdminUserDetail, AdminUserRow, AdminUsersPage, AuditLogEntry, AuditLogPage, PlanPrivateProfile, PresenceChange, PresenceState, PresenceViewer, PrivateProfile, PrivateProfileItem, ConstraintCheckResult, ValidationCounts, ValidationIssue, ValidationRunDetail, ValidationRunSummary, DeletedPlanSummary, PlanPurgeResult, CollaboratorRemoveResult, LockedRelationDetail, RouteOptionDeleteResult, UndoConflictDetail, PackingItem, PackingSuggestions, PlanMember, PreparationTask, Readiness, ReadinessItem, Budget, BudgetDiff, Expense, ExpenseShare, FinanceSettings, FinanceSummary, Settlement, PlanComment, Poll, PollOption, PollVote, Booklet, BookletExport, BookletIncludes, RetentionInfo, Branch, BranchAssumptions, BranchDetail, CalendarImportPreview, CalendarImportResult, AccountDeletionPreview, AccountDeletionResult, ConsentState, AlertList, PlanAlert, Replan, ReplanApplyResult, ReplanErrorDetail, OptimizationApplyResult, OptimizationCandidates, OptimizationIssue, OptimizationMetrics, SyncConflictDetail, SyncConflictList, SyncResolveResult, SyncResponse, JournalDraft, JournalMemory, MemoryList, TravelMemory, LocationTrack, LocationTrackDetail, LocationTrackList, TrackPointsDeleteResult, TrackPointsUploadResult, AreaCell, AreaCellsUploadResult, LocationSettings, TrackSampling, ActualPutResult, CarryOverResult, EventActualRecord, JourneyReview, AtlasCell, AtlasResponse, MemoryReplanApplyResult, MemoryReplanResult, ReplanInsight, OfflinePackKey, OfflinePackKeyRotated } from './types';
import { arrayOf, bool, exactNumber, int, matching, nonNegativeInt, nullable, num, object, oneOf, optional, record, str, unitInterval, type Decoder } from './decode';
import { count } from './decodersCore';

// [Gate G9] Q03 起動に要る decoder は decodersCore.ts へ移した(ここから同じ名前で公開し直す)。
// 起動の経路(auth・plans・notifications の endpoint)以外は、この塊を使う時に読み込む。
export {
  revisionResult,
  deletionImpact,
  itemDeleteResult,
  normalizedEvent,
  normalizedDay,
  normalizedPlanDetail,
  promoteQuickDraftResult,
  legacyTravelPlan,
  notification,
  unreadCount,
  user,
  authUser,
  authResponse,
  mfaChallenge,
  loginResult,
  mfaStatus,
  mfaSetup,
  mfaRecoveryCodes,
  activeSession,
  guestSessionResponse,
  planDeleteResult,
  count,
} from './decodersCore';
export type { RevisionResult, LegacyTravelPlanCore, UnreadCount } from './decodersCore';

export const routeOptionDeleteResult: Decoder<RouteOptionDeleteResult> = object<RouteOptionDeleteResult>({
  revision: int,
  detached: optional(object<{ segments_unlinked: number }>({ segments_unlinked: count })),
});

/** 確定ロックされた紐付けがあり削除できない409の応答本体 `{detail}` */
export const lockedRelationError: Decoder<{ detail: LockedRelationDetail }> = object<{ detail: LockedRelationDetail }>({
  detail: object<LockedRelationDetail>({
    code: oneOf('locked_relation'),
    message: str,
    blocking: arrayOf(object<LockedRelationDetail['blocking'][number]>({
      type: str, id: str, event_id: str, reservation_id: str, reason: str,
    })),
  }),
});

/** Undoで戻す先が変わっていて取り消せない409の応答本体 `{detail}` */
export const undoConflictError: Decoder<{ detail: UndoConflictDetail }> = object<{ detail: UndoConflictDetail }>({
  detail: object<UndoConflictDetail>({
    code: oneOf('undo_conflict'),
    message: str,
    conflicts: arrayOf(object<UndoConflictDetail['conflicts'][number]>({ type: str, id: nullable(str), reason: str })),
  }),
});

export const collaboratorRemoveResult: Decoder<CollaboratorRemoveResult> = object<CollaboratorRemoveResult>({
  success: bool,
  detached: optional(object<{ ticket_holders: number; participants: number }>({
    ticket_holders: count,
    participants: count,
  })),
});

export const todayEvent: Decoder<TodayEvent> = object<TodayEvent>({
  id: str,
  title: str,
  event_type: str,
  start_at: nullable(str),
  end_at: nullable(str),
  local_start_time: nullable(str),
  address: nullable(str),
  latitude: nullable(num),
  longitude: nullable(num),
  has_ticket: bool,
  reservation_id: nullable(str),
  time_source: nullable(oneOf('start_at', 'local_start_time')),
  departure_at: nullable(str),
  transport_mode: nullable(str),
  transport_status: nullable(oneOf('unknown', 'on_time', 'delayed', 'cancelled')),
});

export const todayResponse: Decoder<TodayResponse> = object<TodayResponse>({
  plan_id: str,
  today_date: nullable(str),
  timezone_id: nullable(str),
  server_time: str,
  now_event: nullable(todayEvent),
  next_event: nullable(todayEvent),
  minutes_until_next: nullable(int),
  day_end_at: nullable(str),
  events: arrayOf(todayEvent),
});

export interface DownloadUrlResult {
  url: string;
  expires_at: number;
}

export const downloadUrlResult: Decoder<DownloadUrlResult> = object<DownloadUrlResult>({
  url: str,
  expires_at: int,
});

export const reservationRevealResult: Decoder<ReservationRevealResult> = object<ReservationRevealResult>({
  id: str,
  confirmation_number: nullable(str),
  pin: nullable(str),
});

export const ticketRevealResult: Decoder<TicketRevealResult> = object<TicketRevealResult>({
  id: str,
  payload: nullable(str),
  barcode_format: nullable(str),
});

// ===== [Gate M9-FE-C2b-2] 予約(FR-010) =====

export const reservation: Decoder<Reservation> = object<Reservation>({
  id: str,
  plan_id: str,
  event_id: nullable(str),
  place_id: nullable(str),
  type: str,
  status: str,
  provider_name: nullable(str),
  confirmation_number_masked: nullable(str),
  has_pin: bool,
  holder_name: nullable(str),
  guest_count: nullable(int),
  start_at: nullable(str),
  end_at: nullable(str),
  timezone_id: nullable(str),
  total_amount: nullable(num),
  currency: nullable(str),
  payment_status: nullable(str),
  cancellation_deadline: nullable(str),
  contact_phone: nullable(str),
  contact_url: nullable(str),
  notes: nullable(str),
  revision: int,
  created_at: str,
  updated_at: nullable(str),
});

export const reservationParticipant: Decoder<ReservationParticipant> = object<ReservationParticipant>({
  id: str,
  reservation_id: str,
  plan_member_id: nullable(str),
  name: str,
  seat: nullable(str),
  special_request: nullable(str),
  revision: int,
  created_at: str,
  updated_at: nullable(str),
});

export const reservationEventLink: Decoder<ReservationEventLink> = object<ReservationEventLink>({
  id: str,
  event_id: str,
  reservation_id: str,
  relation_type: str,
  is_locked: bool,
  created_at: str,
  updated_at: nullable(str),
});

// ===== [Gate M9-FE-C2b-2] チケット(FR-012) =====

export const ticket: Decoder<Ticket> = object<Ticket>({
  id: str,
  reservation_id: str,
  ticket_type: str,
  holder_member_id: nullable(str),
  has_payload: bool,
  barcode_format: nullable(str),
  valid_from: nullable(str),
  valid_to: nullable(str),
  status: oneOf('active', 'used', 'expired', 'revoked'),
  offline_allowed: bool,
  share_policy: oneOf('owner_editor', 'all_collaborators'),
  revision: int,
  created_at: str,
  updated_at: nullable(str),
});

// ===== [Gate M9-FE-C2b-2] 移動区間(FR-014) =====

const segmentMode = oneOf('walking', 'driving', 'train', 'bus', 'ferry', 'flight', 'bicycle', 'taxi', 'mixed',
  'shinkansen', 'helicopter', 'express_bus');  // [Gate G11]

export const travelSegment: Decoder<TravelSegment> = object<TravelSegment>({
  id: str,
  plan_id: str,
  from_event_id: nullable(str),
  from_place_id: nullable(str),
  to_event_id: nullable(str),
  to_place_id: nullable(str),
  mode: segmentMode,
  status: oneOf('planned', 'confirmed', 'cancelled'),
  planned_departure_at: nullable(str),
  planned_arrival_at: nullable(str),
  distance_km: nullable(num),
  duration_minutes: nullable(num),
  // backendのDecimalは精度保持のため文字列で届く(Pydantic v2のJSON直列化)
  cost: nullable(str),
  currency: nullable(str),
  preparation_minutes: int,
  buffer_before_minutes: int,
  buffer_after_minutes: int,
  transport_number: nullable(str),
  platform: nullable(str),
  transfer_count: nullable(int),
  luggage_note: nullable(str),
  reservation_id: nullable(str),
  is_estimate: bool,
  provider: str,
  algorithm_version: str,
  computed_at: str,
  recommended_departure_at: nullable(str),
  revision: int,
  created_at: str,
  updated_at: nullable(str),
});

// ===== [Gate M9-FE-C2b-2] 経路比較(FR-015) =====

export const routeLeg: Decoder<RouteLeg> = object<RouteLeg>({
  id: str,
  route_option_id: str,
  leg_order: int,
  mode: segmentMode,
  line: nullable(str),
  operator: nullable(str),
  platform: nullable(str),
  from_label: nullable(str),
  to_label: nullable(str),
  departure_at: nullable(str),
  arrival_at: nullable(str),
  distance_km: nullable(num),
  duration_minutes: nullable(num),
  realtime_status: oneOf('unknown', 'on_time', 'delayed', 'cancelled'),
  created_at: str,
  updated_at: nullable(str),
});

export const routeOption: Decoder<RouteOption> = object<RouteOption>({
  id: str,
  plan_id: str,
  from_event_id: nullable(str),
  from_place_id: nullable(str),
  to_event_id: nullable(str),
  to_place_id: nullable(str),
  status: oneOf('candidate', 'adopted', 'discarded'),
  total_duration_minutes: nullable(num),
  total_cost: nullable(str),
  currency: nullable(str),
  total_distance_km: nullable(num),
  walking_minutes: nullable(num),
  transfer_count: nullable(int),
  accessibility_score: nullable(num),
  scenic_score: nullable(num),
  co2_estimate_kg: nullable(num),
  duration_estimate_low_minutes: nullable(num),
  duration_estimate_high_minutes: nullable(num),
  provider: str,
  retrieved_at: str,
  expires_at: nullable(str),
  is_estimate: bool,
  algorithm_version: str,
  revision: int,
  created_at: str,
  updated_at: nullable(str),
  legs: arrayOf(routeLeg),
});

export const adoptRouteOptionResponse: Decoder<AdoptRouteOptionResponse> = object<AdoptRouteOptionResponse>({
  revision: int,
  route_option: routeOption,
  segment_id: str,
});

// ===== [Gate M9-FE-C2b-2] 予約取込(FR-011) =====

export const importJob: Decoder<ImportJob> = object<ImportJob>({
  id: str,
  plan_id: str,
  document_id: nullable(str),
  provider: str,
  status: oneOf(
    'uploaded', 'scanning', 'extracting', 'review_required', 'confirmed', 'rejected',
    'quarantined', 'retry_wait', 'failed',
  ),
  consent_given: bool,
  error_message: nullable(str),
  result_reservation_id: nullable(str),
  started_at: str,
  completed_at: nullable(str),
  created_at: str,
  updated_at: nullable(str),
});

export const extractionCandidate: Decoder<ExtractionCandidate> = object<ExtractionCandidate>({
  id: str,
  import_job_id: str,
  field_path: str,
  value: nullable(str),
  confidence: num,
  evidence_locator: nullable(str),
  review_status: oneOf('pending', 'accepted', 'rejected'),
  reviewed_by_user_id: nullable(str),
  reviewed_at: nullable(str),
  created_at: str,
});

export const importJobDetail: Decoder<ImportJobDetail> = (value, path) => {
  const job = importJob(value, path);
  const candidates = object<{ candidates: ExtractionCandidate[] }>({
    candidates: arrayOf(extractionCandidate),
  })(value, path).candidates;
  return { ...job, candidates };
};

// ===== [Gate M9-FE-C2b-2] 文書ウォレット(FR-013) =====

export const travelDocument: Decoder<TravelDocument> = object<TravelDocument>({
  id: str,
  plan_id: str,
  owner_user_id: nullable(str),
  classification: oneOf('public', 'internal', 'confidential', 'restricted'),
  document_type: nullable(str),
  original_filename: nullable(str),
  mime_type: nullable(str),
  size: nullable(int),
  sha256: nullable(str),
  malware_status: str,
  ocr_status: str,
  retention_until: nullable(str),
  revision: int,
  created_at: str,
  updated_at: nullable(str),
});

export const documentLink: Decoder<DocumentLink> = object<DocumentLink>({
  id: str,
  document_id: str,
  entity_type: str,
  entity_id: str,
  relation_type: str,
  display_order: int,
  created_at: str,
});

// ===== [Gate M9-FE-C2b-3] PLAN MAP・最適化 =====

export const legPreview: Decoder<LegPreview> = object<LegPreview>({
  from_event_id: optional(nullable(str)),
  to_event_id: optional(nullable(str)),
  mode: str,
  distance_km: optional(nullable(num)),
  duration_minutes: optional(nullable(num)),
  is_estimate: bool,
  unknown: bool,
});

export const routePreview: Decoder<RoutePreview> = object<RoutePreview>({
  day_id: str,
  legs: arrayOf(legPreview),
  total_distance_km: optional(nullable(num)),
  total_duration_minutes: optional(nullable(num)),
  provider: str,
  algorithm_version: str,
});

export const insertionPreview: Decoder<InsertionPreview> = object<InsertionPreview>({
  day_id: str,
  before: routePreview,
  after: routePreview,
  added_distance_km: optional(nullable(num)),
  added_duration_minutes: optional(nullable(num)),
  unknown: bool,
});

export const optimizationProposal: Decoder<OptimizationProposal> = object<OptimizationProposal>({
  day_id: str,
  base_revision: int,
  algorithm: str,
  algorithm_version: str,
  proposed_order: arrayOf(str),
  locked_event_ids: arrayOf(str),
  before_total_distance_km: optional(nullable(num)),
  after_total_distance_km: optional(nullable(num)),
  before_total_duration_minutes: optional(nullable(num)),
  after_total_duration_minutes: optional(nullable(num)),
  saved_distance_km: optional(nullable(num)),
  saved_duration_minutes: optional(nullable(num)),
  warnings: arrayOf(str),
  has_improvement: bool,
});

// ===== [Gate M9-FE-C2b-3] Place =====

export const placeDetail: Decoder<PlaceDetail> = object<PlaceDetail>({
  id: str,
  name: str,
  category: optional(nullable(str)),
  location: object<PlaceDetail['location']>({
    latitude: optional(nullable(num)),
    longitude: optional(nullable(num)),
    address: optional(nullable(str)),
  }),
});

// ===== [Gate M9-FE-C2b-3] 共有・招待・公開共有 =====

// [Gate F45] FR-045 共有リンクで選べる項目
const shareFieldKey = oneOf<ShareFieldKey>(
  'plan_description', 'day_titles', 'event_times', 'event_address', 'event_notes', 'reservation_summary',
);

export const shareLink: Decoder<ShareLink> = object<ShareLink>({
  id: str,
  plan_id: str,
  url: nullable(str),
  token_prefix: str,
  permission: oneOf('view', 'edit'),
  has_passcode: bool,
  max_uses: nullable(int),
  use_count: int,
  last_accessed_at: optional(nullable(str)),
  expires_at: optional(nullable(str)),
  revoked_at: optional(nullable(str)),
  is_active: bool,
  created_at: str,
  fields: arrayOf(shareFieldKey),
});

export const collaborator: Decoder<Collaborator> = object<Collaborator>({
  id: str,
  // 未登録メールアドレスへの招待では空文字(backend _collaborator_to_dict)
  user_id: str,
  plan_id: str,
  role: oneOf('viewer', 'editor', 'owner'),
  email: str,
  name: optional(nullable(str)),
  status: oneOf('pending', 'accepted', 'declined'),
  decided_at: optional(nullable(str)),
  plan_title: optional(nullable(str)),
});

const publicSharedEvent: Decoder<PublicSharedEvent> = object<PublicSharedEvent>({
  title: str,
  event_type: str,
  local_start_time: optional(nullable(str)),
  is_all_day: bool,
  address: optional(str),
  notes: optional(str),
});

const publicSharedReservation: Decoder<PublicSharedReservation> = object<PublicSharedReservation>({
  type: str,
  provider_name: optional(nullable(str)),
  status: str,
  start: optional(nullable(str)),
  end: optional(nullable(str)),
});

const publicSharedDay: Decoder<PublicSharedDay> = object<PublicSharedDay>({
  date: nullable(str),
  title: nullable(str),
  events: arrayOf(publicSharedEvent),
});

export const publicSharedPlan: Decoder<PublicSharedPlan> = object<PublicSharedPlan>({
  plan_id: str,
  title: str,
  description: optional(nullable(str)),
  destination: optional(nullable(str)),
  start_date: optional(nullable(str)),
  end_date: optional(nullable(str)),
  days: arrayOf(publicSharedDay),
  permission: oneOf('view', 'edit'),
  can_edit: bool,
  fields: optional(arrayOf(shareFieldKey)),
  reservations: optional(arrayOf(publicSharedReservation)),
});

// [Gate F45] 所有者の共有前プレビュー
const sharePresetFields = arrayOf(shareFieldKey);
export const sharePreview: Decoder<SharePreview> = object<SharePreview>({
  fields: arrayOf(shareFieldKey),
  view: publicSharedPlan,
  withheld: object<ShareWithheld>({
    reservations: nonNegativeInt, confirmation_numbers: nonNegativeInt, tickets: nonNegativeInt,
    documents: nonNegativeInt, exact_locations: nonNegativeInt, event_addresses: nonNegativeInt,
    event_notes: nonNegativeInt,
  }),
  catalog: object<SharePolicyCatalog>({
    fields: arrayOf(object<ShareFieldInfo>({
      key: shareFieldKey, classification: oneOf('internal', 'confidential'), label: str, description: str,
    })),
    restricted: arrayOf(object<{ key: string; label: string }>({ key: str, label: str })),
    always: arrayOf(str),
    presets: object<SharePolicyCatalog['presets']>({
      minimal: sharePresetFields, standard: sharePresetFields, all: sharePresetFields,
    }),
  }),
});

// ----- [Gate L2] 制約(FR-016)。backend/app/api/v1/constraints.py の応答。
// 列挙値はbackendの CONSTRAINT_TYPES / OPERATORS / SCOPE_TYPES と一致させる。
// 他人の秘匿制約(visibility='masked')では題名・種類・値・理由などがnullになる。
const strOrNum: Decoder<string | number> = (v, path) =>
  typeof v === 'number' ? num(v, path) : str(v, path);

export const constraintValue: Decoder<ConstraintValue> = object<ConstraintValue>({
  value: nullable(strOrNum),
  value_to: nullable(str),
  unit: nullable(str),
});

export const planConstraint: Decoder<PlanConstraint> = object<PlanConstraint>({
  id: str,
  plan_id: str,
  visibility: oneOf('full', 'masked', 'unavailable'),
  is_mine: bool,
  hardness: oneOf('hard', 'soft'),
  privacy_level: oneOf('shared', 'private'),
  scope_type: oneOf('plan', 'day', 'event', 'member'),
  is_active: bool,
  created_at: nullable(str),
  title: nullable(str),
  constraint_type: nullable(oneOf(
    'reservation', 'opening_hours', 'last_transport', 'meeting', 'budget_limit', 'forbidden',
    'preference', 'fatigue', 'scenery', 'meal_interval', 'avoid_transport', 'priority',
  )),
  operator: nullable(oneOf('before', 'after', 'between', 'max', 'min', 'equals', 'not_equals', 'avoid', 'prefer')),
  value: nullable(constraintValue),
  weight: nullable(int),
  scope_id: nullable(str),
  scope_label: nullable(str),
  scope_missing: bool,
  active_from: nullable(str),
  active_to: nullable(str),
  reason: nullable(str),
  has_reason: bool,
  revision: nullable(int),
  updated_at: nullable(str),
  from_profile: optional(bool),
});

// ----- [Gate L3] 実行可能性検証(FR-017)。backend/app/api/v1/validation.py の応答。
// 件数と検証不能の区別を誤ると「問題なし」と誤表示するため、数値と列挙値を厳密に検査する。
export const validationCounts: Decoder<ValidationCounts> = object<ValidationCounts>({
  error: int,
  warning: int,
  info: int,
  unverified: int,
});

const validationSummaryShape = {
  id: str,
  plan_id: str,
  status: oneOf('completed', 'failed'),
  algorithm_version: str,
  input_revision: int,
  is_stale: bool,
  started_at: str,
  finished_at: nullable(str),
  created_by_me: bool,
  counts: validationCounts,
};

export const validationRunSummary: Decoder<ValidationRunSummary> = object<ValidationRunSummary>(validationSummaryShape);

export const validationIssue: Decoder<ValidationIssue> = object<ValidationIssue>({
  id: str,
  code: str,
  kind: oneOf('violation', 'unverified'),
  severity: oneOf('ERROR', 'WARNING', 'INFO'),
  message: str,
  entity_type: nullable(str),
  entity_id: nullable(str),
  entity_label: nullable(str),
  day_id: nullable(str),
  constraint_id: nullable(str),
  constraint_title: nullable(str),
  is_private_constraint: bool,
  is_masked: bool,
  evidence: nullable(record),
  suggestion: nullable(record),
});

export const constraintCheckResult: Decoder<ConstraintCheckResult> = object<ConstraintCheckResult>({
  constraint_id: str,
  status: oneOf('satisfied', 'violated', 'unverified', 'not_applicable'),
  is_private: bool,
  is_mine: bool,
  constraint_title: nullable(str),
});

export const validationRunDetail: Decoder<ValidationRunDetail> = object<ValidationRunDetail>({
  ...validationSummaryShape,
  unchecked: record,
  constraint_results: arrayOf(constraintCheckResult),
  issues: arrayOf(validationIssue),
});

// ----- [Gate B-012] 削除済みプラン。backend/app/api/v1/travel.py の応答。
// 復元期限(purge_after)を誤って表示すると、利用者が期限切れに気づかず復元できなくなるため必須とする。
export const deletedPlanSummary: Decoder<DeletedPlanSummary> = object<DeletedPlanSummary>({
  id: str,
  title: str,
  destination: nullable(str),
  start_date: nullable(str),
  end_date: nullable(str),
  deleted_at: str,
  purge_after: str,
});

export const planPurgeResult: Decoder<PlanPurgeResult> = object<PlanPurgeResult>({ message: str });

// ----- [Gate P1] 持ち物(FR-025)・準備タスク/レディネス(FR-026)。backend/app/api/v1/preparation.py の応答。
// 件数を誤ると「準備完了」と誤表示するため、件数・列挙値・真偽値を厳密に検査する。
const PACKING_CATEGORIES = ['clothing', 'toiletries', 'health', 'documents', 'electronics', 'money', 'gear', 'other'] as const;

export const planMember: Decoder<PlanMember> = object<PlanMember>({
  user_id: str,
  name: str,
  role: oneOf('owner', 'editor', 'viewer'),
  is_me: bool,
});

export const packingItem: Decoder<PackingItem> = object<PackingItem>({
  id: str,
  plan_id: str,
  scope: oneOf('shared', 'personal'),
  is_mine: bool,
  visibility: oneOf('full', 'unavailable'),
  name: nullable(str),
  note: nullable(str),
  category: oneOf(...PACKING_CATEGORIES),
  quantity: int,
  is_required: bool,
  status: oneOf('to_prepare', 'to_buy', 'packed', 'after_use'),
  source: oneOf('manual', 'suggested'),
  suggestion_key: nullable(str),
  assignee_user_id: nullable(str),
  assignee_name: nullable(str),
  assignee_missing: bool,
  revision: int,
  created_at: nullable(str),
  updated_at: nullable(str),
});

export const packingSuggestions: Decoder<PackingSuggestions> = object<PackingSuggestions>({
  algorithm_version: str,
  inputs: record,
  add: arrayOf(object({
    key: str,
    name: str,
    category: oneOf(...PACKING_CATEGORIES),
    scope: oneOf('shared', 'personal'),
    is_required: bool,
    quantity: int,
    reason: str,
  })),
  remove: arrayOf(object({ item_id: str, suggestion_key: str, name: nullable(str), reason: str })),
  change: arrayOf(object({
    item_id: str, suggestion_key: str, name: nullable(str), current_quantity: int, suggested_quantity: int, reason: str,
  })),
  unverified: arrayOf(object({ code: str, message: str })),
});

export const preparationTask: Decoder<PreparationTask> = object<PreparationTask>({
  id: str,
  plan_id: str,
  title: str,
  description: nullable(str),
  completion_criteria: nullable(str),
  due_at: nullable(str),
  is_overdue: bool,
  status: oneOf('open', 'done'),
  completed_at: nullable(str),
  completed_by_name: nullable(str),
  assignee_user_id: nullable(str),
  assignee_name: nullable(str),
  assignee_missing: bool,
  related_type: nullable(oneOf('event', 'reservation', 'segment', 'document', 'packing_item')),
  related_id: nullable(str),
  related_label: nullable(str),
  related_missing: bool,
  readiness_key: nullable(str),
  created_by_name: nullable(str),
  can_edit: bool,
  can_complete: bool,
  revision: int,
  created_at: nullable(str),
  updated_at: nullable(str),
});

const readinessItem: Decoder<ReadinessItem> = object<ReadinessItem>({
  key: str,
  code: oneOf(
    'unreserved', 'reservation_unconfirmed', 'reservation_unpaid', 'payment_unknown', 'cancellation_deadline_soon',
    'task_overdue', 'task_unassigned', 'packing_unassigned', 'packing_shortage',
  ),
  category: oneOf('unreserved', 'unconfirmed', 'unpaid', 'deadline', 'unassigned', 'packing'),
  severity: oneOf('high', 'medium', 'low'),
  title: str,
  detail: str,
  entity_type: str,
  entity_id: str,
  link: nullable(str),
  due_at: nullable(str),
  convertible: bool,
  task: nullable(object({
    id: str,
    status: oneOf('open', 'done'),
    assignee_user_id: nullable(str),
    assignee_name: nullable(str),
    due_at: nullable(str),
    revision: int,
  })),
});

export const readiness: Decoder<Readiness> = object<Readiness>({
  plan_id: str,
  algorithm_version: str,
  checked_at: str,
  is_ready: bool,
  counts: object({
    total: nonNegativeInt,
    by_severity: object({ high: nonNegativeInt, medium: nonNegativeInt, low: nonNegativeInt }),
    by_category: object({
      unreserved: nonNegativeInt, unconfirmed: nonNegativeInt, unpaid: nonNegativeInt, deadline: nonNegativeInt,
      unassigned: nonNegativeInt, packing: nonNegativeInt,
    }),
  }),
  resolved_by_tasks: nonNegativeInt,
  tasks: object({ open: nonNegativeInt, done: nonNegativeInt }),
  packing: object({
    total: nonNegativeInt, packed: nonNegativeInt, required_total: nonNegativeInt, required_ready: nonNegativeInt,
  }),
  items: arrayOf(readinessItem),
});

// ----- [Gate P2] 予算・費用(FR-027)・立替・精算(FR-028)。backend/app/api/v1/finance.py の応答。
// 金額は文字列(Decimal)。数値として誤って受け取ると桁落ち・合計不一致になるため、
// 金額は「数字と小数点の文字列」であることを検査する。
const moneyString: Decoder<string> = matching(/^-?\d+(\.\d+)?$/, '金額の文字列');
const EXPENSE_CATEGORIES = ['lodging', 'transport', 'food', 'activity', 'shopping', 'fee', 'cancellation', 'other'] as const;

export const financeSettings: Decoder<FinanceSettings> = object<FinanceSettings>({
  plan_id: str,
  base_currency: str,
  revision: nonNegativeInt,
  is_default: bool,
});

export const budget: Decoder<Budget> = object<Budget>({
  id: str,
  plan_id: str,
  kind: oneOf('total', 'category', 'day', 'member'),
  category: nullable(oneOf(...EXPENSE_CATEGORIES)),
  local_date: nullable(str),
  is_private: bool,
  amount: nullable(moneyString),
  currency: str,
  visibility: oneOf('full', 'unavailable'),
  note: nullable(str),
  revision: int,
  updated_at: nullable(str),
});

const expenseShare: Decoder<ExpenseShare> = object<ExpenseShare>({
  user_id: str,
  name: str,
  is_member: bool,
  weight: nullable(str),
  share_amount: moneyString,
  base_share_amount: nullable(moneyString),
  rounding_adjustment: moneyString,
});

export const expense: Decoder<Expense> = object<Expense>({
  id: str,
  plan_id: str,
  kind: oneOf('expense', 'refund'),
  refund_of_expense_id: nullable(str),
  title: str,
  category: oneOf(...EXPENSE_CATEGORIES),
  local_date: nullable(str),
  amount: moneyString,
  currency: str,
  tax_amount: nullable(moneyString),
  fee_amount: nullable(moneyString),
  fx_rate: nullable(str),
  fx_source: nullable(str),
  fx_date: nullable(str),
  base_amount: nullable(moneyString),
  base_currency: str,
  is_converted: bool,
  refunded_amount: nullable(moneyString),
  paid_by_user_id: str,
  paid_by_name: str,
  paid_by_is_member: bool,
  split_method: oneOf('equal', 'ratio', 'amount', 'none'),
  shares: arrayOf(expenseShare),
  related_type: nullable(oneOf('event', 'reservation', 'segment')),
  related_id: nullable(str),
  related_label: nullable(str),
  related_missing: bool,
  receipt_document_id: nullable(str),
  receipt_missing: bool,
  note: nullable(str),
  revision: int,
  created_at: nullable(str),
  updated_at: nullable(str),
});

export const settlement: Decoder<Settlement> = object<Settlement>({
  id: str,
  plan_id: str,
  from_user_id: str,
  from_name: str,
  to_user_id: str,
  to_name: str,
  amount: moneyString,
  currency: str,
  settled_on: nullable(str),
  note: nullable(str),
  revision: int,
  created_at: nullable(str),
});

const budgetDiffShape = {
  budget: nullable(moneyString),
  actual: moneyString,
  remaining: nullable(moneyString),
  over: bool,
};
const budgetDiff: Decoder<BudgetDiff> = object<BudgetDiff>(budgetDiffShape);

export const financeSummary: Decoder<FinanceSummary> = object<FinanceSummary>({
  plan_id: str,
  algorithm_version: str,
  base_currency: str,
  total: budgetDiff,
  tax_total: moneyString,
  fee_total: moneyString,
  refund_total: moneyString,
  reserved: object({ total: moneyString, unconverted: nonNegativeInt }),
  by_category: arrayOf(object({ ...budgetDiffShape, category: oneOf(...EXPENSE_CATEGORIES) })),
  by_day: arrayOf(object({ ...budgetDiffShape, local_date: str })),
  undated_actual: moneyString,
  my_budget: nullable(object({ ...budgetDiffShape, id: str, visibility: oneOf('full', 'unavailable') })),
  unconverted_expenses: nonNegativeInt,
  members: arrayOf(object({
    user_id: str, name: str, is_member: bool, is_me: bool, paid: moneyString, owed: moneyString,
    settled_out: moneyString, settled_in: moneyString, net: moneyString,
  })),
  transfers: arrayOf(object({ from_user_id: str, from_name: str, to_user_id: str, to_name: str, amount: moneyString })),
  is_settled: bool,
});

// ----- [Gate P3] 合意形成(FR-022)・コメント(FR-024)。backend/app/api/v1/discussion.py の応答。
// 状態・件数を誤ると「合意した」と誤表示するため、列挙値と件数を厳密に検査する。
const VOTE_VALUES = ['love', 'ok', 'concern', 'veto', 'abstain'] as const;

const pollVote: Decoder<PollVote> = object<PollVote>({
  id: str,
  is_mine: bool,
  user_id: nullable(str),
  name: nullable(str),
  value: oneOf(...VOTE_VALUES),
  reason: nullable(str),
  alternative: nullable(str),
  is_resolved: bool,
  resolution_note: nullable(str),
  resolved_by_name: nullable(str),
  can_resolve: bool,
});

const pollOption: Decoder<PollOption> = object<PollOption>({
  id: str,
  label: str,
  event_id: nullable(str),
  event_label: nullable(str),
  event_missing: bool,
  candidate_id: optional(nullable(str)),  // [Gate G11] 候補箱の投票
  state: oneOf('pending', 'blocked', 'has_concerns', 'agreed'),
  score: nullable(int),
  counts: nullable(object({
    love: nonNegativeInt, ok: nonNegativeInt, concern: nonNegativeInt, veto: nonNegativeInt, abstain: nonNegativeInt,
  })),
  responders: nonNegativeInt,
  unresolved_concerns: nonNegativeInt,
  unresolved_vetoes: nonNegativeInt,
  is_leading: bool,
  is_decided: bool,
  my_vote: nullable(oneOf(...VOTE_VALUES)),
  votes: arrayOf(pollVote),
});

export const poll: Decoder<Poll> = object<Poll>({
  id: str,
  plan_id: str,
  algorithm_version: str,
  title: str,
  description: nullable(str),
  deadline_at: nullable(str),
  status: oneOf('open', 'closed'),
  is_closed: bool,
  veto_policy: oneOf('block', 'block_with_alternative', 'advisory'),
  is_anonymous: bool,
  counts_hidden: bool,
  state: oneOf('voting', 'agreed', 'decided', 'blocked', 'needs_discussion'),
  decided_option_id: nullable(str),
  created_by_name: nullable(str),
  can_manage: bool,
  unanswered: arrayOf(object({ user_id: str, name: str })),
  options: arrayOf(pollOption),
  revision: int,
  created_at: nullable(str),
});

export const planComment: Decoder<PlanComment> = object<PlanComment>({
  id: str,
  plan_id: str,
  target_type: oneOf('plan', 'event', 'reservation', 'poll', 'expense'),
  target_id: nullable(str),
  parent_id: nullable(str),
  author_user_id: str,
  author_name: str,
  is_mine: bool,
  is_deleted: bool,
  body: nullable(str),
  mentions: arrayOf(object({ user_id: str, name: str })),
  status: oneOf('open', 'resolved'),
  sensitive_warning: bool,
  sensitive_reasons: arrayOf(str),
  can_edit: bool,
  can_moderate: bool,
  edited_at: nullable(str),
  revision: int,
  created_at: nullable(str),
});

// ----- [Gate P4] しおり・印刷・PDF出力(FR-034/035/046)。backend/app/api/v1/booklet.py の応答(booklet-v1)。
// 機密項目を含むかどうか(contains_sensitive・includes)と版の状態を誤ると、透かしや注意を出さずに
// 印刷させてしまうため、列挙値と真偽値を厳密に検査する。
const BOOKLET_THEMES = ['cute', 'simple', 'family', 'school', 'business', 'accessible', 'mono'] as const;
const BOOKLET_SECTIONS = ['cover', 'toc', 'schedule', 'map', 'reservations', 'packing', 'contacts', 'costs', 'notes'] as const;
const bookletIncludes: Decoder<BookletIncludes> = object<BookletIncludes>({
  confirmation_numbers: bool, addresses: bool, phones: bool, participants: bool,
});

export const booklet: Decoder<Booklet> = object<Booklet>({
  policy_version: str,
  plan_id: str,
  theme: oneOf(...BOOKLET_THEMES),
  density: oneOf('normal', 'compact'),
  format: oneOf('web', 'print'),
  sections: arrayOf(oneOf(...BOOKLET_SECTIONS)),
  includes: bookletIncludes,
  contains_sensitive: bool,
  generated_at: str,
  input_revision: int,
  current_revision: int,
  is_stale: bool,
  data_as_of: str,
  warnings: arrayOf(oneOf('stale_revision', 'contains_sensitive', 'qr_not_included', 'unconverted_expenses')),
  cover: nullable(object({
    title: str, destination: nullable(str), start_date: nullable(str), end_date: nullable(str),
    day_count: nonNegativeInt, member_count: nonNegativeInt,
  })),
  schedule: nullable(object({
    days: arrayOf(object({
      date: str, title: nullable(str), timezone_id: str,
      events: arrayOf(object({
        title: str, event_type: str, local_start_time: nullable(str), is_all_day: bool, end: nullable(str),
        place_name: nullable(str), address: nullable(str), locked: bool,
        reservations: arrayOf(object({ type: str, provider_name: nullable(str), status: str })),
      })),
    })),
    transport: arrayOf(object({
      mode: str, from_label: nullable(str), to_label: nullable(str), departure: nullable(str), arrival: nullable(str),
      duration_minutes: nullable(nonNegativeInt), transport_number: nullable(str), platform: nullable(str),
      status: str, is_estimate: bool,
    })),
  })),
  map: nullable(object({
    places: arrayOf(object({
      label: str, date: nullable(str), address: nullable(str), latitude: nullable(num), longitude: nullable(num),
    })),
  })),
  reservations: nullable(arrayOf(object({
    type: str, provider_name: nullable(str), status: str, start: nullable(str), end: nullable(str),
    timezone_id: nullable(str), guest_count: nullable(nonNegativeInt), confirmation: nullable(str),
    confirmation_is_full: bool, contact_phone: nullable(str), cancellation_deadline: nullable(str),
    payment_status: nullable(str),
  }))),
  packing: nullable(arrayOf(object({
    name: str, category: str, quantity: nonNegativeInt, is_required: bool, status: str,
  }))),
  contacts: nullable(object({
    member_count: nonNegativeInt,
    members: nullable(arrayOf(str)),
    reservation_contacts: nullable(arrayOf(object({
      provider_name: nullable(str), type: str, phone: nullable(str), url: nullable(str),
    }))),
    hidden: arrayOf(oneOf('participants', 'phones')),
  })),
  costs: nullable(object({
    base_currency: str, budget_total: nullable(moneyString), actual_total: moneyString, over: bool,
    by_category: arrayOf(object({ category: str, budget: nullable(moneyString), actual: moneyString, over: bool })),
    unconverted_expenses: nonNegativeInt,
  })),
  notes: nullable(arrayOf(str)),
});

export const bookletExport: Decoder<BookletExport> = object<BookletExport>({
  id: str,
  plan_id: str,
  version_no: int,
  format: oneOf('web', 'print'),
  theme: oneOf(...BOOKLET_THEMES),
  density: oneOf('normal', 'compact'),
  sections: arrayOf(oneOf(...BOOKLET_SECTIONS)),
  includes: bookletIncludes,
  contains_sensitive: bool,
  watermark_text: nullable(str),
  valid_until: nullable(str),
  input_revision: int,
  is_stale: bool,
  policy_version: str,
  state: oneOf('active', 'revoked', 'expired'),
  created_at: nullable(str),
  created_by_name: str,
  is_mine: bool,
  can_view: bool,
  can_revoke: bool,
});

// ----- [Gate P6] データポータビリティ(FR-039)。backend/app/api/v1/data_export.py の保持期間の説明。
export const retentionInfo: Decoder<RetentionInfo> = object<RetentionInfo>({
  plan_delete_grace_days: nonNegativeInt,
  quick_draft_expired_retention_days: nonNegativeInt,
  quick_draft_promoted_retention_days: nonNegativeInt,
  items: arrayOf(object({
    key: oneOf('deleted_plan', 'quick_draft', 'documents', 'audit', 'backup', 'exported'),
    label: str,
    period: str,
    note: str,
  })),
});

// ----- [Gate P7] What-if・旅程ブランチ(FR-019)。backend/app/api/v1/branches.py の応答(branch-v1)。
// 採用できない理由(conflicts)と状態を誤ると、本案を壊す採用ボタンを出してしまうため、列挙値を厳密に検査する。
const BRANCH_SCENARIOS = ['rain', 'delay', 'absence', 'budget', 'fatigue', 'custom'] as const;
const branchShape = {
  id: str,
  plan_id: str,
  algorithm_version: str,
  title: str,
  scenario_type: oneOf(...BRANCH_SCENARIOS),
  // 想定の値は作成時にbackendが検証済み。画面は既知の項目だけを読む
  assumptions: record as Decoder<BranchAssumptions>,
  base_revision: int,
  plan_revision: int,
  plan_changed_since_base: bool,
  status: oneOf('draft', 'adopted', 'discarded'),
  state: oneOf('draft', 'adopted', 'discarded', 'adopted_undone'),
  created_by_name: str,
  adopted_at: nullable(str),
  adopted_by_name: nullable(str),
  summary: object({ added: nonNegativeInt, removed: nonNegativeInt, updated: nonNegativeInt, time_changed: nonNegativeInt }),
  can_edit: bool,
  revision: int,
  created_at: nullable(str),
  updated_at: nullable(str),
};
export const branch: Decoder<Branch> = object<Branch>(branchShape);

export const branchDetail: Decoder<BranchDetail> = object<BranchDetail>({
  ...branchShape,
  days: arrayOf(object({ id: str, local_date: str, timezone_id: str, title: nullable(str) })),
  content: arrayOf(object({
    key: str, source_event_id: nullable(str), day_id: str, title: str, event_type: str,
    local_start_time: nullable(str), is_all_day: bool, sort_order: int, locked: bool, removed: bool, note: nullable(str),
  })),
  ops: arrayOf(object({
    op: oneOf('add', 'remove', 'update'), event_id: optional(str), key: optional(str), title: optional(str),
    fields: optional(record), before: optional(record),
  })),
  // [Gate G8] FR-019 区間・予約の変更の競合(kind: segment / reservation、op: relink / cancel、理由を足した)
  conflicts: arrayOf(object({
    op: oneOf('add', 'remove', 'update', 'relink', 'cancel'), event_id: optional(str), key: optional(str),
    title: optional(str),
    reason: oneOf('changed_in_plan', 'deleted_in_plan', 'locked', 'has_relations', 'day_missing', 'event_missing',
      'already_cancelled', 'hidden'),
    fields: optional(arrayOf(str)), kind: optional(oneOf('event', 'segment', 'reservation')), op_id: optional(str),
    label: optional(str),
  })),
  day_counts: arrayOf(object({ day_id: str, local_date: str, plan: nonNegativeInt, branch: nonNegativeInt })),
});

// ----- [Gate P8] カレンダー(ICS)の取込(FR-036)。backend/app/api/v1/calendar_import.py の応答。
// 取り込む・取り込まないの区別や理由を誤ると、確認していない変更を本案へ入れてしまうため、列挙値を厳密に検査する。
const IMPORT_REASONS = ['recurring', 'cancelled', 'unchanged', 'locked', 'duplicate', 'no_day'] as const;
export const calendarImportPreview: Decoder<CalendarImportPreview> = object<CalendarImportPreview>({
  plan_id: str,
  plan_revision: int,
  timezone_id: str,
  create_missing_days: bool,
  summary: object({
    total: nonNegativeInt, create: nonNegativeInt, update: nonNegativeInt, skip: nonNegativeInt,
    skipped_by_reason: record as Decoder<CalendarImportPreview['summary']['skipped_by_reason']>,
  }),
  candidates: arrayOf(object({
    index: nonNegativeInt,
    uid: nullable(str),
    title: str,
    local_date: str,
    local_start_time: nullable(str),
    is_all_day: bool,
    address: nullable(str),
    action: oneOf('create', 'update', 'skip'),
    reason: nullable(oneOf(...IMPORT_REASONS)),
    event_id: nullable(str),
    changes: nullable(record as Decoder<Record<string, { before: unknown; after: unknown }>>),
    day_exists: bool,
  })),
});

export const calendarImportResult: Decoder<CalendarImportResult> = object<CalendarImportResult>({
  plan_revision: int, created: nonNegativeInt, updated: nonNegativeInt, created_days: nonNegativeInt,
});

// ----- [Gate P9] アカウントの削除・同意の撤回(FR-039)。backend/app/api/v1/privacy.py の応答。
// 同意の有無を取り違えると撤回したつもりの目的を同意済みと表示してしまうため、目的と真偽値を厳密に検査する。
export const consentState: Decoder<ConsentState> = object<ConsentState>({
  purposes: arrayOf(object({
    purpose: oneOf('ai_processing', 'location', 'analytics', 'marketing_email'),
    label: str,
    description: str,
    in_use: bool,
    granted: bool,
    updated_at: nullable(str),
  })),
});

export const accountDeletionPreview: Decoder<AccountDeletionPreview> = object<AccountDeletionPreview>({
  account_type: oneOf('registered', 'guest'),
  requires_password: bool,
  confirmation_text: str,
  owned_plans: arrayOf(object({ id: str, title: str, member_count: nonNegativeInt })),
  member_plan_count: nonNegativeInt,
  deleted_in_member_plans: object({
    personal_packing_items: nonNegativeInt, private_constraints: nonNegativeInt, member_budgets: nonNegativeInt,
    documents: nonNegativeInt, memories: optional(nonNegativeInt), location_tracks: optional(nonNegativeInt),
  }),
  kept_in_member_plans: object({ comments: nonNegativeInt, expenses: nonNegativeInt, votes: nonNegativeInt }),
  plan_delete_grace_days: nonNegativeInt,
  retention: retentionInfo,
});

export const accountDeletionResult: Decoder<AccountDeletionResult> = object<AccountDeletionResult>({
  deleted: bool,
  summary: record as Decoder<Record<string, number>>,
  plan_delete_grace_days: nonNegativeInt,
});

// ----- [Gate P10] 外部状況(アラート、FR-030)・安全な再計画(FR-031)。backend/app/api/v1/replans.py の応答(replan-v1)。
// 情報の古さ(is_stale)・案の使用可否・適用できるか(is_stale/can_apply)を誤ると、古い情報で旅程を変える操作を出してしまうため、
// 列挙値と真偽値を厳密に検査する。
const ALERT_KINDS = ['delay', 'cancellation', 'closure', 'weather'] as const;
const REPLAN_STATUSES = ['proposed', 'applied', 'rejected'] as const;
export const planAlert: Decoder<PlanAlert> = object<PlanAlert>({
  id: str,
  plan_id: str,
  kind: oneOf(...ALERT_KINDS),
  kind_label: str,
  source: oneOf('user_report', 'route_status'),
  source_label: nullable(str),
  confidence: oneOf('confirmed', 'reported'),
  observed_at: nullable(str),
  is_stale: bool,
  event_id: nullable(str),
  event_title: nullable(str),
  event_local_start_time: nullable(str),
  event_missing: bool,
  day_id: nullable(str),
  local_date: nullable(str),
  delay_minutes: nullable(nonNegativeInt),
  note: nullable(str),
  status: oneOf('active', 'resolved', 'dismissed'),
  resolved_at: nullable(str),
  created_by_name: str,
  latest_replan_id: nullable(str),
  latest_replan_status: nullable(oneOf(...REPLAN_STATUSES)),
  revision: int,
  created_at: nullable(str),
  updated_at: nullable(str),
});

export const alertList: Decoder<AlertList> = object<AlertList>({
  plan_id: str,
  server_time: str,
  can_edit: bool,
  alerts: arrayOf(planAlert),
  detected: arrayOf(object({
    event_id: str, event_title: str, event_local_start_time: nullable(str), day_id: str, local_date: nullable(str),
    transport_status: oneOf('delayed', 'cancelled'), suggested_kind: oneOf('delay', 'cancellation'),
    observed_at: nullable(str), is_stale: bool,
  })),
});

export const replan: Decoder<Replan> = object<Replan>({
  id: str,
  plan_id: str,
  alert_id: str,
  algorithm_version: str,
  base_revision: int,
  plan_revision: int,
  is_stale: bool,
  status: oneOf(...REPLAN_STATUSES),
  state: oneOf(...REPLAN_STATUSES, 'applied_undone'),
  applied_candidate: nullable(oneOf('A', 'B')),
  applied_at: nullable(str),
  applied_by_name: nullable(str),
  created_by_name: str,
  can_apply: bool,
  candidates: arrayOf(object({
    id: oneOf('A', 'B'),
    strategy: oneOf('shift_later', 'keep_times', 'remove', 'move_next_day'),
    label: str,
    description: str,
    available: bool,
    unavailable_reason: nullable(str),
    warnings: arrayOf(str),
    changes: arrayOf(object({
      event_id: str, title: str, before_time: nullable(str), after_time: nullable(str), before_date: str, after_date: str,
    })),
    lost: arrayOf(object({ event_id: str, title: str })),
    protected: arrayOf(object({ event_id: str, title: str, local_start_time: nullable(str), has_reservation: bool })),
    metrics: object({
      changed_count: nonNegativeInt, lost_count: nonNegativeInt, protected_count: nonNegativeInt,
      max_delay_minutes: int, day_end_shift_minutes: nullable(int),
    }),
    cost_impact: nullable(object({
      currency: matching(/^[A-Z]{3}$/, 'ISO 4217の通貨コード'),
      lost_paid_amount: matching(/^-?\d+\.\d{2}$/, '小数2桁の金額文字列'),
      lost_paid_count: nonNegativeInt,
      unconverted_count: nonNegativeInt,
    })),
    notify_member_names: arrayOf(str),
  })),
  revision: int,
  created_at: nullable(str),
});

export const replanApplyResult: Decoder<ReplanApplyResult> = object<ReplanApplyResult>({
  replan, plan_revision: int,
});

/** 再計画の409の応答本体 `{detail}`(画面は code で案内を変える) */
export const replanError: Decoder<{ detail: ReplanErrorDetail }> = object<{ detail: ReplanErrorDetail }>({
  detail: object<ReplanErrorDetail>({
    code: oneOf('replan_stale', 'replan_conflict', 'replan_closed', 'candidate_unavailable', 'no_changes', 'alert_target_changed'),
    message: str,
    current_revision: optional(int),
    conflicts: optional(arrayOf(object({ op: str, event_id: optional(str), title: optional(str), reason: str }))),
  }),
});

// ----- [Gate L4] 説明可能な最適化(FR-018)。backend/app/api/v1/optimization.py の応答(explainable-opt-v1)。
// 検証の件数・候補の種類・適用できるかを誤ると、制約を悪化させる並べ替えを「良い案」に見せてしまうため厳密に検査する。
const optimizationMetricsShape = {
  distance_km: num, duration_minutes: num, unknown_legs: nonNegativeInt,
  error: nonNegativeInt, warning: nonNegativeInt, info: nonNegativeInt, unverified: nonNegativeInt,
  constraints_satisfied: nonNegativeInt, constraints_violated: nonNegativeInt,
};
const optimizationIssue: Decoder<OptimizationIssue> = object<OptimizationIssue>({
  code: str, severity: oneOf('ERROR', 'WARNING', 'INFO'), message: str, entity_label: nullable(str),
  is_private_constraint: bool,
});
export const optimizationCandidates: Decoder<OptimizationCandidates> = object<OptimizationCandidates>({
  plan_id: str,
  day_id: str,
  local_date: str,
  algorithm_version: str,
  validation_algorithm_version: str,
  travel_mode: oneOf('walking', 'driving', 'train', 'bus', 'bicycle', 'taxi'),
  base_revision: int,
  input_fingerprint: str,
  current: object({ order: arrayOf(str), metrics: object<OptimizationMetrics>(optimizationMetricsShape) }),
  fixed: arrayOf(object({ event_id: str, title: str, reason: str })),
  movable_count: nonNegativeInt,
  candidates: arrayOf(object({
    id: str,
    kinds: arrayOf(oneOf('shortest', 'constraints')),
    label: str,
    order: arrayOf(str),
    changes: arrayOf(object({
      event_id: str, title: str, before_index: int, after_index: int, before_time: nullable(str), after_time: nullable(str),
    })),
    metrics: object({ ...optimizationMetricsShape, saved_distance_km: num, saved_duration_minutes: num }),
    new_issues: arrayOf(optimizationIssue),
    resolved_issues: arrayOf(optimizationIssue),
    explanations: arrayOf(str),
  })),
  warnings: arrayOf(str),
  can_apply: bool,
});

export const optimizationApplyResult: Decoder<OptimizationApplyResult> = object<OptimizationApplyResult>({
  plan_revision: int, changed: nonNegativeInt, change_set_id: nullable(str), algorithm_version: str,
});

// ----- [Gate P11] オフライン編集・同期(FR-033)。backend/app/api/v1/sync.py の応答。
// 操作ごとの結果を取り違えると、競合した変更を「送信済み」として端末から消してしまうため、列挙値を厳密に検査する。
const syncConflictDetail: Decoder<SyncConflictDetail> = object<SyncConflictDetail>({
  fields: arrayOf(str),
  mine: nullable(record),
  server: nullable(record),
  server_deleted: bool,
  deleted_by_me: optional(bool),
  title: optional(nullable(str)),
});
export const syncResponse: Decoder<SyncResponse> = object<SyncResponse>({
  plan_id: str,
  plan_revision: int,
  results: arrayOf(object({
    operation_id: str,
    status: oneOf('applied', 'already_applied', 'conflicted', 'rejected'),
    code: nullable(str),
    message: nullable(str),
    entity_id: nullable(str),
    temp_id: nullable(str),
    resulting_revision: nullable(int),
    conflict: nullable(syncConflictDetail),
  })),
  summary: object({
    applied: nonNegativeInt, already_applied: nonNegativeInt, conflicted: nonNegativeInt, rejected: nonNegativeInt,
  }),
  pack_refresh_required: bool,
});
export const syncConflictList: Decoder<SyncConflictList> = object<SyncConflictList>({
  plan_id: str,
  plan_revision: int,
  conflicts: arrayOf(object({
    operation_id: str,
    action: oneOf('create', 'update', 'delete', 'reorder'),
    entity_type: optional(oneOf('event', 'day', 'order', 'reservation')),
    code: nullable(str),
    message: nullable(str),
    entity_id: nullable(str),
    title: nullable(str),
    conflict: nullable(syncConflictDetail),
    current: nullable(record),
    server_deleted: bool,
    created_at: nullable(str),
  })),
});
export const syncResolveResult: Decoder<SyncResolveResult> = object<SyncResolveResult>({
  operation_id: str, status: oneOf('resolved_mine', 'resolved_server'), plan_revision: int,
});

// ===== [Gate P12] 写真・メモ・旅行記(FR-037) =====
const memoryKind = oneOf('note', 'photo', 'audio', 'video');
export const travelMemory: Decoder<TravelMemory> = object<TravelMemory>({
  id: str,
  plan_id: str,
  kind: memoryKind,
  body: nullable(str),
  event_id: nullable(str),
  day_id: nullable(str),
  occurred_at: nullable(str),
  place_name: nullable(str),
  latitude: nullable(num),
  longitude: nullable(num),
  video_url: nullable(str),
  has_media: bool,
  mime_type: nullable(str),
  size: nullable(nonNegativeInt),
  visibility: oneOf('private', 'members'),
  include_in_journal: bool,
  author_name: str,
  by_me: bool,
  can_edit: bool,
  can_delete: bool,
  revision: int,
  created_at: nullable(str),
  updated_at: nullable(str),
  source: optional(nullable(record)),
});
export const memoryList: Decoder<MemoryList> = object<MemoryList>({
  memories: arrayOf(travelMemory),
  can_create: bool,
  max_upload_bytes: nonNegativeInt,
});
export const journalMemory: Decoder<JournalMemory> = object<JournalMemory>({
  id: str,
  kind: memoryKind,
  body: nullable(str),
  occurred_at: nullable(str),
  place_name: nullable(str),
  has_media: bool,
  video_url: nullable(str),
  latitude: nullable(num),
  longitude: nullable(num),
  by_me: bool,
});
export const journalDraft: Decoder<JournalDraft> = object<JournalDraft>({
  title: str,
  algorithm_version: str,
  generated_at: nullable(str),
  options: object({ include_locations: bool, include_media: bool, include_others: bool }),
  days: arrayOf(object({
    day_id: str,
    date: str,
    title: nullable(str),
    entries: arrayOf(object({
      event_id: str,
      title: nullable(str),
      planned_time: nullable(str),
      status: oneOf('recorded', 'no_record'),
      memories: arrayOf(journalMemory),
    })),
    day_memories: arrayOf(journalMemory),
  })),
  other_memories: arrayOf(journalMemory),
  summary: object({
    planned_events: nonNegativeInt, recorded_events: nonNegativeInt, memories: nonNegativeInt, photos: nonNegativeInt,
  }),
  checks: arrayOf(object({
    code: oneOf('member_name', 'reservation_like', 'phone_like', 'photo_people', 'location_included',
      'location_excluded', 'others_included'),
    severity: oneOf('warning', 'info'),
    memory_id: nullable(str),
    message: str,
  })),
  markdown: str,
});

// ===== [Gate P13] 任意の位置軌跡(FR-038) =====
// [Gate L5] FR-056 端末の記録の観測値(座標を含まない)
const ratio = unitInterval;
const tierSeconds = object({
  moving_fast: optional(nonNegativeInt), moving: optional(nonNegativeInt), stationary: optional(nonNegativeInt),
  low_power: optional(nonNegativeInt),
});
const trackSampling: Decoder<TrackSampling> = object<TrackSampling>({
  battery_start: optional(ratio),
  battery_end: optional(ratio),
  charging_seen: optional(bool),
  expected_samples: nonNegativeInt,
  kept_samples: nonNegativeInt,
  missed_samples: nonNegativeInt,
  manual_points: nonNegativeInt,
  max_gap_seconds: nonNegativeInt,
  tier_seconds: tierSeconds,
  missed_ratio: nullable(ratio),
  battery_used: nullable(ratio),
  reported_at: str,
});
const tripLocationMode = oneOf('off', 'device_only', 'areas_only', 'synced');
const areaCellKey = matching(/^0\.1:-?\d{1,2}\.\d:-?\d{1,3}\.\d$/, '0.1度の区画の印');
const areaCell: Decoder<AreaCell> = object<AreaCell>({
  key: areaCellKey,
  first_at: str,
  last_at: str,
  dwell_seconds: nonNegativeInt,
  samples: nonNegativeInt,
  state: oneOf('STAYED', 'VISITED', 'PASS_THROUGH'),
});
export const locationSettings: Decoder<LocationSettings> = object<LocationSettings>({
  mode: nullable(tripLocationMode),
  revision: nonNegativeInt,
  updated_at: nullable(str),
  stopped_tracks: optional(nonNegativeInt),
});
export const areaCellsUploadResult: Decoder<AreaCellsUploadResult> = object<AreaCellsUploadResult>({
  added: nonNegativeInt,
  updated: nonNegativeInt,
  rejected: object({ invalid: optional(nonNegativeInt), outside_period: optional(nonNegativeInt) }),
  cell_count: nonNegativeInt,
  status: oneOf('recording', 'paused', 'stopped'),
});
const trackFields = {
  id: str,
  plan_id: str,
  mode: oneOf('device_only', 'areas_only', 'synced'),
  precision: oneOf('high', 'standard', 'low'),
  status: oneOf('recording', 'paused', 'stopped'),
  stopped_reason: nullable(oneOf('user', 'trip_ended', 'consent_withdrawn', 'mode_off')),
  started_at: str,
  auto_stop_at: str,
  stopped_at: nullable(str),
  point_count: nonNegativeInt,
  revision: int,
  sampling: nullable(trackSampling),
  created_at: nullable(str),
  updated_at: nullable(str),
};
export const locationTrack: Decoder<LocationTrack> = object<LocationTrack>(trackFields);
export const locationTrackList: Decoder<LocationTrackList> = object<LocationTrackList>({
  tracks: arrayOf(locationTrack),
  location_consent: bool,
  trip_period: nullable(object({ start: str, end: str })),
  in_trip_period: bool,
  active_track_id: nullable(str),
  can_start: bool,
  max_points_per_request: nonNegativeInt,
  trip_mode: nullable(tripLocationMode),
});
export const locationTrackDetail: Decoder<LocationTrackDetail> = object<LocationTrackDetail>({
  ...trackFields,
  distance_m: num,
  points: arrayOf(object({ recorded_at: str, latitude: num, longitude: num, accuracy_m: nullable(num) })),
  cells: arrayOf(areaCell),
});
export const trackPointsUploadResult: Decoder<TrackPointsUploadResult> = object<TrackPointsUploadResult>({
  accepted: nonNegativeInt,
  rejected: object({
    invalid: optional(nonNegativeInt), low_accuracy: optional(nonNegativeInt), outside_period: optional(nonNegativeInt),
  }),
  point_count: nonNegativeInt,
  replayed: bool,
  status: oneOf('recording', 'paused', 'stopped'),
});
export const trackPointsDeleteResult: Decoder<TrackPointsDeleteResult> = object<TrackPointsDeleteResult>({
  removed: nonNegativeInt, point_count: nonNegativeInt, revision: int,
});

// ===== [Gate P14] 旅の振り返り(FR-054・FR-053) =====
const rate = nullable(num);
const eventActualRecord: Decoder<EventActualRecord> = object<EventActualRecord>({
  status: oneOf('visited', 'skipped'),
  actual_start_at: nullable(str),
  actual_end_at: nullable(str),
  source: oneOf('manual', 'suggested'),
  note: nullable(str),
  revision: int,
  updated_at: nullable(str),
});
export const journeyReview: Decoder<JourneyReview> = object<JourneyReview>({
  plan_id: str,
  title: str,
  days: arrayOf(object({
    day_id: str,
    date: str,
    title: nullable(str),
    timezone_id: str,
    events: arrayOf(object({
      event_id: str,
      title: str,
      planned_time: nullable(str),
      planned_start_at: nullable(str),
      has_location: bool,
      actual: nullable(eventActualRecord),
      memory_count: nonNegativeInt,
      photo_count: nonNegativeInt,
      suggestion: nullable(object({
        actual_start_at: str, actual_end_at: str, basis: oneOf('track', 'memory'), points: nonNegativeInt,
      })),
      start_diff_minutes: nullable(int),
    })),
  })),
  metrics: object({
    planned_events: nonNegativeInt,
    visited: nonNegativeInt,
    skipped: nonNegativeInt,
    unrecorded: nonNegativeInt,
    plan_achievement_rate: rate,
    visit_rate: rate,
    photo_visit_rate: rate,
    record_completion_rate: rate,
    memory_events: nonNegativeInt,
    stay_minutes: nullable(nonNegativeInt),
    timed_visits: nonNegativeInt,
    track_distance_m: nullable(num),
    algorithm_version: str,
  }),
  can_edit: bool,
});
export const actualPutResult: Decoder<ActualPutResult> = object<ActualPutResult>({
  event_id: str, actual: eventActualRecord,
});
export const carryOverResult: Decoder<CarryOverResult> = object<CarryOverResult>({
  event_id: str, target_plan_id: str, target_day_id: str, target_revision: int,
});

// ===== [Gate P15] Personal Travel Atlas(FR-052) =====
const atlasState = oneOf('STAYED', 'VISITED', 'PASS_THROUGH', 'PLANNED');
const atlasCell: Decoder<AtlasCell> = object<AtlasCell>({
  key: str,
  lat_min: num,
  lat_max: num,
  lng_min: num,
  lng_max: num,
  state: atlasState,
  first_at: nullable(str),
  last_at: nullable(str),
  trips: arrayOf(object({ plan_id: str, title: str })),
  evidence: object({
    actual: optional(nonNegativeInt), memory: optional(nonNegativeInt), track: optional(nonNegativeInt),
    planned: optional(nonNegativeInt), area: optional(nonNegativeInt),
  }),
});
export const atlasResponse: Decoder<AtlasResponse> = object<AtlasResponse>({
  precision: oneOf('region', 'area'),
  year: nullable(int),
  years: arrayOf(int),
  plans: arrayOf(object({ plan_id: str, title: str, excluded: bool, observations: nonNegativeInt, is_owner: bool })),
  cells: arrayOf(atlasCell),
  summary: object({
    cells: nonNegativeInt,
    by_state: object({ STAYED: nonNegativeInt, VISITED: nonNegativeInt, PASS_THROUGH: nonNegativeInt, PLANNED: nonNegativeInt }),
    visited_cells: nonNegativeInt,
    revisit_rate: nullable(num),
    algorithm_version: str,
  }),
});
export const atlasSettingsResult: Decoder<{ excluded_plan_ids: string[] }> = object<{ excluded_plan_ids: string[] }>({
  excluded_plan_ids: arrayOf(str),
});

// ===== [Gate P17] Memory Replan(FR-057) =====
const replanInsight: Decoder<ReplanInsight> = object<ReplanInsight>({
  kind: oneOf('stay_longer', 'stay_shorter', 'late_arrival', 'often_skipped', 'slow_transport'),
  event_type: nullable(str),
  minutes: nullable(nonNegativeInt),
  samples: nonNegativeInt,
  skipped: optional(nonNegativeInt),
  plans: arrayOf(str),
  examples: arrayOf(str),
  applicable: bool,
});
export const memoryReplanResult: Decoder<MemoryReplanResult> = object<MemoryReplanResult>({
  plan_id: str,
  plan_revision: int,
  insights: arrayOf(replanInsight),
  proposals: arrayOf(object({
    id: str,
    // [Gate G7] 区間の提案(slow_transport)も拒まない。中身の検査は画面が使う decodersG7 が行う
    kind: oneOf('stay_longer', 'slow_transport'),
    event_type: nullable(str),
    minutes: nonNegativeInt,
    changes: arrayOf(record),
    kept: arrayOf(record),
  })),
  input_fingerprint: str,
  sample_count: nonNegativeInt,
  algorithm_version: str,
  can_apply: bool,
});
export const memoryReplanApplyResult: Decoder<MemoryReplanApplyResult> = object<MemoryReplanApplyResult>({
  plan_id: str, plan_revision: int, applied: nonNegativeInt, proposal_id: str,
});

// ===== [Gate K1] オフラインパックの鍵(B-008) =====
const offlineKeyFields = {
  user_id: str,
  key_version: int,
  // 32バイトの base64url(パディングなし)は必ず43文字
  key: matching(/^[A-Za-z0-9_-]{43}$/, '43文字の base64url'),
  algorithm: oneOf('AES-256-GCM'),
  key_bits: exactNumber(256),
  issued_at: str,
  // [Gate G6] OFF-01 端末ごとの鍵(device_id を付けて受け取った時だけ)
  device_id: optional(str),
  expires_at: optional(str),
};
export const offlinePackKey: Decoder<OfflinePackKey> = object<OfflinePackKey>(offlineKeyFields);
export const offlinePackKeyRotated: Decoder<OfflinePackKeyRotated> = object<OfflinePackKeyRotated>({
  ...offlineKeyFields,
  previous_version: int,
});

// ----- [Gate C1] FR-020 共同編集(backend/app/api/v1/presence.py)
// 版(revision)を誤ると「他の人が変更しました」の判定を誤るため、数値と役割を厳密に検査する。
const memberRole = oneOf('owner', 'editor', 'viewer');
const presenceViewer: Decoder<PresenceViewer> = object<PresenceViewer>({
  user_id: str,
  label: str,
  role: memberRole,
  is_self: bool,
  devices: nonNegativeInt,
  seen_at: str,
  editing: nullable(object({ kind: oneOf('event'), id: str, label: str })),
});
const presenceChange: Decoder<PresenceChange> = object<PresenceChange>({
  revision: nonNegativeInt,
  actor_label: str,
  is_self: bool,
  source: str,
  undone: bool,
  count: nonNegativeInt,
  items: arrayOf(object({ entity_type: str, action: str, label: nullable(str) })),
  at: nullable(str),
});
export const presenceState: Decoder<PresenceState> = object<PresenceState>({
  plan_id: str,
  revision: nonNegativeInt,
  viewers: arrayOf(presenceViewer),
  changes: arrayOf(presenceChange),
  poll_seconds: nonNegativeInt,
  ttl_seconds: nonNegativeInt,
});

// ----- [Gate C1] FR-023 秘匿プロフィール(backend/app/api/v1/private_profile.py)
const profileKind = oneOf(
  'earliest_start', 'latest_end', 'daily_travel_max', 'meal_interval_max', 'trip_budget_max', 'avoid_text',
  'avoid_transport',
);
const profileValue: Decoder<string | number> = (v, path) =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : str(v, path);
const privateProfileItem: Decoder<PrivateProfileItem> = object<PrivateProfileItem>({
  id: str,
  kind: profileKind,
  label: str,
  hardness: oneOf('hard', 'soft'),
  value: profileValue,
  unit: nullable(str),
});
export const privateProfile: Decoder<PrivateProfile> = object<PrivateProfile>({
  revision: nonNegativeInt,
  items: arrayOf(privateProfileItem),
  readable: bool,
  kinds: arrayOf(object({ kind: profileKind, label: str, value_type: oneOf('time', 'number', 'text'), units: arrayOf(str) })),
  max_items: nonNegativeInt,
  applied_plans: arrayOf(object({ plan_id: str, title: nullable(str) })),
});
export const planPrivateProfile: Decoder<PlanPrivateProfile> = object<PlanPrivateProfile>({
  plan_id: str,
  applied: bool,
  profile_items: nonNegativeInt,
  applied_constraints: nonNegativeInt,
  profile_revision: nonNegativeInt,
});

// ----- [Gate A2] 管理・監査(backend/app/api/v1/admin.py)
const adminPagination: Decoder<AdminPagination> = object<AdminPagination>({
  page: nonNegativeInt, page_size: nonNegativeInt, total_count: nonNegativeInt, total_pages: nonNegativeInt,
  has_next: bool, has_prev: bool,
});
export const adminSystemStats: Decoder<AdminSystemStats> = object<AdminSystemStats>({
  users: object({
    total_users: nonNegativeInt, active_users: nonNegativeInt, verified_users: nonNegativeInt, new_users_30d: nonNegativeInt,
    user_types: object({ guest: nonNegativeInt, registered: nonNegativeInt, premium: nonNegativeInt, admin: nonNegativeInt }),
  }),
  travel_plans: object({
    total_plans: nonNegativeInt, active_plans: nonNegativeInt, completed_plans: nonNegativeInt, draft_plans: nonNegativeInt,
    average_duration_days: num,
    popular_destinations: arrayOf(object({ destination: str, count: nonNegativeInt })),
  }),
  timestamp: str,
});
const adminUserFields = {
  id: str, username: nullable(str), email: nullable(str), user_type: str, is_active: bool, is_verified: bool,
  is_admin: bool, is_self: bool, created_at: nullable(str),
};
const adminUserRow: Decoder<AdminUserRow> = object<AdminUserRow>({ ...adminUserFields, travel_plans_count: nonNegativeInt });
export const adminUsersPage: Decoder<AdminUsersPage> = object<AdminUsersPage>({
  users: arrayOf(adminUserRow), pagination: adminPagination,
});
export const adminUserDetail: Decoder<AdminUserDetail> = object<AdminUserDetail>({
  ...adminUserFields,
  mfa_enabled: bool,
  statistics: object({
    account_age_days: nonNegativeInt, total_plans: nonNegativeInt, completed_plans: nonNegativeInt,
    optimization_usage: nonNegativeInt,
  }),
});
export const adminManageResult: Decoder<AdminManageResult> = object<AdminManageResult>({
  success: bool, updated_count: nonNegativeInt, sessions_revoked: nonNegativeInt,
});
const auditLogEntry: Decoder<AuditLogEntry> = object<AuditLogEntry>({
  id: str, user_id: nullable(str), action: str, resource_type: nullable(str), resource_id: nullable(str),
  ip_address: nullable(str), user_agent: nullable(str), details: nullable(record), created_at: nullable(str),
});
export const auditLogPage: Decoder<AuditLogPage> = object<AuditLogPage>({
  actions: arrayOf(str), audit_logs: arrayOf(auditLogEntry), pagination: adminPagination,
});

// ===== [Gate V2] 訪問の地図の層・訪問判定・訂正(FR-049〜051) =====
const visitState = oneOf('VERIFIED_VISIT', 'LIKELY_VISIT', 'PASS_THROUGH', 'PLANNED_ONLY', 'MANUAL', 'REJECTED');
const visitLayerState = oneOf('VERIFIED', 'STAYED', 'VISITED', 'PASS_THROUGH', 'PLANNED', 'HIDDEN');
// 根拠は表示用の自由な形(backend で座標を含めないことを保証する)。オブジェクトであることだけを確かめる
const visitReasons = (v: unknown, path: string) => record(v === null ? {} : v, path) as VisitAssessment['reasons'];
const visitAssessment: Decoder<VisitAssessment> = object<VisitAssessment>({
  state: visitState,
  auto_state: nullable(visitState),
  confidence: nullable(unitInterval),
  level: nullable(oneOf('high', 'review', 'candidate')),
  reasons: visitReasons,
  algorithm_version: str,
  source: oneOf('auto', 'device', 'user'),
  hidden: bool,
  assessed_at: nullable(str),
  corrected_at: nullable(str),
  revision: int,
  needs_confirmation: bool,
  differs_from_auto: bool,
});
const visitItem: Decoder<VisitItem> = object<VisitItem>({
  event_id: str,
  title: str,
  event_type: str,
  day_id: str,
  date: str,
  planned_time: nullable(str),
  latitude: num,
  longitude: num,
  radius_m: nonNegativeInt,
  layer_state: visitLayerState,
  assessment: nullable(visitAssessment),
});
export const visitsOverview: Decoder<VisitsOverview> = object<VisitsOverview>({
  plan_id: str,
  title: str,
  items: arrayOf(visitItem),
  counts: object({
    VERIFIED: nonNegativeInt, STAYED: nonNegativeInt, VISITED: nonNegativeInt, PASS_THROUGH: nonNegativeInt,
    PLANNED: nonNegativeInt, HIDDEN: nonNegativeInt,
  }),
  events_without_location: nonNegativeInt,
  needs_confirmation: nonNegativeInt,
  tracks: object({ synced: nonNegativeInt, device: nonNegativeInt }),
  rules: object<VisitsOverview['rules']>({
    algorithm_version: str, max_accuracy_m: num, visit_min_points: nonNegativeInt, visit_min_seconds: nonNegativeInt,
    stay_min_seconds: nonNegativeInt, pass_speed_kmh: num, high: unitInterval, review: unitInterval,
    default_radius_m: nonNegativeInt, radius_m: record as Decoder<Record<string, number>>,
  }),
  result: optional(object({
    created: nonNegativeInt, changed: nonNegativeInt, unchanged: nonNegativeInt, skipped: nonNegativeInt,
  })),
});
export const visitCorrectionResult: Decoder<VisitCorrectionResult> = object<VisitCorrectionResult>({
  event_id: str,
  assessment: nullable(visitAssessment),
  layer_state: visitLayerState,
});

// ===== [Gate C2] 候補箱(FR-007)・場所の一元管理(FR-008) =====
const candidateStatus = oneOf('open', 'scheduled', 'dismissed');
const planCandidateItem: Decoder<PlanCandidateItem> = object<PlanCandidateItem>({
  id: str, title: str, note: nullable(str), source_kind: oneOf('url', 'text', 'manual', 'search', 'social'),
  source_url: nullable(str), source_label: nullable(str), provider: nullable(str), retrieved_at: nullable(str),
  place_id: nullable(str), category: nullable(str), address: nullable(str), latitude: nullable(num),
  longitude: nullable(num), priority: int, status: candidateStatus, status_label: str,
  scheduled_event_id: nullable(str), merged_into_id: nullable(str), created_by: str, created_at: nullable(str),
  revision: int,
  duplicates: arrayOf(object({
    id: str, title: str,
    reasons: arrayOf(oneOf('same_provider_id', 'same_name', 'nearby', 'same_address', 'same_url')),
  })),
  merged_from: arrayOf(object({ id: str, title: str, source_url: nullable(str), provider: nullable(str) })),
});
export const candidateList: Decoder<CandidateList> = object<CandidateList>({
  plan_id: str,
  items: arrayOf(planCandidateItem),
  counts: object({ open: nonNegativeInt, scheduled: nonNegativeInt, dismissed: nonNegativeInt }),
  duplicate_pairs: nonNegativeInt,
  can_edit: optional(bool),
  id: optional(str),
  event_id: optional(str),
  place_id: optional(str),
  plan_revision: optional(int),
});
const sourceInfo = object({ provider: str, label: str, source_url: nullable(str), retrieved_at: nullable(str) });
export const placeInfo: Decoder<PlaceInfo> = object<PlaceInfo>({
  id: str, name: str, aliases: arrayOf(str), category: nullable(str), address: nullable(str),
  latitude: nullable(num), longitude: nullable(num), phone: nullable(str), website: nullable(str),
  entrance_note: nullable(str), floor: nullable(str), reservation_required: nullable(bool),
  price_range: nullable(str), accessibility_note: nullable(str), closed_days: nullable(str), note: nullable(str),
  opening_hours: arrayOf(object({ day_of_week: int, open_time: str, close_time: str, last_entry: optional(nullable(str)), last_order: optional(nullable(str)) })),
  // [Gate G4] MAP-02 例外の日・入口・出典の違い(以前の応答には無い)
  special_hours: optional(arrayOf(object({ local_date: str, kind: oneOf('closed', 'open'), open_time: nullable(str), close_time: nullable(str), last_entry: nullable(str), last_order: nullable(str), note: nullable(str) }))),
  entrances: optional(arrayOf(object({ id: optional(str), label: str, latitude: nullable(num), longitude: nullable(num), note: nullable(str), accessible: nullable(bool) }))),
  source_history: optional(((v: unknown, path: string) => {
    const r = record(v, path);
    for (const k of Object.keys(r)) arrayOf(object({ value: nullable(str), provider: str, label: str, source_url: nullable(str), retrieved_at: nullable(str) }))(r[k], `${path}.${k}`);
    return r;
  }) as Decoder<NonNullable<PlaceInfo['source_history']>>),
  sources: ((v: unknown, path: string) => {
    const r = record(v, path);
    for (const k of Object.keys(r)) sourceInfo(r[k], `${path}.${k}`);
    return r;
  }) as Decoder<PlaceInfo['sources']>,
  events: arrayOf(object({
    event_id: str, plan_id: str, plan_title: str, title: str, date: nullable(str), local_start_time: nullable(str),
  })),
  revision: int, can_edit: bool, updated_at: nullable(str),
});
export const planPlaces: Decoder<PlanPlaces> = object<PlanPlaces>({
  plan_id: str,
  places: arrayOf(object({
    id: str, name: str, category: nullable(str), address: nullable(str), phone: nullable(str),
    has_opening_hours: bool, event_count: nonNegativeInt,
  })),
});

// ===== [Gate C3] 情報内検索・コマンドパレット(FR-009) =====
const searchCategory = oneOf('day', 'event', 'place', 'candidate', 'reservation', 'ticket', 'document', 'expense',
  'member', 'memory');
const searchFilter = oneOf('today', 'reservation', 'ticket', 'hotel', 'emergency');
// 移動先は画面の中の経路だけを受け付ける(外部の URL・javascript: を流し込ませない)
const internalLink: Decoder<string> = matching(/^\/planner\/[0-9a-f-]{36}(\/[a-z-]+(\/[0-9a-f-]{36})?)?$/, '画面の中の経路');
const searchHit: Decoder<SearchHit> = object<SearchHit>({
  category: searchCategory, id: str, title: str, subtitle: nullable(str), when: nullable(str), badge: nullable(str),
  plan_id: str, plan_title: str, link: internalLink,
});
export const searchResults: Decoder<SearchResults> = object<SearchResults>({
  plan_id: optional(str),
  query: str,
  filter: nullable(searchFilter),
  filter_label: nullable(str),
  categories: arrayOf(object({ category: searchCategory, label: str, count: nonNegativeInt, results: arrayOf(searchHit) })),
  total: nonNegativeInt,
  plans: optional(arrayOf(object({ plan_id: str, title: str, link: internalLink }))),
  searched_plans: optional(nonNegativeInt),
});


// [Gate B1] 組織・外部連携の decoder は decodersOrg.ts(組織の画面で使う時に読み込む。Gate G2)
