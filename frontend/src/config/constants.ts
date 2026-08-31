/**
 * アプリケーション定数
 * UI、ビジネスロジック、設定値などの定数を管理
 */

// アプリケーション情報
export const APP_INFO = {
  NAME: 'TravelCanvas',
  FULL_NAME: 'TravelCanvas - AI旅行計画プラットフォーム',
  DESCRIPTION: '写真1枚から始まる、完璧な旅行プラン',
  AUTHOR: 'TravelCanvas Team',
  COPYRIGHT: '© 2025 TravelCanvas. All rights reserved.',
  VERSION: '1.0.0',
  BUILD_DATE: new Date().toISOString()
} as const;

// ルート定義
export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  PLANNER: '/planner',
  PLANNER_CREATE: '/planner/create',
  PLANNER_EDIT: '/planner/:id',
  SEARCH: '/search',
  OPTIMIZATION: '/optimization',
  SHARE: '/share',
  SETTINGS: '/settings',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  VERIFY_EMAIL: '/verify-email',
  HELP: '/help',
  PRIVACY: '/privacy',
  TERMS: '/terms',
  CONTACT: '/contact',
  NOT_FOUND: '/404',
  ERROR: '/error',
  OFFLINE: '/offline',
  
  // 管理画面
  ADMIN: '/admin',
  ADMIN_DASHBOARD: '/admin/dashboard',
  ADMIN_USERS: '/admin/users',
  ADMIN_PLANS: '/admin/plans',
  ADMIN_ANALYTICS: '/admin/analytics',
  ADMIN_SETTINGS: '/admin/settings'
} as const;

// API エンドポイント
export const API_ENDPOINTS = {
  // 認証
  AUTH: {
    GUEST: '/auth/guest',
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    ME: '/auth/me',
    CHANGE_PASSWORD: '/auth/change-password',
    FORGOT_PASSWORD: '/auth/forgot-password',
    RESET_PASSWORD: '/auth/reset-password',
    VERIFY_EMAIL: '/auth/verify-email',
    UPGRADE_GUEST: '/auth/upgrade-guest',
    DELETE_ACCOUNT: '/auth/delete-account'
  },
  
  // 旅行プラン
  TRAVEL: {
    PLANS: '/travel/plans',
    PLAN_DETAIL: (id: string) => `/travel/plans/${id}`,
    PLAN_OPTIMIZE: (id: string) => `/travel/plans/${id}/optimize`,
    PLAN_SHARE: (id: string) => `/travel/plans/${id}/share`,
    PLAN_COLLABORATORS: (id: string) => `/travel/plans/${id}/collaborators`,
    PLAN_CURRENT_STATUS: (id: string) => `/travel/plans/${id}/current-status`,
    SCHEDULE_ITEMS: '/travel/schedule-items',
    SCHEDULE_ITEM: (id: string) => `/travel/schedule-items/${id}`,
    SEARCH_SPOTS: '/travel/search/spots',
    SEARCH_IMAGE: '/travel/search/image',
    REORDER: (planId: string) => `/travel/plans/${planId}/reorder`
  },
  
  // AI機能
  AI: {
    SEARCH_TEXT: '/ai/search/text',
    SEARCH_IMAGE: '/ai/search/image',
    SEARCH_VOICE: '/ai/search/voice',
    RECOMMENDATIONS: '/ai/recommendations',
    ITINERARY_GENERATE: '/ai/itinerary/generate',
    USAGE: '/ai/usage',
    HEALTH: '/ai/health'
  },
  
  // 管理機能
  ADMIN: {
    STATS_SYSTEM: '/admin/stats/system',
    STATS_USERS: '/admin/stats/users',
    USERS: '/admin/users',
    USER_DETAIL: (id: string) => `/admin/users/${id}`,
    USER_MANAGE: '/admin/users/manage',
    SECURITY_LOGS: '/admin/security/logs',
    SECURITY_ALERTS: '/admin/security/alerts',
    SETTINGS: '/admin/settings',
    SETTINGS_UPDATE: '/admin/settings/update',
    EXPORT: '/admin/export',
    EXPORT_STATUS: (taskId: string) => `/admin/export/${taskId}/status`,
    EXPORT_DOWNLOAD: (taskId: string) => `/admin/export/${taskId}/download`,
    MAINTENANCE: '/admin/maintenance'
  },
  
  // 通知
  NOTIFICATIONS: {
    LIST: '/notifications',
    READ: (id: string) => `/notifications/${id}/read`,
    MARK_ALL_READ: '/notifications/mark-all-read',
    SETTINGS: '/notifications/settings'
  },
  
  // 最適化
  OPTIMIZATION: {
    JOB: (jobId: string) => `/travel/optimization/${jobId}`
  }
} as const;

