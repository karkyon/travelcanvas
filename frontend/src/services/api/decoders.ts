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
} from './types';
import { arrayOf, bool, int, nullable, num, object, oneOf, optional, record, str, type Decoder } from './decode';

export interface RevisionResult {
  revision: number;
}

export const revisionResult: Decoder<RevisionResult> = object<RevisionResult>({ revision: int });

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
