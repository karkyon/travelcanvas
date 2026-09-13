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
import { api, resolveDownloadUrl } from './api';

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

// [Gate M4] FR-015複数経路比較(RouteOption/RouteLeg)のAPIクライアント
// メソッドが、正しいURL・HTTPメソッド・ヘッダー(Idempotency-Key/If-Match)
// でaxiosを呼び出すことを検証する。
describe('RouteOption API client', () => {
  it('getRouteOptions calls GET /plans/{planId}/route-options', async () => {
    const mockGet = async (url: string) => {
      expect(url).toBe('/plans/plan-1/route-options');
      return { data: [] };
    };
    (api as any).client = { get: mockGet };
    const result = await api.getRouteOptions('plan-1');
    expect(result).toEqual([]);
  });

  it('createRouteOption sends Idempotency-Key header and POSTs to the route-options endpoint', async () => {
    const mockPost = async (url: string, data: any, config: any) => {
      expect(url).toBe('/plans/plan-1/route-options');
      expect(data.from_event_id).toBe('e1');
      expect(config.headers['Idempotency-Key']).toBe('key-123');
      return { data: { id: 'opt-1' } };
    };
    (api as any).client = { post: mockPost };
    const result = await api.createRouteOption(
      'plan-1', { from_event_id: 'e1', to_event_id: 'e2' }, 'key-123',
    );
    expect(result.id).toBe('opt-1');
  });

  it('updateRouteOption sends If-Match header and PATCHes the option', async () => {
    const mockPatch = async (url: string, data: any, config: any) => {
      expect(url).toBe('/plans/plan-1/route-options/opt-1');
      expect(data.status).toBe('discarded');
      expect(config.headers['If-Match']).toBe('3');
      return { data: { id: 'opt-1', status: 'discarded' } };
    };
    (api as any).client = { patch: mockPatch };
    const result = await api.updateRouteOption('plan-1', 'opt-1', { status: 'discarded' }, 3);
    expect(result.status).toBe('discarded');
  });

  it('deleteRouteOption sends If-Match header and DELETEs the option', async () => {
    const mockDelete = async (url: string, config: any) => {
      expect(url).toBe('/plans/plan-1/route-options/opt-1');
      expect(config.headers['If-Match']).toBe('2');
      return { data: { revision: 3 } };
    };
    (api as any).client = { delete: mockDelete };
    const result = await api.deleteRouteOption('plan-1', 'opt-1', 2);
    expect(result.revision).toBe(3);
  });

  it('addRouteLeg sends If-Match header and POSTs to the legs endpoint', async () => {
    const mockPost = async (url: string, data: any, config: any) => {
      expect(url).toBe('/plans/plan-1/route-options/opt-1/legs');
      expect(data.mode).toBe('walking');
      expect(config.headers['If-Match']).toBe('1');
      return { data: { id: 'leg-1', leg_order: 0 } };
    };
    (api as any).client = { post: mockPost };
    const result = await api.addRouteLeg('plan-1', 'opt-1', { mode: 'walking' }, 1);
    expect(result.id).toBe('leg-1');
  });

  it('adoptRouteOption sends If-Match header and POSTs to the adopt endpoint', async () => {
    const mockPost = async (url: string, _data: any, config: any) => {
      expect(url).toBe('/plans/plan-1/route-options/opt-1/adopt');
      expect(config.headers['If-Match']).toBe('4');
      return { data: { revision: 5, route_option: { id: 'opt-1' }, segment_id: 'seg-1' } };
    };
    (api as any).client = { post: mockPost };
    const result = await api.adoptRouteOption('plan-1', 'opt-1', 4);
    expect(result.segment_id).toBe('seg-1');
  });
});

// [Gate M6] FR-013 Object Storage実連携(Gate M5)のfrontend APIクライアント
// メソッドが、正しいURL・HTTPメソッド・Content-Typeでaxiosを呼び出すことを
// 検証する。
describe('Document upload/download API client', () => {
  it('uploadDocument POSTs multipart/form-data to the upload endpoint', async () => {
    const mockPost = async (url: string, data: any, config: any) => {
      expect(url).toBe('/plans/plan-1/documents/upload');
      expect(data).toBeInstanceOf(FormData);
      expect(config.headers['Content-Type']).toBe('multipart/form-data');
      return { data: { id: 'doc-1', original_filename: 'receipt.pdf' } };
    };
    (api as any).client = { post: mockPost };
    const file = new File(['dummy content'], 'receipt.pdf', { type: 'application/pdf' });
    const result = await api.uploadDocument('plan-1', file, 'internal', 'receipt');
    expect(result.id).toBe('doc-1');
  });

  it('getDocumentDownloadUrl calls GET on the download-url endpoint', async () => {
    const mockGet = async (url: string) => {
      expect(url).toBe('/plans/plan-1/documents/doc-1/download-url');
      return { data: { url: '/api/v1/plans/documents/download?token=abc', expires_at: 12345 } };
    };
    (api as any).client = { get: mockGet };
    const result = await api.getDocumentDownloadUrl('plan-1', 'doc-1');
    expect(result.expires_at).toBe(12345);
  });

  it('resolveDownloadUrl combines the backend origin with the relative url', () => {
    const resolved = resolveDownloadUrl('/api/v1/plans/documents/download?token=abc');
    expect(resolved).toMatch(/^https?:\/\/.+\/api\/v1\/plans\/documents\/download\?token=abc$/);
  });
});
