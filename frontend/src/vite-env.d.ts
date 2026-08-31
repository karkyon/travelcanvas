/// <reference types="vite/client" />

interface ImportMetaEnv {
  // API Configuration
  readonly VITE_API_BASE_URL: string
  readonly VITE_API_TIMEOUT: string
  readonly VITE_WS_BASE_URL: string

  // External API Keys
  readonly VITE_GOOGLE_MAPS_API_KEY: string
  readonly VITE_MAPBOX_ACCESS_TOKEN: string

  // Firebase Configuration
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_VAPID_KEY: string

  // Analytics
  readonly VITE_GOOGLE_ANALYTICS_ID: string
  readonly VITE_MIXPANEL_TOKEN: string

  // Error Tracking
  readonly VITE_SENTRY_DSN: string

  // Feature Flags
  readonly VITE_ENABLE_AI_FEATURES: string
  readonly VITE_ENABLE_VOICE_SEARCH: string
  readonly VITE_ENABLE_IMAGE_RECOGNITION: string
  readonly VITE_ENABLE_REAL_TIME_SYNC: string
  readonly VITE_ENABLE_OFFLINE_MODE: string

  // Development Settings
  readonly VITE_DEBUG_MODE: string
  readonly VITE_LOG_LEVEL: string
  readonly VITE_MOCK_API: string

  // PWA Settings
  readonly VITE_APP_NAME: string
  readonly VITE_APP_SHORT_NAME: string
  readonly VITE_APP_DESCRIPTION: string
  readonly VITE_APP_THEME_COLOR: string
  readonly VITE_APP_BACKGROUND_COLOR: string

  // CDN & Assets
  readonly VITE_CDN_BASE_URL: string
  readonly VITE_ASSETS_BASE_URL: string

  // Rate Limiting
  readonly VITE_API_RATE_LIMIT_ENABLED: string
  readonly VITE_API_RATE_LIMIT_REQUESTS: string
  readonly VITE_API_RATE_LIMIT_WINDOW: string

  // Cache Settings
  readonly VITE_CACHE_ENABLED: string
  readonly VITE_CACHE_TTL: string

  // Localization
  readonly VITE_DEFAULT_LOCALE: string
  readonly VITE_SUPPORTED_LOCALES: string

