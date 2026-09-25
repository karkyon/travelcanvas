/**
 * [Gate M9-FE-C3] chunk読込失敗の判定と、再読込ループにならない1回限りの自動再読込。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  claimChunkReload,
  isChunkLoadError,
  loadWithChunkRecovery,
} from './lazyPage';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/PlannerPage-abc.js');

describe('isChunkLoadError (Gate M9-FE-C3)', () => {
  it('主要ブラウザのchunk読込失敗メッセージを判定する', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 123 failed.'))).toBe(true);
  });

  it('無関係なエラーはchunk読込失敗と判定しない', () => {
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({ status: 500 })).toBe(false);
  });
});

describe('claimChunkReload (Gate M9-FE-C3)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('初回は許可し、一定時間内の2回目は拒否し、時間経過後は再び許可する', () => {
    expect(claimChunkReload(1_000_000)).toBe(true);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBe('1000000');
    expect(claimChunkReload(1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(claimChunkReload(1_000_000 + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(true);
  });

  it('sessionStorageが使えない環境では自動再読込しない', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(claimChunkReload()).toBe(false);
    spy.mockRestore();
  });
});

describe('loadWithChunkRecovery (Gate M9-FE-C3)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('成功時はそのままモジュールを返し、再読込しない', async () => {
    const reload = vi.fn();
    await expect(loadWithChunkRecovery(async () => ({ default: 'ok' }), reload)).resolves.toEqual({ default: 'ok' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('chunk読込失敗の初回は1回だけ再読込し、Promiseは解決しないまま待つ', async () => {
    const reload = vi.fn();
    let settled = false;
    loadWithChunkRecovery(() => Promise.reject(chunkError()), reload).then(
      () => (settled = true),
      () => (settled = true)
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
  });

  it('直後に再び失敗した場合は再読込せず例外を投げる(再読込ループ防止)', async () => {
    const reload = vi.fn();
    loadWithChunkRecovery(() => Promise.reject(chunkError()), reload);
    await new Promise((r) => setTimeout(r, 10));
    await expect(loadWithChunkRecovery(() => Promise.reject(chunkError()), reload)).rejects.toThrow(
      /dynamically imported module/
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('chunk以外の失敗は再読込せず例外を投げる', async () => {
    const reload = vi.fn();
    await expect(loadWithChunkRecovery(() => Promise.reject(new Error('boom')), reload)).rejects.toThrow('boom');
    expect(reload).not.toHaveBeenCalled();
  });
});
