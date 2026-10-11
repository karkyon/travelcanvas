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
import type { User } from '@/types';
import type {
  AdoptRouteOptionResponse, Collaborator, InsertionPreview, LegPreview, NormalizedDay, NormalizedEvent,
  NormalizedPlanDetail, Notification, OptimizationProposal, PlaceDetail, PromoteQuickDraftResult,
  PublicSharedDay, PublicSharedEvent, PublicSharedPlan, RoutePreview, ShareLink, DocumentLink, ExtractionCandidate, ImportJob, ImportJobDetail, Reservation,
  ReservationEventLink, ReservationParticipant, ReservationRevealResult, RouteLeg, RouteOption, Ticket,
  TicketRevealResult, TodayEvent, TodayResponse, TravelDocument, TravelSegment,
  AuthResponse, AuthUser, GuestSessionResponse,
  ConstraintValue, PlanConstraint,
  ConstraintCheckResult, ValidationCounts, ValidationIssue, ValidationRunDetail, ValidationRunSummary,
  DeletedPlanSummary, PlanDeleteResult, PlanPurgeResult,
  CollaboratorRemoveResult, DeletionImpact, ItemDeleteResult, LockedRelationDetail, RouteOptionDeleteResult,
  UndoConflictDetail,
  PackingItem, PackingSuggestions, PlanMember, PreparationTask, Readiness, ReadinessItem,
  Budget, BudgetDiff, Expense, ExpenseShare, FinanceSettings, FinanceSummary, Settlement,
  PlanComment, Poll, PollOption, PollVote,
  Booklet, BookletExport, BookletIncludes,
  RetentionInfo,
  Branch, BranchAssumptions, BranchDetail,
  CalendarImportPreview, CalendarImportResult,
} from './types';
import { arrayOf, bool, int, matching, nonNegativeInt, nullable, num, object, oneOf, optional, record, str, type Decoder } from './decode';

export interface RevisionResult {
  revision: number;
}

export const revisionResult: Decoder<RevisionResult> = object<RevisionResult>({ revision: int });

// [Gate B-013] 個別削除で外した紐付け・一緒に削除したデータの件数。件数は利用者への
// 案内(「予約1件との紐付けを外しました」)に使うため、非負の整数であることを検証する。
const count = nonNegativeInt;

export const deletionImpact: Decoder<DeletionImpact> = object<DeletionImpact>({
  reservations_unlinked: count,
  document_links_removed: count,
  segments_removed: count,
  route_options_removed: count,
  segments_unlinked: count,
});

export const itemDeleteResult: Decoder<ItemDeleteResult> = object<ItemDeleteResult>({
  revision: int,
  detached: optional(deletionImpact),
});

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

const segmentMode = oneOf('walking', 'driving', 'train', 'bus', 'ferry', 'flight', 'bicycle', 'taxi', 'mixed');

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

// ===== [Gate M9-FE-C2b-3] 正規化Plan/Day/Event(/plans) =====

export const normalizedEvent: Decoder<NormalizedEvent> = object<NormalizedEvent>({
  id: str,
  day_id: str,
  title: str,
  description: optional(nullable(str)),
  event_type: str,
  start_at: optional(nullable(str)),
  end_at: optional(nullable(str)),
  local_start_time: optional(nullable(str)),
  is_all_day: bool,
  address: optional(nullable(str)),
  latitude: optional(nullable(num)),
  longitude: optional(nullable(num)),
  locked: bool,
  sort_order: int,
  place_id: optional(nullable(str)),
});

/** 日の作成・更新応答にはeventsが含まれず、プラン詳細・最適化適用の応答には含まれる。 */
export const normalizedDay: Decoder<NormalizedDay> = object<NormalizedDay>({
  id: str,
  local_date: str,
  timezone_id: str,
  title: optional(nullable(str)),
  notes: optional(nullable(str)),
  sort_order: int,
  events: optional(arrayOf(normalizedEvent)),
});

export const normalizedPlanDetail: Decoder<NormalizedPlanDetail> = object<NormalizedPlanDetail>({
  id: str,
  title: str,
  revision: int,
  days: arrayOf(normalizedDay),
});

export const promoteQuickDraftResult: Decoder<PromoteQuickDraftResult> = object<PromoteQuickDraftResult>({
  id: str,
  revision: int,
  title: optional(nullable(str)),
  start_date: optional(nullable(str)),
  end_date: optional(nullable(str)),
  quick_draft_id: str,
  quick_draft_status: str,
});

/**
 * 旧metadata API(/travel-plans)の応答。本体の変換はplanFromApi()が担うため、
 * ここでは後段が必ず使う識別子(id/title)だけを検証する(宣言外の項目は保持される)。
 */
export interface LegacyTravelPlanCore {
  id: string;
  title: string;
}

export const legacyTravelPlan: Decoder<LegacyTravelPlanCore> = object<LegacyTravelPlanCore>({ id: str, title: str });

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
});

// ===== [Gate M9-FE-C2b-3] 通知・認証 =====

export const notification: Decoder<Notification> = object<Notification>({
  id: str,
  title: str,
  message: str,
  type: str,
  is_read: bool,
  related_plan_id: optional(nullable(str)),
  created_at: str,
});

export interface UnreadCount {
  unread_count: number;
}

export const unreadCount: Decoder<UnreadCount> = object<UnreadCount>({ unread_count: int });

export const user: Decoder<User> = object<User>({
  id: str,
  username: str,
  email: str,
  is_active: bool,
  is_verified: optional(bool),
  is_superuser: optional(bool),
  role: optional(str),
  user_type: optional(str),
  preferences: optional(nullable(record)),
  created_at: str,
  updated_at: optional(str),
});

// ----- [Gate A1] 認証(login/register/guest/guest-upgrade)
// backend/app/api/v1/auth.py UserResponse / TokenResponse / GuestSessionResponse。
// user_typeはmodels.py UserTypeの値集合に限定する(AdminRoute等の権限判定に使うため、
// 想定外の値を黙って受け入れない)。
const userTypeValue = oneOf('guest', 'registered', 'premium', 'admin', 'super_admin');

export const authUser: Decoder<AuthUser> = object<AuthUser>({
  id: str,
  username: str,
  email: str,
  user_type: userTypeValue,
  is_verified: bool,
});

export const authResponse: Decoder<AuthResponse> = object<AuthResponse>({
  access_token: str,
  token_type: str,
  user: authUser,
});

export const guestSessionResponse: Decoder<GuestSessionResponse> = object<GuestSessionResponse>({
  access_token: str,
  token_type: str,
  user_type: oneOf('guest'),
  guest_id: str,
  expires_in_hours: int,
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

export const planDeleteResult: Decoder<PlanDeleteResult> = object<PlanDeleteResult>({
  message: str,
  deleted_at: str,
  purge_after: str,
});

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
  conflicts: arrayOf(object({
    op: oneOf('add', 'remove', 'update'), event_id: optional(str), key: optional(str), title: optional(str),
    reason: oneOf('changed_in_plan', 'deleted_in_plan', 'locked', 'has_relations', 'day_missing'),
    fields: optional(arrayOf(str)),
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
