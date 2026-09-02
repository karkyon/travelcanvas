/**
 * ストレージ管理ユーティリティ
 * ローカルストレージ、セッションストレージ、IndexedDBの統一インターフェース
 */

import { STORAGE_KEYS } from '../config/constants';

// ストレージタイプ
export type StorageType = 'localStorage' | 'sessionStorage' | 'memory';

// ストレージ操作の結果
export interface StorageResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// メモリストレージ（フォールバック用）
class MemoryStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// ストレージ可用性チェック
const isStorageAvailable = (type: StorageType): boolean => {
  if (type === 'memory') return true;
  
  try {
    const storage = type === 'localStorage' ? window.localStorage : window.sessionStorage;
    const testKey = '__storage_test__';
    storage.setItem(testKey, 'test');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
};

// ストレージインスタンスの取得
const getStorage = (type: StorageType): Storage => {
  if (type === 'memory' || !isStorageAvailable(type)) {
    return new MemoryStorage();
  }
  
  return type === 'localStorage' ? window.localStorage : window.sessionStorage;
};

/**
 * 統一ストレージクラス
 */
class UnifiedStorage {
  private storage: Storage;
  private type: StorageType;

  constructor(type: StorageType = 'localStorage') {
    this.type = type;
    this.storage = getStorage(type);
  }

  /**
   * 現在のストレージタイプを取得
   */
  getType(): StorageType {
    return this.type;
  }

  /**
   * データを保存
   */
  setItem<T>(key: string, value: T, options?: {
    expire?: number; // 有効期限（ミリ秒）
    encrypt?: boolean; // 暗号化フラグ
  }): StorageResult<void> {
    try {
      const data = {
        value,
        timestamp: Date.now(),
        expire: options?.expire ? Date.now() + options.expire : null,
        encrypted: options?.encrypt || false
      };

      let serializedData = JSON.stringify(data);
      
      if (options?.encrypt) {
        serializedData = this.encrypt(serializedData);
      }

      this.storage.setItem(key, serializedData);
      
      return { success: true };
    } catch (error) {
      console.error('Storage setItem error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * データを取得
   */
  getItem<T>(key: string): StorageResult<T> {
    try {
      const item = this.storage.getItem(key);
      
      if (!item) {
        return { success: false, error: 'Item not found' };
      }

      let parsedData;
      try {
        // 暗号化されているかチェック
        if (this.isEncrypted(item)) {
          const decrypted = this.decrypt(item);
          parsedData = JSON.parse(decrypted);
        } else {
          parsedData = JSON.parse(item);
        }
      } catch {
        // 古いフォーマットのデータの場合
        return { success: true, data: item as T };
      }

      // 有効期限チェック
      if (parsedData.expire && Date.now() > parsedData.expire) {
        this.removeItem(key);
        return { success: false, error: 'Item expired' };
      }

      return { success: true, data: parsedData.value };
    } catch (error) {
      console.error('Storage getItem error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * データを削除
   */
  removeItem(key: string): StorageResult<void> {
    try {
      this.storage.removeItem(key);
      return { success: true };
    } catch (error) {
      console.error('Storage removeItem error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * 全データを削除
   */
  clear(): StorageResult<void> {
    try {
      this.storage.clear();
      return { success: true };
    } catch (error) {
      console.error('Storage clear error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * キーの存在チェック
   */
  hasItem(key: string): boolean {
    return this.storage.getItem(key) !== null;
  }

  /**
   * 全キーを取得
   */
  getAllKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  }

  /**
   * ストレージサイズを取得（概算）
   */
  getSize(): number {
    let total = 0;
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key) {
        const value = this.storage.getItem(key);
        total += key.length + (value?.length || 0);
      }
    }
    return total;
  }

  /**
   * 期限切れアイテムをクリーンアップ
   */
  cleanup(): number {
    let removedCount = 0;
    const keys = this.getAllKeys();
    
    keys.forEach(key => {
      const result = this.getItem(key);
      if (!result.success && result.error === 'Item expired') {
        removedCount++;
      }
    });
    
    return removedCount;
  }

  /**
   * 簡易暗号化（本格的な暗号化ではない）
   */
  private encrypt(data: string): string {
    try {
      return btoa(encodeURIComponent(data));
    } catch {
      return data;
    }
  }

  /**
   * 復号化
   */
  private decrypt(data: string): string {
    try {
      return decodeURIComponent(atob(data));
    } catch {
      return data;
    }
  }

  /**
   * 暗号化されているかチェック
   */
  private isEncrypted(data: string): boolean {
    try {
      atob(data);
      return true;
    } catch {
      return false;
    }
  }
}

// デフォルトストレージインスタンス
export const localStorage = new UnifiedStorage('localStorage');
export const sessionStorage = new UnifiedStorage('sessionStorage');
export const memoryStorage = new UnifiedStorage('memory');

/**
 * 認証情報管理
 */
export class AuthStorage {
  private storage = localStorage;

  setAuthToken(token: string, refreshToken?: string): void {
    const authData = {
      access_token: token,
      refresh_token: refreshToken,
      timestamp: Date.now()
    };
    
    this.storage.setItem(STORAGE_KEYS.AUTH_TOKEN, authData, {
      encrypt: true
    });
  }

  getAuthToken(): string | null {
    const result = this.storage.getItem<{
      access_token: string;
      refresh_token?: string;
      timestamp: number;
    }>(STORAGE_KEYS.AUTH_TOKEN);
    
    return result.success ? result.data!.access_token : null;
  }

  getRefreshToken(): string | null {
    const result = this.storage.getItem<{
      access_token: string;
      refresh_token?: string;
      timestamp: number;
    }>(STORAGE_KEYS.AUTH_TOKEN);
    
    return result.success ? result.data!.refresh_token || null : null;
  }

  removeAuthToken(): void {
    this.storage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  }

  isAuthenticated(): boolean {
    return this.getAuthToken() !== null;
  }
}

/**
 * ユーザー設定管理
 */
export class UserPreferencesStorage {
  private storage = localStorage;

  setPreferences(preferences: Record<string, any>): void {
    this.storage.setItem(STORAGE_KEYS.USER_PREFERENCES, preferences);
  }

  getPreferences(): Record<string, any> {
    const result = this.storage.getItem<Record<string, any>>(STORAGE_KEYS.USER_PREFERENCES);
    return result.success ? result.data! : {};
  }

  setPreference(key: string, value: any): void {
    const preferences = this.getPreferences();
    preferences[key] = value;
    this.setPreferences(preferences);
  }

  getPreference(key: string, defaultValue?: any): any {
    const preferences = this.getPreferences();
    return preferences[key] !== undefined ? preferences[key] : defaultValue;
  }

  removePreference(key: string): void {
    const preferences = this.getPreferences();
    delete preferences[key];
    this.setPreferences(preferences);
  }
}

/**
 * キャッシュ管理
 */
export class CacheStorage {
  private storage = localStorage;
  
  set<T>(key: string, data: T, ttl?: number): void {
    this.storage.setItem(`cache_${key}`, data, {
      expire: ttl
    });
  }

  get<T>(key: string): T | null {
    const result = this.storage.getItem<T>(`cache_${key}`);
    return result.success ? result.data! : null;
  }

  remove(key: string): void {
    this.storage.removeItem(`cache_${key}`);
  }

  clear(): void {
    const keys = this.storage.getAllKeys();
    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        this.storage.removeItem(key);
      }
    });
  }

  cleanup(): number {
    return this.storage.cleanup();
  }
}

/**
 * オフラインキュー管理
 */
export class OfflineQueueStorage {
  private storage = localStorage;
  private queueKey = STORAGE_KEYS.OFFLINE_QUEUE;

  addToQueue(item: {
    id: string;
    type: string;
    data: any;
    timestamp: number;
    retryCount?: number;
  }): void {
    const queue = this.getQueue();
    queue.push(item);
    this.storage.setItem(this.queueKey, queue);
  }

  getQueue(): any[] {
    const result = this.storage.getItem<any[]>(this.queueKey);
    return result.success ? result.data! : [];
  }

  removeFromQueue(id: string): void {
    const queue = this.getQueue();
    const filteredQueue = queue.filter(item => item.id !== id);
    this.storage.setItem(this.queueKey, filteredQueue);
  }

  clearQueue(): void {
    this.storage.removeItem(this.queueKey);
  }

  getQueueSize(): number {
    return this.getQueue().length;
  }
}

/**
 * エラーログ管理
 */
export class ErrorLogStorage {
  private storage = localStorage;
  private maxLogs = 50;

  addError(error: {
    id: string;
    message: string;
    stack?: string;
    timestamp: number;
    url: string;
    userAgent: string;
    userId?: string;
  }): void {
    const logs = this.getErrors();
    logs.unshift(error);
    
    // 最大件数を超えた場合は古いログを削除
    if (logs.length > this.maxLogs) {
      logs.splice(this.maxLogs);
    }
    
    this.storage.setItem(STORAGE_KEYS.ERROR_LOGS, logs);
  }

  getErrors(): any[] {
    const result = this.storage.getItem<any[]>(STORAGE_KEYS.ERROR_LOGS);
    return result.success ? result.data! : [];
  }

  clearErrors(): void {
    this.storage.removeItem(STORAGE_KEYS.ERROR_LOGS);
  }

  getErrorCount(): number {
    return this.getErrors().length;
  }
}

// インスタンスをエクスポート
export const authStorage = new AuthStorage();
export const userPreferencesStorage = new UserPreferencesStorage();
export const cacheStorage = new CacheStorage();
export const offlineQueueStorage = new OfflineQueueStorage();
export const errorLogStorage = new ErrorLogStorage();

/**
 * ストレージユーティリティ関数
 */
export const storageUtils = {
  /**
   * 全ストレージを初期化
   */
  clearAll(): void {
    localStorage.clear();
    sessionStorage.clear();
    memoryStorage.clear();
  },

  /**
   * ストレージサイズの取得
   */
  getTotalSize(): {
    localStorage: number;
    sessionStorage: number;
    total: number;
  } {
    const localSize = localStorage.getSize();
    const sessionSize = sessionStorage.getSize();
    
    return {
      localStorage: localSize,
      sessionStorage: sessionSize,
      total: localSize + sessionSize
    };
  },

  /**
   * 全ストレージのクリーンアップ
   */
  cleanupAll(): {
    localStorage: number;
    sessionStorage: number;
    total: number;
  } {
    const localCleanup = localStorage.cleanup();
    const sessionCleanup = sessionStorage.cleanup();
    
    return {
      localStorage: localCleanup,
      sessionStorage: sessionCleanup,
      total: localCleanup + sessionCleanup
    };
  },

  /**
   * ストレージ使用状況の診断
   */
  getDiagnostics(): {
    available: {
      localStorage: boolean;
      sessionStorage: boolean;
    };
    sizes: {
      localStorage: number;
      sessionStorage: number;
      total: number;
    };
    itemCounts: {
      localStorage: number;
      sessionStorage: number;
      total: number;
    };
  } {
    return {
      available: {
        localStorage: isStorageAvailable('localStorage'),
        sessionStorage: isStorageAvailable('sessionStorage')
      },
      sizes: this.getTotalSize(),
      itemCounts: {
        localStorage: localStorage.getAllKeys().length,
        sessionStorage: sessionStorage.getAllKeys().length,
        total: localStorage.getAllKeys().length + sessionStorage.getAllKeys().length
      }
    };
  },

  /**
   * デバッグ情報の出力
   */
  debug(): void {
    const diagnostics = this.getDiagnostics();
    console.group('🗄️ Storage Diagnostics');
    console.log('Availability:', diagnostics.available);
    console.log('Sizes (bytes):', diagnostics.sizes);
    console.log('Item counts:', diagnostics.itemCounts);
    console.log('Auth:', authStorage.isAuthenticated());
    console.log('Cache items:', cacheStorage.get('_cache_list') || []);
    console.log('Offline queue size:', offlineQueueStorage.getQueueSize());
    console.log('Error log count:', errorLogStorage.getErrorCount());
    console.groupEnd();
  }
};