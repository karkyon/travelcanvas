import { clsx, type ClassValue } from 'clsx';
import type { Coordinates, EventCategory, TransportMode } from '../types';

// ============================================================================
// CSS & Styling Utilities
// ============================================================================

/**
 * Tailwind CSS クラス名の結合
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ============================================================================
// Date & Time Utilities (Enhanced)
// ============================================================================

/**
 * 日付フォーマット（既存関数 - 後方互換性維持）
 */
export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options
  };
  
  return dateObj.toLocaleDateString('ja-JP', defaultOptions);
}

/**
 * 日付を日本語形式でフォーマット（拡張版）
 */
export const formatDateJP = (date: string | Date): string => {
  const d = new Date(date);
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
};

/**
 * 日付を短い形式でフォーマット (8/1(木))
 */
export const formatDateShort = (date: string | Date): string => {
  const d = new Date(date);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${month}/${day}(${weekday})`;
};

/**
 * 時間フォーマット（既存関数 - 後方互換性維持）
 */
export function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  return `${hours}:${minutes}`;
}

/**
 * 時間差計算（既存関数 - 後方互換性維持）
 */
export function calculateDuration(startTime: string, endTime: string): number {
  const start = new Date(`2000-01-01T${startTime}:00`);
  const end = new Date(`2000-01-01T${endTime}:00`);
  return Math.abs(end.getTime() - start.getTime()) / (1000 * 60); // 分単位
}

/**
 * 分数を時間表記に変換（拡張版）
 */
export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
  }
  return `${minutes}分`;
};

/**
 * 時間の加算（既存関数 - 後方互換性維持）
 */
export function addMinutes(time: string, minutes: number): string {
  const parts = time.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const mins = parts[1] ?? 0;
  const totalMinutes = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMinutes / 60) % 24;
  const newMins = totalMinutes % 60;
  
  return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;
}

/**
 * 相対時間を計算（拡張版）
 */
export const getRelativeTime = (targetTime: string): string => {
  const now = new Date();
  const target = new Date(targetTime);
  const diffMs = target.getTime() - now.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  if (diffMinutes < 0) {
    return `${Math.abs(diffMinutes)}分前`;
  } else if (diffMinutes === 0) {
    return '今';
  } else if (diffMinutes < 60) {
    return `あと${diffMinutes}分`;
  } else {
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return mins > 0 ? `あと${hours}時間${mins}分` : `あと${hours}時間`;
  }
};

/**
 * 次の予定までの時間計算（既存関数 - 後方互換性維持）
 */
export function timeUntil(targetTime: string): { text: string; isOverdue: boolean } {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const targetDateTime = new Date(`${today}T${targetTime}:00`);
  
  if (targetDateTime < now) {
    targetDateTime.setDate(targetDateTime.getDate() + 1);
  }
  
  const diffInMs = targetDateTime.getTime() - now.getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  
  if (diffInMinutes < 0) {
    const overdue = Math.abs(diffInMinutes);
    if (overdue < 60) {
      return { text: `${overdue}分遅れ`, isOverdue: true };
    } else {
      const hours = Math.floor(overdue / 60);
      const minutes = overdue % 60;
      return { text: `${hours}時間${minutes}分遅れ`, isOverdue: true };
    }
  } else if (diffInMinutes < 60) {
    return { text: `あと${diffInMinutes}分`, isOverdue: false };
  } else {
    const hours = Math.floor(diffInMinutes / 60);
    const minutes = diffInMinutes % 60;
    if (minutes === 0) {
      return { text: `あと${hours}時間`, isOverdue: false };
    } else {
      return { text: `あと${hours}時間${minutes}分`, isOverdue: false };
    }
  }
}

/**
 * 時間の経過表示（既存関数 - 後方互換性維持）
 */
export function timeAgo(date: string | Date): string {
  const now = new Date();
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  const diffInSeconds = Math.floor((now.getTime() - targetDate.getTime()) / 1000);
  
  if (diffInSeconds < 60) {
    return 'たった今';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes}分前`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours}時間前`;
  } else if (diffInSeconds < 2592000) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days}日前`;
  } else {
    return formatDate(targetDate, { month: 'short', day: 'numeric' });
  }
}

/**
 * 日付範囲を生成（新機能）
 */
export const generateDateRange = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0] || '');
  }
  
  return dates;
};

/**
 * 現在時刻が指定した時間範囲内かチェック（新機能）
 */
