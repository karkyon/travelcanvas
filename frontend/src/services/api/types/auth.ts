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

/** POST /auth/guest の応答(backend GuestSessionResponse)。 */
export interface GuestSessionResponse {
  access_token: string;
  token_type: string;
  user_type: string;
  guest_id: string;
  expires_in_hours: number;
}
