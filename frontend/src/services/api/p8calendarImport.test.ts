/**
 * [Gate P8] カレンダー(ICS)取込(FR-036)APIのクライアント。送信内容(multipart・If-Match)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, applyCalendarImport, previewCalendarImport } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ post: push('POST') } as Partial<MinimalHttpClient>);
  return calls;
}

describe('カレンダー取込APIクライアント (Gate P8)', () => {
  it('プレビューはファイルと日程追加の選択をmultipartで送り、Content-Typeはboundary付きで付けさせる', async () => {
    const calls = respondWith(fx.calendar_import_preview);
    const file = new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' });
    const p = await previewCalendarImport('p1', file, true);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/calendar-import/preview', method: 'POST',
      config: { headers: { 'Content-Type': undefined } } });
    const form = calls[0]?.data as FormData;
    expect(form.get('create_missing_days')).toBe('true');
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(p.candidates.length).toBe(p.summary.total);
    expect(p.candidates.some((c) => c.action === 'skip' && c.reason !== null)).toBe(true);
  });

  it('適用は確認した時点の本案revisionをIf-Matchで送る', async () => {
    const calls = respondWith(fx.calendar_import_applied);
    const item = { action: 'create' as const, title: 'a', local_date: '2026-11-01', local_start_time: null, is_all_day: true, address: null };
    const r = await applyCalendarImport('p1', [item], false, 9);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/calendar-import/apply', method: 'POST',
      data: { items: [item], create_missing_days: false }, config: { headers: { 'If-Match': '9' } } });
    expect(r.plan_revision).toBeGreaterThan(0);
  });

  it('取り込み案の操作・理由の形式が崩れた応答は拒否する', async () => {
    const bad = (c: Record<string, unknown>) => ({ ...fx.calendar_import_preview, candidates: [{ ...fx.calendar_import_preview.candidates[0], ...c }] });
    respondWith(bad({ action: 'merge' }));
    await expect(previewCalendarImport('p1', new Blob(['x']), false)).rejects.toThrow(/candidates\[0\]\.action/);
    respondWith(bad({ reason: 'whatever' }));
    await expect(previewCalendarImport('p1', new Blob(['x']), false)).rejects.toThrow(/candidates\[0\]\.reason/);
  });
});
