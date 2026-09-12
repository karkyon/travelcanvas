/**
 * [Gate R0-7] api.ts の旧itinerary変換に関する回帰テスト。
 *
 * planToApi()は以前、planData.daysが存在する場合にitinerary JSON blobへ
 * 包んで/travel-plans(metadata API)へ送信しようとしていたが、backend側は
 * Gate #34でitineraryフィールドの書込みを422で拒否するようになっており、
 * この変換は到達しても失敗するだけの契約違反コードだった(2026-09-07
 * 最新コード再監査報告書 追加技術欠陥#3)。Gate R0でこの変換を削除した。
 * 本テストは、daysを含むplanDataを渡してもitineraryキーが決して
 * 含まれないことを保証する回帰テストである。
 */
import { describe, it, expect } from 'vitest';
import { api } from './api';

describe('planToApi', () => {
  it('never emits an itinerary key, even when days is present', () => {
    const result = (api as any).planToApi({
      title: '旅行',
      days: [{ id: 'day-1', events: [] }],
    });
    expect(result).not.toHaveProperty('itinerary');
    expect(result).not.toHaveProperty('days');
    expect(result.title).toBe('旅行');
  });

  it('returns metadata unchanged when days is absent', () => {
    const result = (api as any).planToApi({ title: '旅行', destination: '京都' });
    expect(result).toEqual({ title: '旅行', destination: '京都' });
  });

  it('passes through null/undefined unchanged', () => {
    expect((api as any).planToApi(null)).toBeNull();
    expect((api as any).planToApi(undefined)).toBeUndefined();
  });
});

// [Gate M2] FR-014移動区間(TravelSegment)のAPIクライアントメソッドが、
// 正しいURL・HTTPメソッド・ヘッダー(Idempotency-Key/If-Match)でaxiosを
// 呼び出すことを検証する(実サーバーへは接続しない、axiosインスタンス自体を
// モックする単体テスト)。
describe('TravelSegment API client', () => {
  it('getSegments calls GET /plans/{planId}/segments', async () => {
    const mockGet = async (url: string) => {
      expect(url).toBe('/plans/plan-1/segments');
      return { data: [] };
    };
    (api as any).client = { get: mockGet };
    const result = await api.getSegments('plan-1');
    expect(result).toEqual([]);
  });

  it('createSegment sends Idempotency-Key header and POSTs to the segments endpoint', async () => {
    const mockPost = async (url: string, data: any, config: any) => {
      expect(url).toBe('/plans/plan-1/segments');
      expect(data.mode).toBe('walking');
      expect(config.headers['Idempotency-Key']).toBe('key-123');
      return { data: { id: 'seg-1', mode: 'walking' } };
    };
    (api as any).client = { post: mockPost };
    const result = await api.createSegment(
      'plan-1', { from_event_id: 'e1', to_event_id: 'e2', mode: 'walking' }, 'key-123',
    );
    expect(result.id).toBe('seg-1');
  });

  it('updateSegment sends If-Match header and PATCHes the segment', async () => {
    const mockPatch = async (url: string, data: any, config: any) => {
      expect(url).toBe('/plans/plan-1/segments/seg-1');
      expect(data.mode).toBe('driving');
      expect(config.headers['If-Match']).toBe('3');
      return { data: { id: 'seg-1', mode: 'driving' } };
    };
    (api as any).client = { patch: mockPatch };
    const result = await api.updateSegment('plan-1', 'seg-1', { mode: 'driving' }, 3);
    expect(result.mode).toBe('driving');
  });

  it('deleteSegment sends If-Match header and DELETEs the segment', async () => {
    const mockDelete = async (url: string, config: any) => {
      expect(url).toBe('/plans/plan-1/segments/seg-1');
      expect(config.headers['If-Match']).toBe('2');
      return { data: { revision: 3 } };
    };
    (api as any).client = { delete: mockDelete };
    const result = await api.deleteSegment('plan-1', 'seg-1', 2);
    expect(result.revision).toBe(3);
  });

  it('getSegment calls GET on the specific segment path', async () => {
    const mockGet = async (url: string) => {
      expect(url).toBe('/plans/plan-1/segments/seg-9');
      return { data: { id: 'seg-9' } };
    };
    (api as any).client = { get: mockGet };
    const result = await api.getSegment('plan-1', 'seg-9');
    expect(result.id).toBe('seg-9');
  });
});
