// src/utils/geolocation.ts - 位置情報取得のユーティリティ

import { useState, useCallback } from 'react';

export interface GeolocationPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number;
}

export interface GeolocationError {
  code: number;
  message: string;
}

export class GeolocationService {
  private static instance: GeolocationService;
  private cache: GeolocationPosition | null = null;
  private readonly CACHE_DURATION = 10 * 60 * 1000; // 10分

  static getInstance(): GeolocationService {
    if (!GeolocationService.instance) {
      GeolocationService.instance = new GeolocationService();
    }
    return GeolocationService.instance;
  }

  /**
   * 現在位置を取得（改善版）
   */
  async getCurrentPosition(options?: {
    timeout?: number;
    enableHighAccuracy?: boolean;
    maximumAge?: number;
    useCache?: boolean;
  }): Promise<GeolocationPosition> {
    const defaultOptions = {
      timeout: 10000, // 10秒
      enableHighAccuracy: false, // バッテリー節約のためfalse
      maximumAge: 5 * 60 * 1000, // 5分
      useCache: true
    };

    const finalOptions = { ...defaultOptions, ...options };

    // キャッシュチェック
    if (finalOptions.useCache && this.cache && this.isCacheValid()) {
      console.log('📍 位置情報キャッシュを使用');
      return this.cache;
    }

    // Geolocation API対応チェック
    if (!this.isGeolocationSupported()) {
      console.warn('⚠️ Geolocation APIがサポートされていません');
      return this.getFallbackPosition();
    }

    try {
      console.log('📍 位置情報取得開始...');
      
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        const successCallback = (pos: GeolocationPosition) => {
          const result: GeolocationPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: Date.now()
          };
          
          // キャッシュに保存
          this.cache = result;
          console.log(`✅ 位置情報取得成功: ${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}`);
          resolve(result);
        };

        const errorCallback = (error: GeolocationPositionError) => {
          const errorInfo = this.getErrorMessage(error);
          console.error('❌ 位置情報取得失敗:', errorInfo);
          reject(new Error(errorInfo.message));
        };

        // タイムアウト処理
        const timeoutId = setTimeout(() => {
          console.warn('⏱️ 位置情報取得がタイムアウトしました');
          reject(new Error('位置情報取得がタイムアウトしました'));
        }, finalOptions.timeout);

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timeoutId);
            successCallback(pos);
          },
          (error) => {
            clearTimeout(timeoutId);
            errorCallback(error);
          },
          {
            enableHighAccuracy: finalOptions.enableHighAccuracy,
            timeout: finalOptions.timeout,
            maximumAge: finalOptions.maximumAge
          }
        );
      });

      return position;

    } catch (error) {
      console.error('位置情報取得エラー:', error);
      
      // フォールバック処理
      const fallbackPosition = this.getFallbackPosition();
      console.log('🔄 フォールバック位置情報を使用:', fallbackPosition);
      return fallbackPosition;
    }
  }

  /**
   * IP基づく概算位置取得（フォールバック）
   */
  async getLocationByIP(): Promise<GeolocationPosition> {
    try {
      console.log('🌐 IP基づく位置情報取得中...');
      
      // 複数のIPベース位置情報サービスを試行
      const services = [
        'https://ipapi.co/json/',
        'https://ipinfo.io/json'
      ];

      for (const serviceUrl of services) {
        try {
          const response = await fetch(serviceUrl, {
            headers: {
              'Accept': 'application/json'
            }
          });

          if (!response.ok) continue;

          const data = await response.json();
          
          // レスポンス形式の正規化
          let lat: number, lon: number;
          
          if (data.latitude && data.longitude) {
            lat = parseFloat(data.latitude);
            lon = parseFloat(data.longitude);
          } else if (data.lat && data.lon) {
            lat = parseFloat(data.lat);
            lon = parseFloat(data.lon);
          } else if (data.loc && typeof data.loc === 'string') {
            const [latStr, lonStr] = data.loc.split(',');
            lat = parseFloat(latStr);
            lon = parseFloat(lonStr);
          } else {
            continue;
          }

          if (isNaN(lat) || isNaN(lon)) continue;

          const position: GeolocationPosition = {
            latitude: lat,
            longitude: lon,
            accuracy: 10000, // IP位置情報は精度が低い
            timestamp: Date.now()
          };

          console.log(`✅ IP位置情報取得成功: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
          return position;

        } catch (serviceError) {
          console.warn(`IP位置情報サービスエラー (${serviceUrl}):`, serviceError);
          continue;
        }
      }

      // すべてのサービスが失敗した場合はデフォルト位置を返す
      throw new Error('IP位置情報取得に失敗しました');

    } catch (error) {
      console.error('IP位置情報取得エラー:', error);
      return this.getFallbackPosition();
    }
  }

  /**
   * Geolocation API対応チェック
   */
  isGeolocationSupported(): boolean {
    return 'geolocation' in navigator;
  }

  /**
   * 位置情報許可状態チェック
   */
  async checkPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
    if (!this.isGeolocationSupported()) {
      return 'unsupported';
    }

    try {
      if ('permissions' in navigator) {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        return permission.state;
      }
      
      // Permissions APIが使用できない場合は'prompt'を返す
      return 'prompt';
    } catch (error) {
      console.warn('位置情報許可状態チェックエラー:', error);
      return 'prompt';
    }
  }

  /**
   * キャッシュクリア
   */
  clearCache(): void {
    this.cache = null;
    console.log('🧹 位置情報キャッシュをクリアしました');
  }

  /**
   * キャッシュ有効性チェック
   */
  private isCacheValid(): boolean {
    if (!this.cache) return false;
    return (Date.now() - this.cache.timestamp) < this.CACHE_DURATION;
  }

  /**
   * デフォルト位置（東京）を取得
   */
  private getFallbackPosition(): GeolocationPosition {
    return {
      latitude: 35.6762,  // 東京駅
      longitude: 139.6503,
      accuracy: 50000, // 50km（概算）
      timestamp: Date.now()
    };
  }

  /**
   * エラーメッセージの取得
   */
  private getErrorMessage(error: GeolocationPositionError): GeolocationError {
    const errorMessages = {
      [error.PERMISSION_DENIED]: '位置情報の使用が拒否されました。ブラウザの設定で位置情報を許可してください。',
      [error.POSITION_UNAVAILABLE]: '位置情報を取得できませんでした。GPS機能をオンにしてください。',
      [error.TIMEOUT]: '位置情報の取得がタイムアウトしました。もう一度お試しください。'
    };

    return {
      code: error.code,
      message: errorMessages[error.code] || '位置情報取得中に不明なエラーが発生しました。'
    };
  }
}

// シングルトンインスタンス
export const geolocationService = GeolocationService.getInstance();

// React Hook形式のユーティリティ
export const useGeolocation = () => {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<GeolocationError | null>(null);
  const [loading, setLoading] = useState(false);

  const getCurrentPosition = useCallback(async (options?: Parameters<typeof geolocationService.getCurrentPosition>[0]) => {
    setLoading(true);
    setError(null);

    try {
      const pos = await geolocationService.getCurrentPosition(options);
      setPosition(pos);
      return pos;
    } catch (err) {
      const error = {
        code: 0,
        message: err instanceof Error ? err.message : '位置情報取得エラー'
      };
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const getCurrentPositionSafely = useCallback(async (options?: Parameters<typeof geolocationService.getCurrentPosition>[0]) => {
    try {
      return await getCurrentPosition(options);
    } catch (error) {
      // エラーを無視してフォールバック位置を返す
      const fallbackPos = {
        latitude: 35.6762,
        longitude: 139.6503,
        accuracy: 50000,
        timestamp: Date.now()
      };
      setPosition(fallbackPos);
      return fallbackPos;
    }
  }, [getCurrentPosition]);

  return {
    position,
    error,
    loading,
    getCurrentPosition,
    getCurrentPositionSafely,
    clearCache: geolocationService.clearCache.bind(geolocationService),
    isSupported: geolocationService.isGeolocationSupported()
  };
};