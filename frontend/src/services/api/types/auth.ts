/**
 * 認証API(/auth/*)の型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。
 * [Gate A1] login/register/guest/guest-upgradeの応答型を実backend
 * (backend/app/api/v1/auth.py TokenResponse / GuestSessionResponse)に合わせて修正した。
 * 以前の AuthResponse は `{success, data: {user, token: {...}}}` という
 * backendに存在しない形状を前提にしており、authStoreが独自fetchを使っていたため
 * 誰にも使われていなかった(実際に呼べば常に失敗する死んだ定義だった)。
 */
import type { User } from '@/types';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
}

/** POST /auth/guest/upgrade の入力(backend GuestUpgradeRequest。形はRegisterDataと同じ)。 */
export type GuestUpgradeData = RegisterData;

/**
 * login/register/guest-upgrade応答のuser(backend UserResponse)。
 * GET /auth/me(User)と違い is_active/created_at/preferences を含まない。
 */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  user_type: string;
  is_verified: boolean;
}

/**
 * authStoreが保持するログイン中ユーザー。login直後はAuthUser(is_active/created_at無し)、
 * GET /auth/me 取得後はUserの全項目を持つ。id/username/emailは常に存在し、
 * それ以外(user_type/role等)は取得経路により有無が変わる。
 */
export type SessionUser = Pick<User, 'id' | 'username' | 'email'> &
  Partial<Omit<User, 'id' | 'username' | 'email'>>;

/** POST /auth/login・/auth/register・/auth/guest/upgrade の応答(backend TokenResponse)。 */
export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

/**
 * [Gate S11] パスワードは正しいが、多要素認証の確認コードがまだの時の POST /auth/login の応答
 * (backend MfaChallengeResponse)。この時点ではセッションは作られていない。
 */
export interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
  methods: string[];
  expires_in: number;
}

/** [Gate S11] POST /auth/login の応答。ログイン完了か、確認コードの入力待ち。 */
export type LoginResult = AuthResponse | MfaChallenge;

/** [Gate S11] GET /auth/mfa(backend MfaStatus)。 */
export interface MfaStatus {
  enabled: boolean;
  pending: boolean;
  confirmed_at: string | null;
  recovery_codes_remaining: number;
  is_admin: boolean;
  /** 管理者で、多要素認証が必須 */
  required: boolean;
  /** このセッションで確認コードを通した(管理者は ADMIN_MFA_MAX_AGE_HOURS 以内) */
  session_verified: boolean;
  session_verified_at: string | null;
}

/** [Gate S11] POST /auth/mfa/setup(1回だけ返る。保存しない) */
export interface MfaSetup {
  secret: string;
  otpauth_uri: string;
  digits: number;
  period: number;
  algorithm: string;
}

/** [Gate S11] POST /auth/mfa/enable・/recovery-codes(1回だけ返る。保存しない) */
export interface MfaRecoveryCodes {
  recovery_codes: string[];
}

/** [Gate S9] GET /auth/sessions の1件(backend SessionInfo)。ログイン中の端末。 */
export interface ActiveSession {
  id: string;
  device_label: string;
  network_label: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  is_current: boolean;
}

/** POST /auth/guest の応答(backend GuestSessionResponse)。 */
export interface GuestSessionResponse {
  access_token: string;
  token_type: string;
  user_type: string;
  guest_id: string;
  expires_in_hours: number;
}