export const isCurrentlyBetween = (startTime: string, endTime: string, currentTime?: Date): boolean => {
  const now = currentTime || new Date();
  const today = now.toISOString().split('T')[0];
  
  const start = new Date(`${today}T${startTime}`);
  const end = new Date(`${today}T${endTime}`);
  
  return now >= start && now <= end;
};

// ============================================================================
// Currency & Number Utilities (Enhanced)
// ============================================================================

/**
 * 価格フォーマット（既存関数 - 後方互換性維持）
 */
export function formatPrice(price: number, currency: string = 'JPY'): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

/**
 * 通貨フォーマット（拡張版）
 */
export const formatCurrency = (amount: number, currency: string = 'JPY'): string => {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(amount);
};

/**
 * 数値の3桁区切り（既存関数 - 後方互換性維持）
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('ja-JP').format(num);
}

/**
 * 数値を短縮形式でフォーマット（新機能）
 */
export const formatNumberShort = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

/**
 * パーセンテージフォーマット（既存関数 - 後方互換性維持）
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// ============================================================================
// Distance & Location Utilities (New Features)
// ============================================================================

/**
 * 距離フォーマット（既存関数 - 後方互換性維持）
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  } else {
    return `${(meters / 1000).toFixed(1)}km`;
  }
}

/**
 * 距離をフォーマット（km版）
 */
export const formatDistanceKm = (km: number): string => {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  return `${km.toFixed(1)}km`;
};

/**
 * 2点間の距離を計算（新機能）
 */
export const calculateDistance = (coord1: Coordinates, coord2: Coordinates): number => {
  const R = 6371; // 地球の半径 (km)
  const dLat = toRadians(coord2.latitude - coord1.latitude);
  const dLon = toRadians(coord2.longitude - coord1.longitude);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(coord1.latitude)) * Math.cos(toRadians(coord2.latitude)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRadians = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};

// ============================================================================
// Category & Icon Utilities (Enhanced)
// ============================================================================

/**
 * カテゴリのアイコンマッピング（既存 - 拡張）
 */
export const categoryIcons: Record<string, string> = {
  sightseeing: '🏛️',
  culture: '🎭',
  nature: '🌿',
  food: '🍜',
  shopping: '🛍️',
  entertainment: '🎪',
  sports: '⚽',
  accommodation: '🏨',
  transport: '🚃',
  transportation: '🚃', // 後方互換性
  business: '💼',
  education: '📚',
  healthcare: '🏥',
  activity: '🎭',
  relaxation: '♨️',
  museum: '🏛️',
  park: '🌳',
  beach: '🏖️',
  mountain: '⛰️',
  temple: '⛩️',
  other: '📍',
  default: '📍'
};

/**
 * カテゴリの色マッピング（既存 - 拡張）
 */
export const categoryColors: Record<string, string> = {
  sightseeing: 'text-blue-600 bg-blue-50',
  culture: 'text-indigo-600 bg-indigo-50',
  nature: 'text-emerald-600 bg-emerald-50',
  food: 'text-orange-600 bg-orange-50',
  shopping: 'text-yellow-600 bg-yellow-50',
  entertainment: 'text-rose-600 bg-rose-50',
  sports: 'text-red-600 bg-red-50',
  accommodation: 'text-purple-600 bg-purple-50',
  transport: 'text-green-600 bg-green-50',
  transportation: 'text-green-600 bg-green-50', // 後方互換性
  business: 'text-gray-600 bg-gray-50',
  education: 'text-blue-600 bg-blue-50',
  healthcare: 'text-red-600 bg-red-50',
  activity: 'text-pink-600 bg-pink-50',
  relaxation: 'text-cyan-600 bg-cyan-50',
  other: 'text-gray-600 bg-gray-50',
  default: 'text-gray-600 bg-gray-50'
};

/**
 * カテゴリアイコンを取得（関数版）
 */
export const getCategoryIcon = (category: EventCategory): string => {
  return categoryIcons[category] || categoryIcons.default || '📍';
};

/**
 * 交通手段アイコンを取得（新機能）
 */
export const getTransportIcon = (transport: TransportMode): string => {
  const iconMap: Record<TransportMode, string> = {
    walking: '🚶',
    bicycle: '🚲',
    car: '🚗',
    taxi: '🚕',
    bus: '🚌',
    train: '🚃',
    subway: '🚇',
    tram: '🚊',
    ferry: '⛴️',
    plane: '✈️',
    driving: '🚗',
    transit: '🚌',
    boat: '⛵',
    other: '🚶'
  };
  return iconMap[transport] || '🚶';
};

