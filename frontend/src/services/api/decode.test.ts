/**
 * [Gate M9-FE-C2b] APIレスポンス実行時検証(decode.ts)と、危険度の高い応答への適用。
 */
import { describe, it, expect } from 'vitest';
import {
  ApiDecodeError,
  arrayOf,
  bool,
  decodeResponse,
  int,
  nullable,
  num,
  object,
  optional,
  str,
} from './decode';
import { api } from './index';
import type { MinimalHttpClient } from './types';

describe('decode combinators (Gate M9-FE-C2b)', () => {
  interface Sample {
    id: string;
    count: number;
    ratio: number;
    active: boolean;
    note: string | null;
    tags: string[];
    extra?: string;
  }
  const sample = object<Sample>({
    id: str,
    count: int,
    ratio: num,
    active: bool,
    note: nullable(str),
    tags: arrayOf(str),
    extra: optional(str),
  });

  it('正しい形状はそのまま通し、宣言外のキーも保持する', () => {
    const input = { id: 'a', count: 2, ratio: 0.5, active: true, note: null, tags: ['x'], future_field: 1 };
    expect(decodeResponse(input, sample, 'GET /x')).toEqual(input);
  });

  it('型違い・欠落は位置と期待型を含むApiDecodeErrorになる', () => {
    const bad = { id: 'a', count: '2', ratio: 0.5, active: true, note: null, tags: [] };
    try {
      decodeResponse(bad, sample, 'GET /x');
      throw new Error('should not reach');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiDecodeError);
      const e = error as ApiDecodeError;
      expect(e.endpoint).toBe('GET /x');
      expect(e.path).toBe('$.count');
      expect(e.expected).toBe('整数');
      expect(e.message).toContain('GET /x');
    }
    expect(() => decodeResponse({ ...bad, count: 2, tags: [1] }, sample, 'GET /x')).toThrow(/\$\.tags\[0\]/);
    expect(() => decodeResponse({ count: 2 }, sample, 'GET /x')).toThrow(/\$\.id/);
  });

  it('nullableとoptionalを区別する(optionalはnullを許さない)', () => {
    expect(() => decodeResponse({ id: 'a', count: 1, ratio: 1, active: false, note: null, tags: [], extra: null },
      sample, 'GET /x')).toThrow(/\$\.extra/);
  });

  it('非有限の数値・配列でない値・オブジェクトでない値を拒否する', () => {
    expect(() => decodeResponse(Number.NaN, num, 'X')).toThrow(ApiDecodeError);
    expect(() => decodeResponse({}, arrayOf(str), 'X')).toThrow(ApiDecodeError);
    expect(() => decodeResponse([], sample, 'X')).toThrow(ApiDecodeError);
    expect(() => decodeResponse(null, sample, 'X')).toThrow(ApiDecodeError);
  });
});

/** 固定の応答を返すテスト用HTTPクライアントを差し替える。 */
function respondWith(data: unknown): void {
  const reply = async () => ({ data });
  const client: Partial<MinimalHttpClient> = { get: reply, post: reply, put: reply, delete: reply };
  api.setHttpClientForTesting(client);
}

const todayEvent = {
  id: 'e1', title: '清水寺', event_type: 'sightseeing', start_at: '2026-10-01T09:00:00+09:00', end_at: null,
  local_start_time: '09:00', address: '京都市', latitude: 34.99, longitude: 135.78, has_ticket: false,
  reservation_id: null, time_source: 'start_at', departure_at: null, transport_mode: null, transport_status: null,
};

