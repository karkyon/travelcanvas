/**
 * 認証(/auth/*)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import type { User } from '@/types';
import { ApiCore } from '../core';
import type { ApiResponse, AuthResponse, LoginCredentials, RegisterData } from '../types';
import { apiOk, apiOkVoid } from '../response';

export class AuthApi extends ApiCore {
  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/register', data);
    
    if (response.data.success && response.data.data?.token) {
      this.setTokens(response.data.data.token.access_token);
    }

    return response.data;
  }

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/login', credentials);
    
    if (response.data.success && response.data.data?.token) {
      this.setTokens(response.data.data.token.access_token);
    }

    return response.data;
  }

  async logout(): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>('/auth/logout');
      return response.data;
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, message: 'ログアウトに失敗しました', data: undefined };
    } finally {
      this.clearTokens();
    }
  }

  // [Gate #20] 実バックエンド(GET/PUT /auth/me、今回新規実装)は
  // ApiResponseラッパー無しでユーザーオブジェクトを直接返す(他の多くの
  // エンドポイントと同じ形状)。この関数側でApiResponse形状に包み直す。
  async getCurrentUser(): Promise<ApiResponse<User>> {
    const response = await this.client.get<User>('/auth/me');
    return apiOk<User>(response.data);
  }

  async updateProfile(data: Partial<User> & { preferences?: Record<string, unknown> }): Promise<ApiResponse<User>> {
    const response = await this.client.put<User>('/auth/me', data);
    return apiOk<User>(response.data);
  }

  async changePassword(data: { 
    current_password: string; 
    new_password: string; 
  }): Promise<ApiResponse<void>> {
    // [Gate #21] 実バックエンド(/auth/change-password、今回新規実装)は
    // ApiResponseラッパー無しで {message: string} を直接返す。
    await this.client.post<{ message: string }>('/auth/change-password', data);
    return apiOkVoid();
  }
}