/**
 * 価格レベルアイコンを取得（新機能）
 */
export const getPriceLevelIcon = (level: string): string => {
  switch (level) {
    case 'low': return '💰';
    case 'medium': return '💰💰';
    case 'high': return '💰💰💰';
    default: return '💰';
  }
};

/**
 * 優先度色を取得（新機能）
 */
export const getPriorityColor = (priority: 'low' | 'medium' | 'high'): string => {
  switch (priority) {
    case 'high': return 'text-red-500 border-red-500 bg-red-50';
    case 'medium': return 'text-yellow-500 border-yellow-500 bg-yellow-50';
    case 'low': return 'text-green-500 border-green-500 bg-green-50';
    default: return 'text-gray-500 border-gray-300 bg-white';
  }
};

// ============================================================================
// Validation Utilities (Enhanced)
// ============================================================================

/**
 * URLのバリデーション（既存関数 - 後方互換性維持）
 */
export function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * メールのバリデーション（既存関数 - 後方互換性維持）
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * パスワード強度チェック（既存関数 - 後方互換性維持）
 */
export function checkPasswordStrength(password: string): {
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;
  
  if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push('8文字以上にしてください');
  }
  
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('小文字を含めてください');
  }
  
  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('大文字を含めてください');
  }
  
  if (/[0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('数字を含めてください');
  }
  
  if (/[^a-zA-Z0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('記号を含めてください');
  }
  
  return { score, feedback };
}

// ============================================================================
// Array Utilities (Enhanced)
// ============================================================================

/**
 * 配列のシャッフル（既存関数 - 後方互換性維持）
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j] as T;
    shuffled[j] = temp as T;
  }
  return shuffled;
}

/**
 * 配列の重複削除（既存関数 - 後方互換性維持）
 */
export function uniqueArray<T>(array: T[], key?: keyof T): T[] {
  if (!key) {
    return Array.from(new Set(array));
  }
  
  const seen = new Set();
  return array.filter(item => {
    const value = item[key];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

/**
 * 配列の重複削除（関数版 - 拡張）
 */
export const uniqueArrayByKey = <T>(array: T[], keyFn?: (item: T) => any): T[] => {
  if (!keyFn) {
    return [...new Set(array)];
  }
  
  const seen = new Set();
  return array.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * 配列を指定サイズのチャンクに分割（新機能）
 */
export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// ============================================================================
// Object Utilities (Enhanced)
// ============================================================================

/**
 * オブジェクトのディープコピー（既存関数 - 後方互換性維持）
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date((obj as Date).getTime()) as unknown as T;
  }
  
  if (obj instanceof Array) {
    return (obj as unknown[]).map(item => deepClone(item)) as unknown as T;
  }
  
  if (obj instanceof Object) {
    const clonedObj = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
  
  return obj;
}

/**
 * オブジェクトから空の値を除去（新機能）
 */
export const removeEmpty = (obj: Record<string, any>): Record<string, any> => {
  const cleaned: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined && value !== '') {
      if (typeof value === 'object' && !Array.isArray(value)) {
        const nested = removeEmpty(value);
        if (Object.keys(nested).length > 0) {
          cleaned[key] = nested;
        }
      } else {
        cleaned[key] = value;
      }
    }
  }
  
  return cleaned;
};

// ============================================================================
// Performance Utilities (Enhanced)
// ============================================================================

/**
 * デバウンス関数（既存関数 - 後方互換性維持）
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * スロットル関数（既存関数 - 後方互換性維持）
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// ============================================================================
// Storage Utilities (Enhanced)
// ============================================================================

/**
 * ローカルストレージのセーフティ操作（既存 - 強化版）
 */
export const storage = {
  get: <T>(key: string, defaultValue?: T): T | null => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue ?? null;
    } catch (error) {
      console.error('Failed to get from localStorage:', error);
      return defaultValue ?? null;
    }
  },
  
  set: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  },
  
  remove: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to remove from localStorage:', error);
    }
  },
  
  clear: (): void => {
    try {
      localStorage.clear();
    } catch (error) {
      console.error('Failed to clear localStorage:', error);
    }
  }
};

// ============================================================================
// String Utilities (New Features)
// ============================================================================

/**
 * 文字列を切り詰める
 */
export const truncateString = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
};

/**
 * URLからドメイン名を抽出
 */
export const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
};

/**
 * 文字列をケバブケースに変換
 */
