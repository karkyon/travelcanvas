import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import type { User, LoginCredentials, RegisterData } from '../types';

export const useAuth = () => {
  const { user, isAuthenticated, setUser, clearUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ゲストセッション作成
  const createGuestSession = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const deviceInfo = {
        platform: 'web',
        browser: navigator.userAgent.split(' ').pop()?.split('/')[0] || 'Unknown',
        version: navigator.userAgent.split(' ').pop()?.split('/')[1] || '1.0',
        user_agent: navigator.userAgent,
        screen_resolution: `${screen.width}x${screen.height}`
      };

      const response = await api.post('/auth/guest', {
        device_info: deviceInfo,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language
      });

      const { token } = response.data.data;
      localStorage.setItem('auth_token', token.access_token);
      setUser(token.user);
      
      return token.user;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'ゲストセッション作成に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // ログイン
  const login = async (credentials: LoginCredentials) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/auth/login', credentials);
      const { token } = response.data.data;
      
      localStorage.setItem('auth_token', token.access_token);
      localStorage.setItem('refresh_token', token.refresh_token);
      setUser(token.user);
      
      return token.user;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'ログインに失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // 会員登録
  const register = async (userData: RegisterData) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/auth/register', userData);
      const { token } = response.data.data;
      
      localStorage.setItem('auth_token', token.access_token);
      localStorage.setItem('refresh_token', token.refresh_token);
      setUser(token.user);
      
      return token.user;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '会員登録に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // ログアウト
  const logout = async () => {
    setLoading(true);
    
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('ログアウトAPIエラー:', err);
    } finally {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      clearUser();
      setLoading(false);
    }
  };

  // ゲストユーザーのアップグレード
  const upgradeGuest = async (userData: RegisterData) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/auth/upgrade-guest', userData);
      const { token } = response.data.data;
      
      localStorage.setItem('auth_token', token.access_token);
      localStorage.setItem('refresh_token', token.refresh_token);
      setUser(token.user);
      
      return token.user;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'アップグレードに失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // トークンリフレッシュ
  const refreshToken = async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return false;
    
    try {
      const response = await api.post('/auth/refresh', {
        refresh_token: refreshToken
      });
      
      const { token } = response.data.data;
      localStorage.setItem('auth_token', token.access_token);
      
      return true;
    } catch (err) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      clearUser();
      return false;
    }
  };

  // 初期化時のトークン確認
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token && !user) {
      // ユーザー情報を取得
      api.get('/auth/me')
        .then(response => {
          setUser(response.data.data);
        })
        .catch(() => {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
        });
    }
  }, [user, setUser]);

  return {
    user,
    isAuthenticated,
    loading,
    error,
    createGuestSession,
    login,
    register,
    logout,
    upgradeGuest,
    refreshToken,
    clearError: () => setError(null)
  };
};