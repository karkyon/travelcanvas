/**
 * 環境設定管理
 * 環境変数の型安全な管理とバリデーション
 */

interface EnvironmentConfig {
  // アプリケーション基本設定
  APP_NAME: string;
  APP_VERSION: string;
  APP_DESCRIPTION: string;
  
  // API設定
  API_BASE_URL: string;
  WS_URL: string;
  
  // 認証設定
  JWT_STORAGE_KEY: string;
  GUEST_STORAGE_KEY: string;
  
  // 外部サービス設定
  GOOGLE_MAPS_API_KEY: string;
  GOOGLE_ANALYTICS_ID?: string;
  SENTRY_DSN?: string;
  HOTJAR_ID?: string;
  
  // AI/機能設定
  AI_FEATURES_ENABLED: boolean;
  VOICE_SEARCH_ENABLED: boolean;
  IMAGE_SEARCH_ENABLED: boolean;
  OPTIMIZATION_ENABLED: boolean;
  
  // PWA設定
  PWA_ENABLED: boolean;
  OFFLINE_ENABLED: boolean;
  
  // 開発・デバッグ設定
  DEBUG: boolean;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  MOCK_API: boolean;
  
  // パフォーマンス設定
  API_TIMEOUT: number;
  RETRY_ATTEMPTS: number;
  CACHE_TTL: number;
  
  // UI設定
  DEFAULT_LANGUAGE: string;
  DEFAULT_TIMEZONE: string;
  DEFAULT_CURRENCY: string;
  
  // セキュリティ設定
  CSP_ENABLED: boolean;
  SECURE_COOKIES: boolean;
}

/**
 * 環境変数のバリデーション
 */