describe('危険度の高い応答のdecoder適用 (Gate M9-FE-C2b)', () => {
  it('revisionを返す削除・Undoは、revisionが整数でなければ例外にする', async () => {
    respondWith({ message: '日程を削除しました', revision: 7 });
    await expect(api.deleteDay('p', 'd', 6)).resolves.toMatchObject({ revision: 7 });
    await expect(api.deleteEvent('p', 'e', 6)).resolves.toMatchObject({ revision: 7 });
    await expect(api.undoLastPlanChange('p', 6)).resolves.toMatchObject({ revision: 7 });
    await expect(api.deleteSegment('p', 's', 6)).resolves.toMatchObject({ revision: 7 });
    await expect(api.deleteRouteOption('p', 'o', 6)).resolves.toMatchObject({ revision: 7 });
    await expect(api.deleteRouteLeg('p', 'o', 'l', 6)).resolves.toMatchObject({ revision: 7 });

    respondWith({ message: 'ok', revision: '7' });
    await expect(api.deleteDay('p', 'd', 6)).rejects.toBeInstanceOf(ApiDecodeError);
    respondWith({ message: 'ok' });
    await expect(api.undoLastPlanChange('p', 6)).rejects.toThrow(/\$\.revision/);
  });

  it('当日モード(NOW/NEXT)の応答を検証する', async () => {
    const body = {
      plan_id: 'p', today_date: '2026-10-01', timezone_id: 'Asia/Tokyo', server_time: '2026-10-01T08:00:00Z',
      now_event: null, next_event: todayEvent, minutes_until_next: 60,
      day_end_at: '2026-10-01T15:00:00Z', events: [todayEvent],
    };
    respondWith(body);
    await expect(api.getToday('p')).resolves.toEqual(body);

    respondWith({ ...body, next_event: { ...todayEvent, has_ticket: 'no' } });
    await expect(api.getToday('p')).rejects.toThrow(/\$\.next_event\.has_ticket/);
    respondWith({ ...body, events: [{ ...todayEvent, transport_status: 'late' }] });
    await expect(api.getToday('p')).rejects.toThrow(/\$\.events\[0\]\.transport_status/);
    respondWith({ ...body, server_time: undefined });
    await expect(api.getToday('p')).rejects.toBeInstanceOf(ApiDecodeError);
  });

  it('文書のダウンロードURL・予約/チケットの開示応答を検証する', async () => {
    respondWith({ url: '/api/v1/plans/documents/download?token=t', expires_at: 1790000000 });
    await expect(api.getDocumentDownloadUrl('p', 'd')).resolves.toMatchObject({ expires_at: 1790000000 });
    respondWith({ url: 123, expires_at: 1790000000 });
    await expect(api.getDocumentDownloadUrl('p', 'd')).rejects.toThrow(/\$\.url/);

    respondWith({ id: 'r', confirmation_number: 'ABC123', pin: null });
    await expect(api.revealReservation('p', 'r')).resolves.toEqual({ id: 'r', confirmation_number: 'ABC123', pin: null });
    respondWith({ id: 'r', confirmation_number: 42, pin: null });
    await expect(api.revealReservation('p', 'r')).rejects.toBeInstanceOf(ApiDecodeError);

    respondWith({ id: 't', payload: 'QRDATA', barcode_format: 'qr' });
    await expect(api.revealTicket('p', 'r', 't')).resolves.toMatchObject({ payload: 'QRDATA' });
    respondWith({ id: 't', barcode_format: 'qr' });
    await expect(api.revealTicket('p', 'r', 't')).rejects.toThrow(/\$\.payload/);
  });

  it('ApiResponseで包む応答はmessageを含む完全な形になる(以前は型アサーションで欠落)', async () => {
    // [Gate M9-FE-C2b-3] 通知一覧もdecoder対象になったため、完全な形の応答を使う
    const n1 = {
      id: 'n1', title: '招待', message: '招待されました', type: 'collaborator_invite', is_read: false,
      related_plan_id: null, created_at: '2026-09-26T00:00:00Z',
    };
    respondWith([n1]);
    const res = await api.getNotifications();
    expect(res).toEqual({ success: true, message: '', data: [n1] });
    respondWith(undefined);
    await expect(api.markAllNotificationsAsRead()).resolves.toEqual({ success: true, message: '', data: undefined });
  });
});
