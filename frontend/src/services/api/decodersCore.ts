/**
 * [Gate G9] Q03 起動に要る応答の decoder(認証・旅行・通知)。最初に読む JS を小さく保つため、それ以外の decoder は
 * decoders.ts(使う時に読み込む塊)にある。decoders.ts はここの全てを再び公開するため、試験・後から読む塊は
 * 今までどおり decoders.ts から import してよい(起動の経路の endpoint は auth.ts・plans.ts・notifications.ts だけ)。
 */
import type { User } from '@/types';
import type { NormalizedDay, NormalizedEvent, NormalizedPlanDetail, Notification, PromoteQuickDraftResult, AuthResponse, AuthUser, GuestSessionResponse, ActiveSession, MfaChallenge, MfaRecoveryCodes, MfaSetup, MfaStatus, PlanDeleteResult, DeletionImpact, ItemDeleteResult } from './types';
import { arrayOf, bool, int, isRecord, matching, nonNegativeInt, nullable, num, object, oneOf, optional, record, str, trueOnly, type Decoder } from './decode';

export interface RevisionResult {
  revision: number;
}

export const revisionResult: Decoder<RevisionResult> = object<RevisionResult>({ revision: int });

// [Gate B-013] 個別削除で外した紐付け・一緒に削除したデータの件数。件数は利用者への
// 案内(「予約1件との紐付けを外しました」)に使うため、非負の整数であることを検証する。
export const count = nonNegativeInt;

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
  hidden_fields: optional(arrayOf(str)),
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
  ui_style: optional(nullable(str)),
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
  ui_style: optional(nullable(str)),
});

export const authResponse: Decoder<AuthResponse> = object<AuthResponse>({
  access_token: str,
  token_type: str,
  user: authUser,
});

// [Gate S11] 多要素認証(backend app/api/v1/mfa.py、auth.py MfaChallengeResponse)
export const mfaChallenge: Decoder<MfaChallenge> = object<MfaChallenge>({
  mfa_required: trueOnly,
  mfa_token: str,
  methods: arrayOf(str),
  expires_in: int,
});

/** POST /auth/login: 確認コードの入力待ち(mfa_required)か、ログイン完了か */
export const loginResult: Decoder<AuthResponse | MfaChallenge> = (v, path) =>
  isRecord(v) && v.mfa_required === true ? mfaChallenge(v, path) : authResponse(v, path);

export const mfaStatus: Decoder<MfaStatus> = object<MfaStatus>({
  enabled: bool,
  pending: bool,
  confirmed_at: nullable(str),
  recovery_codes_remaining: nonNegativeInt,
  is_admin: bool,
  required: bool,
  session_verified: bool,
  session_verified_at: nullable(str),
});

export const mfaSetup: Decoder<MfaSetup> = object<MfaSetup>({
  secret: matching(/^[A-Z2-7]{16,64}$/, 'base32 の秘密'),
  otpauth_uri: matching(/^otpauth:\/\/totp\//, 'otpauth://totp/ で始まる URI'),
  digits: int,
  period: int,
  algorithm: str,
});

export const mfaRecoveryCodes: Decoder<MfaRecoveryCodes> = object<MfaRecoveryCodes>({
  recovery_codes: arrayOf(str),
});

// [Gate S9] ログイン中の端末(GET /auth/sessions)。device_info(User-Agent 全文)は画面で使わないので読まない
export const activeSession: Decoder<ActiveSession> = object<ActiveSession>({
  id: str,
  device_label: str,
  network_label: nullable(str),
  ip_address: nullable(str),
  created_at: str,
  last_active_at: str,
  expires_at: str,
  is_current: bool,
});

export const guestSessionResponse: Decoder<GuestSessionResponse> = object<GuestSessionResponse>({
  access_token: str,
  token_type: str,
  user_type: oneOf('guest'),
  guest_id: str,
  expires_in_hours: int,
});

export const planDeleteResult: Decoder<PlanDeleteResult> = object<PlanDeleteResult>({
  message: str,
  deleted_at: str,
  purge_after: str,
});