function validateEnvironment(): EnvironmentConfig {
  const requiredVars = [
    'VITE_API_BASE_URL',
    'VITE_WS_URL',
    'VITE_GOOGLE_MAPS_API_KEY'
  ];

  // 必須環境変数のチェック
  const missingVars = requiredVars.filter(varName => !import.meta.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Boolean型の変換ヘルパー
  const toBool = (value: string | undefined, defaultValue = false): boolean => {
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  };

  // Number型の変換ヘルパー
  const toNumber = (value: string | undefined, defaultValue: number): number => {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  return {
    // アプリケーション基本設定
    APP_NAME: import.meta.env.VITE_APP_NAME || 'TravelCanvas',
    APP_VERSION: import.meta.env.VITE_APP_VERSION || '1.0.0',
    APP_DESCRIPTION: import.meta.env.VITE_APP_DESCRIPTION || 'AI旅行計画プラットフォーム',
    
    // API設定
    API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    WS_URL: import.meta.env.VITE_WS_URL,
    
    // 認証設定
    JWT_STORAGE_KEY: import.meta.env.VITE_JWT_STORAGE_KEY || 'travelcanvas_auth',
    GUEST_STORAGE_KEY: import.meta.env.VITE_GUEST_STORAGE_KEY || 'travelcanvas_guest',
    
    // 外部サービス設定
    GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    GOOGLE_ANALYTICS_ID: import.meta.env.VITE_GOOGLE_ANALYTICS_ID,
    SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
    HOTJAR_ID: import.meta.env.VITE_HOTJAR_ID,
    
    // AI/機能設定
    AI_FEATURES_ENABLED: toBool(import.meta.env.VITE_AI_FEATURES_ENABLED, true),
    VOICE_SEARCH_ENABLED: toBool(import.meta.env.VITE_VOICE_SEARCH_ENABLED, true),
    IMAGE_SEARCH_ENABLED: toBool(import.meta.env.VITE_IMAGE_SEARCH_ENABLED, true),
    OPTIMIZATION_ENABLED: toBool(import.meta.env.VITE_OPTIMIZATION_ENABLED, true),
    
    // PWA設定
    PWA_ENABLED: toBool(import.meta.env.VITE_PWA_ENABLED, true),
    OFFLINE_ENABLED: toBool(import.meta.env.VITE_OFFLINE_ENABLED, true),
    
    // 開発・デバッグ設定
    DEBUG: toBool(import.meta.env.VITE_DEBUG, import.meta.env.DEV),
    LOG_LEVEL: (import.meta.env.VITE_LOG_LEVEL as any) || (import.meta.env.DEV ? 'debug' : 'warn'),
    MOCK_API: toBool(import.meta.env.VITE_MOCK_API, false),
    
    // パフォーマンス設定
    API_TIMEOUT: toNumber(import.meta.env.VITE_API_TIMEOUT, 30000),
    RETRY_ATTEMPTS: toNumber(import.meta.env.VITE_RETRY_ATTEMPTS, 3),
    CACHE_TTL: toNumber(import.meta.env.VITE_CACHE_TTL, 300000), // 5分
    
    // UI設定
    DEFAULT_LANGUAGE: import.meta.env.VITE_DEFAULT_LANGUAGE || 'ja',
    DEFAULT_TIMEZONE: import.meta.env.VITE_DEFAULT_TIMEZONE || 'Asia/Tokyo',
    DEFAULT_CURRENCY: import.meta.env.VITE_DEFAULT_CURRENCY || 'JPY',
    
    // セキュリティ設定
    CSP_ENABLED: toBool(import.meta.env.VITE_CSP_ENABLED, true),
    SECURE_COOKIES: toBool(import.meta.env.VITE_SECURE_COOKIES, !import.meta.env.DEV)
  };
}

// 環境設定のエクスポート
export const env = validateEnvironment();

/**
 * 環境別設定の取得
 */
export const getEnvironmentType = (): 'development' | 'staging' | 'production' => {
  if (import.meta.env.DEV) return 'development';
  if (import.meta.env.VITE_ENVIRONMENT === 'staging') return 'staging';
  return 'production';
};

/**
 * 機能フラグの確認
 */
export const isFeatureEnabled = (feature: keyof Pick<EnvironmentConfig, 
  'AI_FEATURES_ENABLED' | 'VOICE_SEARCH_ENABLED' | 'IMAGE_SEARCH_ENABLED' | 
  'OPTIMIZATION_ENABLED' | 'PWA_ENABLED' | 'OFFLINE_ENABLED'>): boolean => {
  return env[feature];
};

/**
 * デバッグモードの確認
 */
export const isDebugMode = (): boolean => {
  return env.DEBUG;
};

/**
 * 本番環境の確認
 */
export const isProduction = (): boolean => {
  return getEnvironmentType() === 'production';
};

/**
 * 開発環境の確認
 */
export const isDevelopment = (): boolean => {
  return getEnvironmentType() === 'development';
};

/**
 * APIエンドポイントの構築
 */
export const buildApiUrl = (path: string): string => {
  const baseUrl = env.API_BASE_URL.replace(/\/$/, '');
  const cleanPath = path.replace(/^\//, '');
  return `${baseUrl}/${cleanPath}`;
};

/**
 * WebSocketエンドポイントの構築
 */
export const buildWsUrl = (path: string): string => {
  const baseUrl = env.WS_URL.replace(/\/$/, '');
  const cleanPath = path.replace(/^\//, '');
  return `${baseUrl}/${cleanPath}`;
};

/**
 * 設定の出力（デバッグ用）
 */
export const logEnvironmentInfo = (): void => {
  if (!env.DEBUG) return;
  
  console.group('🔧 Environment Configuration');
  console.log('Environment Type:', getEnvironmentType());
  console.log('App Version:', env.APP_VERSION);
  console.log('API Base URL:', env.API_BASE_URL);
  console.log('Features:', {
    ai: env.AI_FEATURES_ENABLED,
    voice: env.VOICE_SEARCH_ENABLED,
    image: env.IMAGE_SEARCH_ENABLED,
    optimization: env.OPTIMIZATION_ENABLED,
    pwa: env.PWA_ENABLED,
    offline: env.OFFLINE_ENABLED
  });
  console.log('Debug Mode:', env.DEBUG);
  console.log('Log Level:', env.LOG_LEVEL);
  console.groupEnd();
};

// 開発環境で設定情報を出力
if (isDevelopment()) {
  logEnvironmentInfo();
}