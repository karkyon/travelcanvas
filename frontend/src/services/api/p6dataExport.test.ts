/**
 * [Gate P6] データポータビリティ(FR-039)APIのクライアント。URL・Blob応答・ファイル名とハッシュの読み取り、
 * 保持期間の説明のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, downloadAccountDataExport, downloadPlanDataExport, getRetentionInfo } from './index';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
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

  it('[監査 2026-11-23] 失敗の本文(Blob の JSON)を読み直し、画面にサーバーの説明(回数の上限など)を出せる', async () => {
    const body = new Blob([JSON.stringify({ detail: { code: 'export_rate_limited', message: '書き出しが続いています' } })],
      { type: 'application/json' });
    api.setHttpClientForTesting({
      get: async () => { throw Object.assign(new Error('429'), { response: { status: 429, data: body } }); },
    } as Partial<MinimalHttpClient>);
    const err = await downloadAccountDataExport().catch((e: unknown) => e);
    expect((err as { response: { data: unknown } }).response.data).toEqual(
      { detail: { code: 'export_rate_limited', message: '書き出しが続いています' } });
    expect(errorDetailMessage(err, '失敗')).toContain('書き出しが続いています');
    // JSON でない本文はそのまま(落ちない)
    const html = new Blob(['<html>'], { type: 'text/html' });
    api.setHttpClientForTesting({
      get: async () => { throw Object.assign(new Error('502'), { response: { status: 502, data: html } }); },
    } as Partial<MinimalHttpClient>);
    const err2 = await downloadPlanDataExport('p1').catch((e: unknown) => e);
    expect((err2 as { response: { data: unknown } }).response.data).toBe(html);
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
