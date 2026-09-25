/**
 * [Gate M9-FE-C3] ページ単位の遅延読込(React.lazy)と、chunk読込失敗時の回復。
 *
 * 新しいビルドをデプロイすると旧ビルドのchunkファイル(ハッシュ付きファイル名)は
 * 消えるため、デプロイ前から開いていたタブで未読込の画面へ遷移すると動的importが
 * 失敗する。その場合は1回だけページ全体を再読込して新しいビルドを取得する。
 * 再読込しても失敗する(本当にサーバーが落ちている等)場合に再読込を繰り返さない
 * よう、sessionStorageに再読込時刻を記録し、一定時間内の2回目以降は例外をそのまま
 * RouteErrorBoundaryへ渡す。sessionStorageが使えない環境では自動再読込しない。
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export const CHUNK_RELOAD_STORAGE_KEY = 'travelcanvas:chunk-reload-at';
export const CHUNK_RELOAD_WINDOW_MS = 10_000;

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : '';
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * chunk読込失敗時に自動再読込してよいかを判定し、よい場合は時刻を記録する。
 * 直近CHUNK_RELOAD_WINDOW_MS以内に再読込済みならfalse(再読込ループ防止)。
 */
export function claimChunkReload(now: number = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) ?? '');
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) {
      return false;
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * 動的importを実行し、chunk読込失敗なら(再読込ループにならない範囲で)1回だけ
 * ページ全体を再読込する。それ以外の失敗や2回目の失敗は例外をそのまま投げる。
 */
export function loadWithChunkRecovery<T>(
  factory: () => Promise<T>,
  reload: () => void = () => window.location.reload()
): Promise<T> {
  return factory().catch((error: unknown) => {
    if (isChunkLoadError(error) && claimChunkReload()) {
      reload();
      // 再読込が完了するまでSuspenseのfallback表示のまま待つ(解決しないPromise)。
      return new Promise<T>(() => {});
    }
    throw error;
  });
}

export function lazyPage<T extends ComponentType<object>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() => loadWithChunkRecovery(factory));
}