// ユーザータイプ
export const USER_TYPES = {
  GUEST: 'guest',
  REGISTERED: 'registered',
  PREMIUM: 'premium',
  ADMIN: 'admin'
} as const;

// プランの状態
export const PLAN_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived'
} as const;

// スケジュールアイテムのカテゴリ
export const ITEM_CATEGORIES = {
  SIGHTSEEING: 'sightseeing',
  FOOD: 'food',
  SHOPPING: 'shopping',
  ENTERTAINMENT: 'entertainment',
  ACCOMMODATION: 'accommodation',
  TRANSPORT: 'transport',
  BREAK: 'break',
  MEETING: 'meeting',
  OTHER: 'other'
} as const;

// 優先度レベル
export const PRIORITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
} as const;

// 移動手段
export const TRANSPORT_MODES = {
  WALKING: 'walking',
  CYCLING: 'cycling',
  CAR: 'car',
  TRAIN: 'train',
  BUS: 'bus',
  SUBWAY: 'subway',
  TAXI: 'taxi',
  AIRPLANE: 'airplane',
  FERRY: 'ferry'
} as const;

// 最適化タイプ
export const OPTIMIZATION_TYPES = {
  TIME_EFFICIENT: 'time_efficient',
  COST_EFFECTIVE: 'cost_effective',
  BALANCED: 'balanced',
  SHORTEST_DISTANCE: 'shortest_distance',
  LEAST_TRANSFERS: 'least_transfers'
} as const;

// アクセス権限
export const PERMISSIONS = {
  VIEW_ONLY: 'view_only',
  COMMENT: 'comment',
  EDIT: 'edit',
  ADMIN: 'admin'
} as const;

// 通知タイプ
export const NOTIFICATION_TYPES = {
  PLAN_UPDATE: 'plan_update',
  COLLABORATION_INVITE: 'collaboration_invite',
  OPTIMIZATION_COMPLETE: 'optimization_complete',
  SYSTEM_MAINTENANCE: 'system_maintenance',
  SECURITY_ALERT: 'security_alert',
  FEATURE_ANNOUNCEMENT: 'feature_announcement'
} as const;

// ストレージキー
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'travelcanvas_auth',
  GUEST_TOKEN: 'travelcanvas_guest',
  USER_PREFERENCES: 'travelcanvas_preferences',
  CACHED_PLANS: 'travelcanvas_cached_plans',
  RECENT_SEARCHES: 'travelcanvas_recent_searches',
  UI_STATE: 'travelcanvas_ui_state',
  OFFLINE_QUEUE: 'travelcanvas_offline_queue',
  ERROR_LOGS: 'travelcanvas_errors',
  ANALYTICS_OPT_OUT: 'travelcanvas_analytics_opt_out'
} as const;

// UI設定
export const UI_CONFIG = {
  // ページネーション
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  
  // 検索
  SEARCH_DEBOUNCE_MS: 300,
  MIN_SEARCH_LENGTH: 2,
  MAX_SEARCH_RESULTS: 50,
  
  // アニメーション
  ANIMATION_DURATION_MS: 300,
  TOAST_DURATION_MS: 4000,
  MODAL_TRANSITION_MS: 200,
  
  // ファイルアップロード
  MAX_IMAGE_SIZE_MB: 10,
  MAX_IMAGES_COUNT: 20,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  
  // 音声録音
  MAX_VOICE_DURATION_SEC: 60,
  VOICE_SAMPLE_RATE: 16000,
  
  // 地図
  DEFAULT_MAP_ZOOM: 13,
  MAX_MAP_ZOOM: 20,
  MIN_MAP_ZOOM: 5,
  
  // ドラッグ&ドロップ
  DRAG_THRESHOLD_PX: 5,
  DRAG_SCROLL_SPEED: 10,
  
  // レスポンシブブレークポイント
  BREAKPOINTS: {
    SM: 640,
    MD: 768,
    LG: 1024,
    XL: 1280,
    '2XL': 1536
  }
} as const;

// アイコンマッピング
export const CATEGORY_ICONS = {
  [ITEM_CATEGORIES.SIGHTSEEING]: '🏛️',
  [ITEM_CATEGORIES.FOOD]: '🍽️',
  [ITEM_CATEGORIES.SHOPPING]: '🛍️',
  [ITEM_CATEGORIES.ENTERTAINMENT]: '🎭',
  [ITEM_CATEGORIES.ACCOMMODATION]: '🏨',
  [ITEM_CATEGORIES.TRANSPORT]: '🚃',
  [ITEM_CATEGORIES.BREAK]: '☕',
  [ITEM_CATEGORIES.MEETING]: '👥',
  [ITEM_CATEGORIES.OTHER]: '📍'
} as const;