export const toKebabCase = (str: string): string => {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

/**
 * 文字列をタイトルケースに変換
 */
export const toTitleCase = (str: string): string => {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// ============================================================================
// Device Detection (New Features)
// ============================================================================

/**
 * デバイス情報を取得
 */
export const getDeviceInfo = () => {
  const userAgent = navigator.userAgent;
  
  return {
    platform: navigator.platform,
    userAgent,
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent),
    isTablet: /iPad|Android(?!.*Mobile)/i.test(userAgent),
    isDesktop: !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent),
    browser: getBrowserName(userAgent),
    version: getBrowserVersion(userAgent),
    screenResolution: `${screen.width}x${screen.height}`,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
};

const getBrowserName = (userAgent: string): string => {
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  if (userAgent.includes('Opera')) return 'Opera';
  return 'Unknown';
};

const getBrowserVersion = (userAgent: string): string => {
  const match = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)\/([0-9.]+)/);
  return match ? (match[2] || 'Unknown') : 'Unknown';
};

// ============================================================================
// Error Handling (New Features)
// ============================================================================

/**
 * エラーメッセージを日本語化
 */
export const getErrorMessage = (error: any): string => {
  if (typeof error === 'string') return error;
  
  if (error?.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  
  if (error?.response?.status) {
    switch (error.response.status) {
      case 401: return '認証が必要です';
      case 403: return 'アクセス権限がありません';
      case 404: return 'リソースが見つかりません';
      case 429: return 'リクエスト制限に達しました';
      case 500: return 'サーバーエラーが発生しました';
      default: return `エラーが発生しました (${error.response.status})`;
    }
  }
  
  if (error?.message) return error.message;
  
  return '予期しないエラーが発生しました';
};

/**
 * APIエラーハンドリング
 */
export const handleApiError = (error: any, showNotification?: (message: string, type: 'error') => void) => {
  const message = getErrorMessage(error);
  console.error('API Error:', error);
  
  if (showNotification) {
    showNotification(message, 'error');
  }
  
  return message;
};

// ============================================================================
// File Utilities (New Features)
// ============================================================================

/**
 * ファイルサイズをフォーマット
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * ファイルタイプをチェック
 */
export const isImageFile = (file: File): boolean => {
  return file.type.startsWith('image/');
};

export const isAudioFile = (file: File): boolean => {
  return file.type.startsWith('audio/');
};

// ============================================================================
// Animation Utilities (New Features)
// ============================================================================

/**
 * 要素をスムーズにスクロール
 */
export const smoothScrollTo = (element: HTMLElement, offset: number = 0): void => {
  const elementPosition = element.offsetTop;
  const offsetPosition = elementPosition - offset;
  
  window.scrollTo({
    top: offsetPosition,
    behavior: 'smooth'
  });
};

/**
 * ページトップにスクロール
 */
export const scrollToTop = (): void => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
};

// ============================================================================
// Default Export for Backwards Compatibility
// ============================================================================

export default {
  // CSS
  cn,
  
  // Date & Time
  formatDate,
  formatDateJP,
  formatDateShort,
  formatTime,
  calculateDuration,
  formatDuration,
  addMinutes,
  getRelativeTime,
  timeUntil,
  timeAgo,
  generateDateRange,
  isCurrentlyBetween,
  
  // Currency & Numbers
  formatPrice,
  formatCurrency,
  formatNumber,
  formatNumberShort,
  formatPercentage,
  
  // Distance & Location
  formatDistance,
  formatDistanceKm,
  calculateDistance,
  
  // Categories & Icons
  categoryIcons,
  categoryColors,
  getCategoryIcon,
  getTransportIcon,
  getPriceLevelIcon,
  getPriorityColor,
  
  // Validation
  isValidUrl,
  isValidEmail,
  checkPasswordStrength,
  
  // Array utilities
  shuffleArray,
  uniqueArray,
  uniqueArrayByKey,
  chunkArray,
  
  // Object utilities
  deepClone,
  removeEmpty,
  
  // Performance
  debounce,
  throttle,
  
  // Storage
  storage,
  
  // String utilities
  truncateString,
  extractDomain,
  toKebabCase,
  toTitleCase,
  
  // Device
  getDeviceInfo,
  
  // Error handling
  getErrorMessage,
  handleApiError,
  
  // File utilities
  formatFileSize,
  isImageFile,
  isAudioFile,
  
  // Animation
  smoothScrollTo,
  scrollToTop
};