/**
 * 認証API(/auth/*)の型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import type { User } from '@/types';
import type { ApiResponse } from './common';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse extends ApiResponse {
  data: {
    user: User;
    token: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  };
}