export const TRANSPORT_ICONS = {
  [TRANSPORT_MODES.WALKING]: '🚶',
  [TRANSPORT_MODES.CYCLING]: '🚴',
  [TRANSPORT_MODES.CAR]: '🚗',
  [TRANSPORT_MODES.TRAIN]: '🚃',
  [TRANSPORT_MODES.BUS]: '🚌',
  [TRANSPORT_MODES.SUBWAY]: '🚇',
  [TRANSPORT_MODES.TAXI]: '🚕',
  [TRANSPORT_MODES.AIRPLANE]: '✈️',
  [TRANSPORT_MODES.FERRY]: '⛴️'
} as const;

export const PRIORITY_ICONS = {
  [PRIORITY_LEVELS.LOW]: '🔵',
  [PRIORITY_LEVELS.MEDIUM]: '🟡',
  [PRIORITY_LEVELS.HIGH]: '🟠',
  [PRIORITY_LEVELS.CRITICAL]: '🔴'
} as const;

// カラーパレット
export const COLORS = {
  PRIMARY: '#2563EB',
  SECONDARY: '#F97316',
  SUCCESS: '#10B981',
  WARNING: '#F59E0B',
  ERROR: '#EF4444',
  INFO: '#06B6D4',
  
  GRAY: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827'
  },
  
  CATEGORY_COLORS: {
    [ITEM_CATEGORIES.SIGHTSEEING]: '#3B82F6',
    [ITEM_CATEGORIES.FOOD]: '#EF4444',
    [ITEM_CATEGORIES.SHOPPING]: '#8B5CF6',
    [ITEM_CATEGORIES.ENTERTAINMENT]: '#F59E0B',
    [ITEM_CATEGORIES.ACCOMMODATION]: '#10B981',
    [ITEM_CATEGORIES.TRANSPORT]: '#6B7280',
    [ITEM_CATEGORIES.BREAK]: '#84CC16',
    [ITEM_CATEGORIES.MEETING]: '#EC4899',
    [ITEM_CATEGORIES.OTHER]: '#64748B'
  }
} as const;

// バリデーションルール
export const VALIDATION_RULES = {
  EMAIL: {
    PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    MAX_LENGTH: 254
  },
  
  PASSWORD: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 128,
    REQUIRE_UPPERCASE: true,
    REQUIRE_LOWERCASE: true,
    REQUIRE_NUMBER: true,
    REQUIRE_SPECIAL: false
  },
  
  USERNAME: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 30,
    PATTERN: /^[a-zA-Z0-9_-]+$/
  },
  
  PLAN_TITLE: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 100
  },
  
  PLAN_DESCRIPTION: {
    MAX_LENGTH: 1000
  },
  
  ITEM_TITLE: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 200
  },
  
  ITEM_NOTES: {
    MAX_LENGTH: 2000
  }
} as const;

// エラーメッセージ
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'ネットワークエラーが発生しました。接続を確認してください。',
  UNAUTHORIZED: 'ログインが必要です。',
  FORBIDDEN: 'この操作を実行する権限がありません。',
  NOT_FOUND: 'リソースが見つかりません。',
  VALIDATION_ERROR: '入力内容に誤りがあります。',
  SERVER_ERROR: 'サーバーエラーが発生しました。しばらく時間をおいてから再試行してください。',
  TIMEOUT_ERROR: 'リクエストがタイムアウトしました。',
  
  // フィールド固有
  EMAIL_INVALID: 'メールアドレスの形式が正しくありません。',
  EMAIL_REQUIRED: 'メールアドレスは必須です。',
  PASSWORD_TOO_SHORT: `パスワードは${VALIDATION_RULES.PASSWORD.MIN_LENGTH}文字以上で入力してください。`,
  PASSWORD_TOO_WEAK: 'パスワードは大文字、小文字、数字を含む必要があります。',
  USERNAME_INVALID: 'ユーザー名は3-30文字の英数字、ハイフン、アンダースコアのみ使用できます。',
  TITLE_REQUIRED: 'タイトルは必須です。',
  TITLE_TOO_LONG: `タイトルは${VALIDATION_RULES.PLAN_TITLE.MAX_LENGTH}文字以内で入力してください。`
} as const;

// 成功メッセージ
export const SUCCESS_MESSAGES = {
  LOGIN_SUCCESS: 'ログインしました。',
  LOGOUT_SUCCESS: 'ログアウトしました。',
  REGISTER_SUCCESS: 'アカウントを作成しました。',
  PASSWORD_CHANGED: 'パスワードを変更しました。',
  EMAIL_VERIFIED: 'メールアドレスを確認しました。',
  PLAN_CREATED: 'プランを作成しました。',
  PLAN_UPDATED: 'プランを更新しました。',
  PLAN_DELETED: 'プランを削除しました。',
  PLAN_SHARED: 'プランを共有しました。',
  OPTIMIZATION_STARTED: '最適化を開始しました。',
  OPTIMIZATION_COMPLETE: '最適化が完了しました。',
  DATA_SAVED: 'データを保存しました。',
  SETTINGS_UPDATED: '設定を更新しました。'
} as const;

