/**
 * フォーマット関数ユーティリティ
 * 日付、時間、通貨、数値などの表示用フォーマット
 */

// 日付・時間フォーマット
export const formatDate = (
  date: string | Date,
  options: Intl.DateTimeFormatOptions = {}
): string => {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...options
    };

    return new Intl.DateTimeFormat('ja-JP', defaultOptions).format(dateObj);
  } catch (error) {
    console.error('Date formatting error:', error);
    return 'Invalid Date';
  }
};

export const formatShortDate = (date: string | Date): string => {
  return formatDate(date, {
    month: 'short',
    day: 'numeric'
  });
};

export const formatDateRange = (startDate: string | Date, endDate: string | Date): string => {
  const start = formatShortDate(startDate);
  const end = formatShortDate(endDate);
  return `${start} - ${end}`;
};

export const formatTime = (
  time: string | Date,
  format: '12h' | '24h' = '24h'
): string => {
  try {
    const timeObj = typeof time === 'string' ? new Date(`2000-01-01T${time}`) : time;
    
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: format === '12h'
    };

    return new Intl.DateTimeFormat('ja-JP', options).format(timeObj);
  } catch (error) {
    console.error('Time formatting error:', error);
    return 'Invalid Time';
  }
};

export const formatDateTime = (
  dateTime: string | Date,
  options: Intl.DateTimeFormatOptions = {}
): string => {
  try {
    const dateTimeObj = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
    
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...options
    };

    return new Intl.DateTimeFormat('ja-JP', defaultOptions).format(dateTimeObj);
  } catch (error) {
    console.error('DateTime formatting error:', error);
    return 'Invalid DateTime';
  }
};

export const formatRelativeTime = (date: string | Date): string => {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return 'たった今';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}分前`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}時間前`;
    } else if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}日前`;
    } else {
      return formatDate(dateObj);
    }
  } catch (error) {
    console.error('Relative time formatting error:', error);
    return 'Invalid Date';
  }
};

// 通貨フォーマット
export const formatCurrency = (
  amount: number,
  currency: string = 'JPY',
  locale: string = 'ja-JP'
): string => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: currency === 'JPY' ? 0 : 2
    }).format(amount);
  } catch (error) {
    console.error('Currency formatting error:', error);
    return `${amount} ${currency}`;
  }
};

export const formatCurrencyShort = (amount: number, currency: string = 'JPY'): string => {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M ${currency}`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K ${currency}`;
  }
  return formatCurrency(amount, currency);
};

// 数値フォーマット
export const formatNumber = (
  num: number,
  locale: string = 'ja-JP',
  options: Intl.NumberFormatOptions = {}
): string => {
  try {
    return new Intl.NumberFormat(locale, options).format(num);
  } catch (error) {
    console.error('Number formatting error:', error);
    return num.toString();
  }
};

export const formatPercent = (
  value: number,
  decimals: number = 1
): string => {
  try {
    return new Intl.NumberFormat('ja-JP', {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value / 100);
  } catch (error) {
    console.error('Percent formatting error:', error);
    return `${value}%`;
  }
};

export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

// 時間関連フォーマット
export const formatDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes}分`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours}時間`;
  }
  
  return `${hours}時間${remainingMinutes}分`;
};

export const formatDurationShort = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  
  return `${hours}h${remainingMinutes}m`;
};

export const formatTimeRange = (startTime: string, endTime: string): string => {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
};

// 距離フォーマット
export const formatDistance = (meters: number): string => {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  
  const kilometers = meters / 1000;
  return `${kilometers.toFixed(1)}km`;
};

// テキストフォーマット
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.slice(0, maxLength - 3) + '...';
};

export const capitalizeFirst = (text: string): string => {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const formatPhoneNumber = (phone: string): string => {
  // 日本の電話番号フォーマット
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    // 固定電話: 03-1234-5678
    return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3');
  } else if (cleaned.length === 11) {
    // 携帯電話: 090-1234-5678
    return cleaned.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  
  return phone;
};

export const formatPostalCode = (postalCode: string): string => {
  // 日本の郵便番号フォーマット: 123-4567
  const cleaned = postalCode.replace(/\D/g, '');
  
  if (cleaned.length === 7) {
    return cleaned.replace(/(\d{3})(\d{4})/, '$1-$2');
  }
  
  return postalCode;
};

// URL・リンクフォーマット
export const formatUrl = (url: string): string => {
  if (!url) return '';
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  
  return url;
};

export const extractDomain = (url: string): string => {
  try {
    const urlObj = new URL(formatUrl(url));
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
};

// プラン関連フォーマット
export const formatPlanDuration = (startDate: string, endDate: string): string => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 1) {
    return '日帰り';
  } else {
    return `${diffDays - 1}泊${diffDays}日`;
  }
};

export const formatPlanStatus = (status: string): string => {
  const statusMap: Record<string, string> = {
    'draft': '下書き',
    'active': 'アクティブ',
    'completed': '完了',
    'archived': 'アーカイブ'
  };
  
  return statusMap[status] || status;
};

export const formatUserType = (userType: string): string => {
  const typeMap: Record<string, string> = {
    'guest': 'ゲスト',
    'registered': '登録ユーザー',
    'premium': 'プレミアム',
    'admin': '管理者'
  };
  
  return typeMap[userType] || userType;
};

// エラーメッセージフォーマット
export const formatErrorMessage = (error: any): string => {
  if (typeof error === 'string') {
    return error;
  }
  
  if (error?.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  
  if (error?.message) {
    return error.message;
  }
  
  return '予期しないエラーが発生しました';
};

// バリデーション関連フォーマット
export const formatValidationErrors = (errors: Record<string, string[]>): string[] => {
  const formattedErrors: string[] = [];
  
  Object.entries(errors).forEach(([field, fieldErrors]) => {
    fieldErrors.forEach(error => {
      formattedErrors.push(`${field}: ${error}`);
    });
  });
  
  return formattedErrors;
};

// カラーフォーマット
export const formatHexColor = (color: string): string => {
  if (!color.startsWith('#')) {
    return `#${color}`;
  }
  return color;
};

export const formatRgbColor = (r: number, g: number, b: number, alpha?: number): string => {
  if (alpha !== undefined) {
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
};

// 座標フォーマット
export const formatCoordinates = (lat: number, lng: number, precision: number = 6): string => {
  return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
};

export const formatLatitude = (lat: number): string => {
  const direction = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lat).toFixed(6)}°${direction}`;
};

export const formatLongitude = (lng: number): string => {
  const direction = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lng).toFixed(6)}°${direction}`;
};

// 評価・レーティングフォーマット
export const formatRating = (rating: number, maxRating: number = 5): string => {
  const stars = '★'.repeat(Math.floor(rating)) + '☆'.repeat(maxRating - Math.floor(rating));
  return `${stars} (${rating.toFixed(1)})`;
};

export const formatReviewCount = (count: number): string => {
  if (count === 0) {
    return 'レビューなし';
  } else if (count === 1) {
    return '1件のレビュー';
  } else {
    return `${formatNumber(count)}件のレビュー`;
  }
};