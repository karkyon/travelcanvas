import { describe, it, expect, vi } from 'vitest';
import { registerAppShell, shouldRegister } from './appShell';

describe('appShell (Gate Remaining-1)', () => {
  it('本番の組み立てで、自動操作でない時だけ登録する', () => {
    const nav = { serviceWorker: {} } as unknown as Navigator;
    expect(shouldRegister({ prod: false }, nav)).toBe(false);
    expect(shouldRegister({ prod: true }, nav)).toBe(true);
    expect(shouldRegister({ prod: true }, { ...nav, webdriver: true } as unknown as Navigator)).toBe(false);
    expect(shouldRegister({ prod: true }, {} as Navigator)).toBe(false);
  });

  it('通知と同じ Service Worker を範囲 / で登録する。失敗しても画面は続く', async () => {
    const register = vi.fn(async () => ({}));
    expect(await registerAppShell({ serviceWorker: { register } } as unknown as Navigator, true)).toBe(true);
    expect(register).toHaveBeenCalledWith('/tc-push-sw.js', { scope: '/' });
    const bad = vi.fn(async () => { throw new Error('x'); });
    expect(await registerAppShell({ serviceWorker: { register: bad } } as unknown as Navigator, true)).toBe(false);
  });
});