// 機能制限（ユーザータイプ別）
export const FEATURE_LIMITS = {
  [USER_TYPES.GUEST]: {
    MAX_PLANS: 3,
    MAX_ITEMS_PER_PLAN: 20,
    MAX_DAYS_PER_PLAN: 3,
    MAX_OPTIMIZATIONS_PER_HOUR: 2,
    MAX_AI_SEARCHES_PER_HOUR: 10,
    MAX_IMAGE_SEARCHES_PER_HOUR: 5,
    CAN_SHARE: true,
    CAN_COLLABORATE: false,
    CAN_EXPORT: false,
    CAN_BACKUP: false
  },
  
  [USER_TYPES.REGISTERED]: {
    MAX_PLANS: 50,
    MAX_ITEMS_PER_PLAN: 100,
    MAX_DAYS_PER_PLAN: 14,
    MAX_OPTIMIZATIONS_PER_HOUR: 10,
    MAX_AI_SEARCHES_PER_HOUR: 100,
    MAX_IMAGE_SEARCHES_PER_HOUR: 30,
    CAN_SHARE: true,
    CAN_COLLABORATE: true,
    CAN_EXPORT: true,
    CAN_BACKUP: true
  },
  
  [USER_TYPES.PREMIUM]: {
    MAX_PLANS: 200,
    MAX_ITEMS_PER_PLAN: 500,
    MAX_DAYS_PER_PLAN: 30,
    MAX_OPTIMIZATIONS_PER_HOUR: 50,
    MAX_AI_SEARCHES_PER_HOUR: 500,
    MAX_IMAGE_SEARCHES_PER_HOUR: 100,
    CAN_SHARE: true,
    CAN_COLLABORATE: true,
    CAN_EXPORT: true,
    CAN_BACKUP: true
  },
  
  [USER_TYPES.ADMIN]: {
    MAX_PLANS: Infinity,
    MAX_ITEMS_PER_PLAN: Infinity,
    MAX_DAYS_PER_PLAN: Infinity,
    MAX_OPTIMIZATIONS_PER_HOUR: Infinity,
    MAX_AI_SEARCHES_PER_HOUR: Infinity,
    MAX_IMAGE_SEARCHES_PER_HOUR: Infinity,
    CAN_SHARE: true,
    CAN_COLLABORATE: true,
    CAN_EXPORT: true,
    CAN_BACKUP: true
  }
} as const;

// デフォルト設定
export const DEFAULT_SETTINGS = {
  LANGUAGE: 'ja',
  TIMEZONE: 'Asia/Tokyo',
  CURRENCY: 'JPY',
  DATE_FORMAT: 'YYYY/MM/DD',
  TIME_FORMAT: '24h',
  THEME: 'light',
  
  NOTIFICATIONS: {
    EMAIL_ENABLED: true,
    PUSH_ENABLED: true,
    PLAN_UPDATES: true,
    COLLABORATION_INVITES: true,
    OPTIMIZATION_COMPLETE: true,
    SYSTEM_MAINTENANCE: false
  },
  
  MAP: {
    DEFAULT_ZOOM: 13,
    SHOW_TRAFFIC: false,
    SHOW_TRANSIT: true,
    SHOW_SATELLITE: false
  },
  
  AI: {
    AUTO_SUGGESTIONS: true,
    VOICE_SEARCH_ENABLED: true,
    IMAGE_SEARCH_ENABLED: true,
    AUTO_OPTIMIZATION: false
  }
} as const;

// キーボードショートカット
export const KEYBOARD_SHORTCUTS = {
  SAVE: 'Ctrl+S',
  NEW_PLAN: 'Ctrl+N',
  SEARCH: 'Ctrl+K',
  HELP: '?',
  CLOSE_MODAL: 'Escape',
  NAVIGATE_UP: 'ArrowUp',
  NAVIGATE_DOWN: 'ArrowDown',
  SELECT: 'Enter',
  DELETE: 'Delete',
  UNDO: 'Ctrl+Z',
  REDO: 'Ctrl+Y'
} as const;

// 正規表現パターン
export const REGEX_PATTERNS = {
  EMAIL: VALIDATION_RULES.EMAIL.PATTERN,
  USERNAME: VALIDATION_RULES.USERNAME.PATTERN,
  PASSWORD_STRENGTH: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
  PHONE_NUMBER: /^\+?[1-9]\d{1,14}$/,
  URL: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
  JAPANESE_POSTAL_CODE: /^\d{3}-\d{4}$/,
  LATITUDE: /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)$/,
  LONGITUDE: /^[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/
} as const;