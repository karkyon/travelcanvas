/** [Gate TDay-Push] 端末への通知(ブラウザ側の小さな計算)。購読そのものは実機・https でしか試せない */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { deviceLabel, keyBytes, pushSupport } from './push';

vi.mock('./index', () => ({ api: {} }));

describe('push', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('送り手の公開鍵(URL 安全な base64)をバイト列にする', () => {
    expect(Array.from(keyBytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
  it('端末の名前(送り先・鍵は出さない)', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/130.0 Mobile Safari/537.36')).toBe('Android Chrome');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1'))
      .toBe('iPhone Safari');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130 Safari/537.36 Edg/130')).toBe('Windows Edge');
  });
  it('http の画面では使えない', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(pushSupport()).toBe('insecure');
  });
});
