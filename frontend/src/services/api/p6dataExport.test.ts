/**
 * [Gate P6] データポータビリティ(FR-039)APIのクライアント。URL・Blob応答・ファイル名とハッシュの読み取り、
 * 保持期間の説明のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, downloadAccountDataExport, downloadPlanDataExport, getRetentionInfo } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; config?: AxiosRequestConfig };
const SHA = 'a'.repeat(64);

function respondWith(data: unknown, headers?: Record<string, string>): Call[] {
  const calls: Call[] = [];
  api.setHttpClientForTesting({
    get: async (url: string, config?: AxiosRequestConfig) => {
      calls.push({ url, config });
      return { data, headers } as { data: unknown };
    },
  } as Partial<MinimalHttpClient>);
  return calls;
}

describe('データポータビリティAPIクライアント (Gate P6)', () => {
  it('旅行・アカウントのエクスポートはBlobで受け取り、ファイル名とハッシュを読む', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    let calls = respondWith(blob, {
      'content-disposition': 'attachment; filename="travelcanvas-plan-20261011.json"; filename*=UTF-8\'\'x', 'x-content-sha256': SHA,
    });
    await expect(downloadPlanDataExport('p1')).resolves.toEqual({ blob, filename: 'travelcanvas-plan-20261011.json', sha256: SHA });
    expect(calls[0]).toEqual({ url: '/plans/p1/data-export', config: { responseType: 'blob' } });
    calls = respondWith(blob, { 'x-content-sha256': 'not-a-hash' });
    await expect(downloadAccountDataExport()).resolves.toEqual({ blob, filename: 'travelcanvas-account.json', sha256: null });
    expect(calls[0]?.url).toBe('/privacy/data-export');
    respondWith({ detail: 'x' });
    await expect(downloadAccountDataExport()).rejects.toThrow(/ファイルではありません/);
  });

  it('保持期間の説明: 実応答を受理し、未知の項目や負の日数は拒否する', async () => {
    respondWith(fx.retention_info);
    const r = await getRetentionInfo();
    expect(r.items.map((i) => i.key)).toEqual(['deleted_plan', 'quick_draft', 'documents', 'audit', 'backup', 'exported']);
    respondWith({ ...fx.retention_info, plan_delete_grace_days: -1 });
    await expect(getRetentionInfo()).rejects.toThrow(/plan_delete_grace_days/);
    respondWith({ ...fx.retention_info, items: [{ ...fx.retention_info.items[0], key: 'forever' }] });
    await expect(getRetentionInfo()).rejects.toThrow(/items\[0\]\.key/);
  });
});
