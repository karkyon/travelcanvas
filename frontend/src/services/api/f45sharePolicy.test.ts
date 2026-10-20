/**
 * [Gate F45] FR-045 項目単位の共有の規則: 共有前プレビュー2メソッドと、発行で送る項目の指定。
 * 応答は実backendから採取した fixture(share_preview*・public_share_confidential)。
 */
import { describe, it, expect } from 'vitest';
import fx from './__fixtures__/backendContractResponses.json';
import { api } from './index';
import { ApiDecodeError } from './decode';

describe('共有前プレビュー (Gate F45)', () => {
  it('発行前: POST /travel-plans/{id}/share-preview に項目を送り、見える内容・見せない件数・項目の一覧を受け取る', async () => {
    const calls: Array<{ url: string; data: unknown }> = [];
    api.setHttpClientForTesting({
      post: async (url: string, data?: unknown) => {
        calls.push({ url, data });
        return { data: fx.share_preview };
      },
    });
    const res = await api.previewSharePolicy('p1', { fields: ['day_titles'], acknowledge_confidential: undefined });
    expect(calls).toEqual([{ url: '/travel-plans/p1/share-preview', data: { fields: ['day_titles'], acknowledge_confidential: undefined } }]);
    expect(res.withheld.confirmation_numbers).toBe(1);
    expect(res.catalog.fields.map((f) => f.key)).toEqual([
      'plan_description', 'day_titles', 'event_times', 'event_address', 'event_notes', 'reservation_summary',
    ]);
    expect(res.catalog.presets.all).not.toContain('event_address'); // 「すべて」でも機密は含めない
    expect(res.view.reservations).toBeUndefined();
  });

  it('発行後: GET /travel-plans/{id}/share/{share_id}/preview(使用回数を消費しない所有者の確認)', async () => {
    const urls: string[] = [];
    api.setHttpClientForTesting({
      get: async (url: string) => {
        urls.push(url);
        return { data: fx.share_preview_link };
      },
    });
    const res = await api.previewShareLink('p1', 's1');
    expect(urls).toEqual(['/travel-plans/p1/share/s1/preview']);
    expect(res.view.reservations?.[0]).toEqual({
      type: 'accommodation', provider_name: '祇園の宿 本館', status: 'confirmed', start: '2026-11-10 15:00', end: null,
    });
  });

  it('知らない項目名が来たら受理しない(backend と項目の一覧がずれたら気づく)', async () => {
    api.setHttpClientForTesting({ get: async () => ({ data: { ...fx.share_preview_link, fields: ['tickets'] } }) });
    await expect(api.previewShareLink('p1', 's1')).rejects.toBeInstanceOf(ApiDecodeError);
  });

  it('機密を選んだリンクの公開閲覧: 住所・メモ・予約の概要は届き、予約番号は届かない', () => {
    const text = JSON.stringify(fx.public_share_confidential);
    expect(fx.public_share_confidential.days[0]!.events[0]).toMatchObject({ address: '京都市東山区清水1', notes: '入口は仁王門' });
    expect(text).not.toContain('5678');
    expect(text).not.toContain('QZ-7781');
  });

  it('発行は項目と確認を一緒に送る', async () => {
    const calls: Array<{ url: string; data: unknown }> = [];
    api.setHttpClientForTesting({
      post: async (url: string, data?: unknown) => {
        calls.push({ url, data });
        return { data: fx.share_created_full };
      },
    });
    const res = await api.createShareLink('p1', { permission: 'view', fields: ['event_address'], acknowledge_confidential: true });
    expect(calls[0]).toEqual({ url: '/travel-plans/p1/share', data: { permission: 'view', fields: ['event_address'], acknowledge_confidential: true } });
    expect(res.data.fields).toEqual(['event_address', 'event_notes', 'reservation_summary']);
  });
});
