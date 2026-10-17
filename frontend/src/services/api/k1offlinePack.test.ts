/**
 * [Gate K1] オフラインパックの鍵(B-008)APIのクライアント。送信内容(If-Match・共通エラー処理を通さない指定)と
 * 応答の decoder 検証(鍵は43文字の base64url、256ビット)を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, getOfflinePackKey, rotateOfflinePackKey } from './index';
import { decodeResponse } from './decode';
import { offlinePackKey } from './decoders';
import type { MinimalHttpClient } from './types';
import { base64UrlToBytes } from '@/utils/offlineVault';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ get: push('GET'), post: push('POST') } as Partial<MinimalHttpClient>);
  return calls;
}

describe('オフラインパックの鍵 APIクライアント (Gate K1)', () => {
  it('鍵の取得と失効(If-Match に今の版)。どちらも共通エラー処理を通さない', async () => {
    let calls = respondWith(fx.offline_pack_key);
    const key = await getOfflinePackKey();
    expect(calls[0]).toMatchObject({ url: '/offline-pack/key', config: { skipGlobalErrorHandler: true } });
    expect(key.key_version).toBe(1);
    expect(base64UrlToBytes(key.key)).toHaveLength(32);
    calls = respondWith(fx.offline_pack_key_rotated);
    const rotated = await rotateOfflinePackKey(1);
    expect(calls[0]).toMatchObject({
      url: '/offline-pack/key/rotate', config: { skipGlobalErrorHandler: true, headers: { 'If-Match': '1' } },
    });
    expect(rotated).toMatchObject({ previous_version: 1, key_version: 2 });
    expect(rotated.key).not.toBe(key.key);
  });

  it('鍵の形を厳密に検査する(長さ・文字・ビット数・方式)', () => {
    const bad = (patch: Record<string, unknown>) => () => decodeResponse({ ...fx.offline_pack_key, ...patch }, offlinePackKey, 'x');
    expect(bad({ key: 'short' })).toThrow(/\$\.key/);
    expect(bad({ key: `${fx.offline_pack_key.key.slice(0, 42)}+` })).toThrow(/\$\.key/);
    expect(bad({ key_bits: 128 })).toThrow(/\$\.key_bits/);
    expect(bad({ algorithm: 'AES-128-CBC' })).toThrow(/\$\.algorithm/);
  });

  it('base64url の自前デコーダは標準の結果と一致し、壊れた入力を拒否する', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
    const encoded = Buffer.from(bytes).toString('base64url');
    expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
    expect(Array.from(base64UrlToBytes('AQID'))).toEqual([1, 2, 3]);
    expect(() => base64UrlToBytes('A+B/')).toThrow();
    expect(() => base64UrlToBytes('A')).toThrow();
  });
});
