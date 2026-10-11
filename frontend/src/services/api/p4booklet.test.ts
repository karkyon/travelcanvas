/**
 * [Gate P4] しおり・印刷(FR-034/035/046)APIのクライアント。送信内容(URL・メソッド・設定)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, createBookletExport, getBookletExport, getBookletExports, previewBooklet, revokeBookletExport,
} from './index';
import type { BookletOptions, MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET' || method === 'DELETE') calls.push({ url, method, config: a as AxiosRequestConfig | undefined });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({
    get: push('GET'), post: push('POST'), put: push('PUT'), patch: push('PATCH'), delete: push('DELETE'),
  } as Partial<MinimalHttpClient>);
  return calls;
}

const OPTIONS: BookletOptions = {
  theme: 'mono', density: 'compact', format: 'print', sections: ['cover', 'schedule'],
  includes: { confirmation_numbers: false, addresses: true, phones: false, participants: false },
};

describe('しおり・印刷APIクライアント (Gate P4)', () => {
  it('プレビューは設定をそのままPOSTし、保存しない', async () => {
    const calls = respondWith(fx.booklet_preview);
    const b = await previewBooklet('p1', OPTIONS);
    expect(calls[0]).toEqual({ url: '/plans/p1/booklet/preview', method: 'POST', data: OPTIONS, config: undefined });
    expect(b.policy_version).toBe('booklet-v1');
  });

  it('版の作成・一覧・表示・失効', async () => {
    let calls = respondWith(fx.booklet_export_sensitive);
    const created = await createBookletExport('p1', { ...OPTIONS, valid_until: '2026-12-31T14:59:59Z' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/booklet-exports', method: 'POST', data: { valid_until: '2026-12-31T14:59:59Z' } });
    expect(created.export.contains_sensitive).toBe(true);
    calls = respondWith(fx.booklet_export_list);
    await expect(getBookletExports('p1')).resolves.toHaveLength(3);
    expect(calls[0]).toEqual({ url: '/plans/p1/booklet-exports', method: 'GET', config: undefined });
    calls = respondWith(fx.booklet_export_stale);
    const stale = await getBookletExport('p1', 'e1');
    expect(calls[0]?.url).toBe('/plans/p1/booklet-exports/e1');
    expect(stale.booklet.is_stale).toBe(true);
    calls = respondWith(fx.booklet_export_revoked);
    const revoked = await revokeBookletExport('p1', 'e2');
    expect(calls[0]).toEqual({ url: '/plans/p1/booklet-exports/e2', method: 'DELETE', config: undefined });
    expect(revoked.state).toBe('revoked');
  });

  it('実応答: 既定は予約番号を伏せ、住所・電話・参加者名を含まない。機密を含めた応答だけ全桁', () => {
    const b = fx.booklet_preview;
    expect(b.contains_sensitive).toBe(false);
    expect(b.reservations?.[0]).toMatchObject({ confirmation: '******4567', confirmation_is_full: false, contact_phone: null });
    expect(b.schedule?.days[0]?.events.every((e) => e.address === null)).toBe(true);
    expect(b.contacts).toMatchObject({ members: null, reservation_contacts: null });
    expect(JSON.stringify(b)).not.toContain('QR-SECRET');
    const s = fx.booklet_preview_sensitive;
    expect(s.reservations?.[0]).toMatchObject({ confirmation: 'ABC1234567', confirmation_is_full: true });
    expect(s.warnings).toContain('contains_sensitive');
    expect(fx.booklet_export_sensitive.export.watermark_text).toMatch(/専用・持出注意$/);
    expect(fx.booklet_export_list_editor.map((x) => x.can_view)).toEqual([false, false, true]);
  });

  it('機密を含むかどうか・状態の形式が崩れた応答は拒否する(透かしなしで印刷させない)', async () => {
    respondWith({ ...fx.booklet_preview, contains_sensitive: 'no' });
    await expect(previewBooklet('p1', OPTIONS)).rejects.toThrow(/contains_sensitive/);
    respondWith([{ ...fx.booklet_export_list[0], state: 'deleted' }]);
    await expect(getBookletExports('p1')).rejects.toThrow(/\$\[0\]\.state/);
    respondWith({ ...fx.booklet_preview, warnings: ['unknown_warning'] });
    await expect(previewBooklet('p1', OPTIONS)).rejects.toThrow(/warnings/);
  });
});