  // Security
  readonly VITE_ENABLE_CSP: string
  readonly VITE_ENABLE_HTTPS_REDIRECT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Global type declarations
declare global {
  // Service Worker registration
  interface Window {
    workbox: any
  }

  // PWA Install Prompt
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }

  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[]
    readonly userChoice: Promise<{
      outcome: 'accepted' | 'dismissed'
      platform: string
    }>
    prompt(): Promise<void>
  }

  // Web Share API
  interface Navigator {
    share?: (data: ShareData) => Promise<void>
    canShare?: (data: ShareData) => boolean
  }

  interface ShareData {
    title?: string
    text?: string
    url?: string
    files?: File[]
  }

  // File System Access API
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  }

  // Background Sync
  interface ServiceWorkerRegistration {
    sync: SyncManager
  }

  interface SyncManager {
    register(tag: string): Promise<void>
    getTags(): Promise<string[]>
  }

  // Web Locks API
  interface Navigator {
    locks: LockManager
  }

  interface LockManager {
    request(name: string, callback: () => Promise<any>): Promise<any>
    request(name: string, options: LockOptions, callback: () => Promise<any>): Promise<any>
    query(): Promise<LockManagerSnapshot>
  }

  // Performance Observer Types
  interface PerformanceObserver {
    observe(options: PerformanceObserverInit): void
    disconnect(): void
    takeRecords(): PerformanceEntryList
  }

  // Intersection Observer Types
  interface IntersectionObserverEntry {
    readonly boundingClientRect: DOMRectReadOnly
    readonly intersectionRatio: number
    readonly intersectionRect: DOMRectReadOnly
    readonly isIntersecting: boolean
    readonly rootBounds: DOMRectReadOnly | null
    readonly target: Element
    readonly time: number
  }

  // Resize Observer Types
  interface ResizeObserverEntry {
    readonly target: Element
    readonly contentRect: DOMRectReadOnly
    readonly borderBoxSize?: readonly ResizeObserverSize[]
    readonly contentBoxSize?: readonly ResizeObserverSize[]
  }

  // Custom Error Types
  interface TravelCanvasError extends Error {
    code?: string
    context?: Record<string, any>
    timestamp?: string
  }

  // Analytics Types
  interface AnalyticsEvent {
    name: string
    properties?: Record<string, any>
    timestamp?: number
  }

  // AI API Types
  interface AISearchResult {
    id: string
    name: string
    description: string
    confidence: number
    location: {
      latitude: number
      longitude: number
    }
  }

  interface ImageRecognitionResult {
    objects: Array<{
      name: string
      confidence: number
      boundingBox: {
        x: number
        y: number
        width: number
        height: number
      }
    }>
    spots: AISearchResult[]
  }

  // Map Types
  interface MapLocation {
    latitude: number
    longitude: number
    address?: string
    name?: string
  }

  // Voice API Types
  interface VoiceSearchResult {
    transcript: string
    confidence: number
    spots: AISearchResult[]
  }

  // WebSocket Message Types
  interface WSMessage {
    type: string
    payload: any
    timestamp: string
    userId?: string
  }

  // Drag & Drop Types
  interface DragDropEvent extends DragEvent {
    dataTransfer: DataTransfer & {
      effectAllowed: 'none' | 'copy' | 'copyLink' | 'copyMove' | 'link' | 'linkMove' | 'move' | 'all' | 'uninitialized'
      dropEffect: 'none' | 'copy' | 'link' | 'move'
    }
  }

  // PWA Types
  interface PWAInstallPrompt {
    prompt(): Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }

  // Notification Types
  interface NotificationOptions {
    badge?: string
    body?: string
    data?: any
    dir?: NotificationDirection
    icon?: string
    image?: string
    lang?: string
    renotify?: boolean
    requireInteraction?: boolean
    silent?: boolean
    tag?: string
    timestamp?: number
    vibrate?: VibratePattern
    actions?: NotificationAction[]
  }

  // Cache API Types
  interface CacheQueryOptions {
    ignoreMethod?: boolean
    ignoreSearch?: boolean
    ignoreVary?: boolean
  }

  // Feature Detection
  interface NavigatorExtended extends Navigator {
    deviceMemory?: number
    connection?: {
      effectiveType: '4g' | '3g' | '2g' | 'slow-2g'
      downlink: number
      rtt: number
      saveData: boolean
    }
  }
}

// Module declarations for assets
declare module '*.svg' {
  const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.jpg' {
  const content: string
  export default content
}

declare module '*.jpeg' {
  const content: string
  export default content
}

declare module '*.gif' {
  const content: string
  export default content
}

declare module '*.webp' {
  const content: string
  export default content
}

declare module '*.ico' {
  const content: string
  export default content
}

declare module '*.bmp' {
  const content: string
  export default content
}

declare module '*.css' {
  const content: Record<string, string>
  export default content
}

declare module '*.scss' {
  const content: Record<string, string>
  export default content
}

declare module '*.sass' {
  const content: Record<string, string>
  export default content
}

declare module '*.less' {
  const content: Record<string, string>
  export default content
}

declare module '*.module.css' {
  const content: Record<string, string>
  export default content
}

declare module '*.module.scss' {
  const content: Record<string, string>
  export default content
}

declare module '*.module.sass' {
  const content: Record<string, string>
  export default content
}

declare module '*.module.less' {
  const content: Record<string, string>
  export default content
}

// Worker modules
declare module '*.worker.ts' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module '*.worker.js' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

// JSON modules
declare module '*.json' {
  const content: any
  export default content
}

// Text files
declare module '*.txt' {
  const content: string
  export default content
}

declare module '*.md' {
  const content: string
  export default content
}

// WebAssembly
declare module '*.wasm' {
  const content: WebAssembly.Module
  export default content
}

export {}