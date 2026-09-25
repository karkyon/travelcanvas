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
import { api, resolveDownloadUrl, extractApiErrorDetailMessage } from './api';
import type { TravelPlan } from '@/types';
// [Gate M9-FE-C2b-2] 応答はruntime decoderで検証されるため、モック応答は実backendから
// 採取した完全な形状(契約fixture)を基に、テストで見たい項目だけ上書きする。
import fx from './api/__fixtures__/backendContractResponses.json';

// [Gate M9-FE-A2] planToApi()はprivateメソッドのため、テストからは
// 構造的に型付けされたアクセサ経由で呼び出す(`(api as any).planToApi`の
// 置き換え)。
interface PlanToApiTestAccess {
  planToApi(data: Partial<TravelPlan> | null | undefined): Record<string, unknown> | null | undefined;
}
const planToApiAccess = api as unknown as PlanToApiTestAccess;

type MockConfig = { headers?: Record<string, string | undefined> };

describe('planToApi', () => {
  it('never emits an itinerary key, even when days is present', () => {
    const result = planToApiAccess.planToApi({
      title: '旅行',
      days: [{ id: 'day-1', events: [] }],
    } as unknown as Partial<TravelPlan>);
    expect(result).not.toHaveProperty('itinerary');
    expect(result).not.toHaveProperty('days');
    expect((result as Record<string, unknown>).title).toBe('旅行');
  });

  it('returns metadata unchanged when days is absent', () => {
    const result = planToApiAccess.planToApi({ title: '旅行', destination: '京都' } as Partial<TravelPlan>);
    expect(result).toEqual({ title: '旅行', destination: '京都' });
  });

  it('passes through null/undefined unchanged', () => {
    expect(planToApiAccess.planToApi(null)).toBeNull();
    expect(planToApiAccess.planToApi(undefined)).toBeUndefined();
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
    api.setHttpClientForTesting({ get: mockGet });
    const result = await api.getSegments('plan-1');
    expect(result).toEqual([]);
  });

  it('createSegment sends Idempotency-Key header and POSTs to the segments endpoint', async () => {
    const mockPost = async (url: string, data: { mode: string }, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/segments');
      expect(data.mode).toBe('walking');
      expect(config.headers?.['Idempotency-Key']).toBe('key-123');
      return { data: { ...fx.segment, id: 'seg-1', mode: 'walking' } };
    };
    api.setHttpClientForTesting({ post: mockPost });
    const result = await api.createSegment(
      'plan-1', { from_event_id: 'e1', to_event_id: 'e2', mode: 'walking' }, 'key-123',
    );
    expect(result.id).toBe('seg-1');
  });

  it('updateSegment sends If-Match header and PATCHes the segment', async () => {
    const mockPatch = async (url: string, data: { mode: string }, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/segments/seg-1');
      expect(data.mode).toBe('driving');
      expect(config.headers?.['If-Match']).toBe('3');
      return { data: { ...fx.segment, id: 'seg-1', mode: 'driving' } };
    };
    api.setHttpClientForTesting({ patch: mockPatch });
    const result = await api.updateSegment('plan-1', 'seg-1', { mode: 'driving' }, 3);
    expect(result.mode).toBe('driving');
  });

  it('deleteSegment sends If-Match header and DELETEs the segment', async () => {
    const mockDelete = async (url: string, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/segments/seg-1');
      expect(config.headers?.['If-Match']).toBe('2');
      return { data: { revision: 3 } };
    };
    api.setHttpClientForTesting({ delete: mockDelete });
    const result = await api.deleteSegment('plan-1', 'seg-1', 2);
    expect(result.revision).toBe(3);
  });

  it('getSegment calls GET on the specific segment path', async () => {
    const mockGet = async (url: string) => {
      expect(url).toBe('/plans/plan-1/segments/seg-9');
      return { data: { ...fx.segment, id: 'seg-9' } };
    };
    api.setHttpClientForTesting({ get: mockGet });
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
    api.setHttpClientForTesting({ get: mockGet });
    const result = await api.getRouteOptions('plan-1');
    expect(result).toEqual([]);
  });

  it('createRouteOption sends Idempotency-Key header and POSTs to the route-options endpoint', async () => {
    const mockPost = async (url: string, data: { from_event_id: string }, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/route-options');
      expect(data.from_event_id).toBe('e1');
      expect(config.headers?.['Idempotency-Key']).toBe('key-123');
      return { data: { ...fx.route_option, id: 'opt-1' } };
    };
    api.setHttpClientForTesting({ post: mockPost });
    const result = await api.createRouteOption(
      'plan-1', { from_event_id: 'e1', to_event_id: 'e2' }, 'key-123',
    );
    expect(result.id).toBe('opt-1');
  });

  it('updateRouteOption sends If-Match header and PATCHes the option', async () => {
    const mockPatch = async (url: string, data: { status: string }, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/route-options/opt-1');
      expect(data.status).toBe('discarded');
      expect(config.headers?.['If-Match']).toBe('3');
      return { data: { ...fx.route_option, id: 'opt-1', status: 'discarded' } };
    };
    api.setHttpClientForTesting({ patch: mockPatch });
    const result = await api.updateRouteOption('plan-1', 'opt-1', { status: 'discarded' }, 3);
    expect(result.status).toBe('discarded');
  });

  it('deleteRouteOption sends If-Match header and DELETEs the option', async () => {
    const mockDelete = async (url: string, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/route-options/opt-1');
      expect(config.headers?.['If-Match']).toBe('2');
      return { data: { revision: 3 } };
    };
    api.setHttpClientForTesting({ delete: mockDelete });
    const result = await api.deleteRouteOption('plan-1', 'opt-1', 2);
    expect(result.revision).toBe(3);
  });

  it('addRouteLeg sends If-Match header and POSTs to the legs endpoint', async () => {
    const mockPost = async (url: string, data: { mode: string }, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/route-options/opt-1/legs');
      expect(data.mode).toBe('walking');
      expect(config.headers?.['If-Match']).toBe('1');
      return { data: { ...fx.route_leg, id: 'leg-1', leg_order: 0 } };
    };
    api.setHttpClientForTesting({ post: mockPost });
    const result = await api.addRouteLeg('plan-1', 'opt-1', { mode: 'walking' }, 1);
    expect(result.id).toBe('leg-1');
  });

  it('adoptRouteOption sends If-Match header and POSTs to the adopt endpoint', async () => {
    const mockPost = async (url: string, _data: unknown, config: MockConfig) => {
      void _data;
      expect(url).toBe('/plans/plan-1/route-options/opt-1/adopt');
      expect(config.headers?.['If-Match']).toBe('4');
      return { data: { revision: 5, route_option: { ...fx.route_option, id: 'opt-1' }, segment_id: 'seg-1' } };
    };
    api.setHttpClientForTesting({ post: mockPost });
    const result = await api.adoptRouteOption('plan-1', 'opt-1', 4);
    expect(result.segment_id).toBe('seg-1');
  });
});

// [Gate M6] FR-013 Object Storage実連携(Gate M5)のfrontend APIクライアント
// メソッドが、正しいURL・HTTPメソッド・Content-Typeでaxiosを呼び出すことを
// 検証する。
describe('Document upload/download API client', () => {
  it('uploadDocument POSTs multipart/form-data to the upload endpoint', async () => {
    const mockPost = async (url: string, data: unknown, config: MockConfig) => {
      expect(url).toBe('/plans/plan-1/documents/upload');
      expect(data).toBeInstanceOf(FormData);
      // [Gate M10 バグA修正] 'multipart/form-data' をboundary無しで明示指定
      // するとbackend側でmultipartとして正しくパースできないため、
      // Content-Typeはundefinedを指定し、axiosがFormDataから自動生成する
      // boundary付きのContent-Typeに委ねる仕様とした。
      expect(config.headers?.['Content-Type']).toBeUndefined();
      return { data: { ...fx.document, id: 'doc-1', original_filename: 'receipt.pdf' } };
    };
    api.setHttpClientForTesting({ post: mockPost });
    const file = new File(['dummy content'], 'receipt.pdf', { type: 'application/pdf' });
    const result = await api.uploadDocument('plan-1', file, 'internal', 'receipt');
    expect(result.id).toBe('doc-1');
  });

  it('getDocumentDownloadUrl calls GET on the download-url endpoint', async () => {
    const mockGet = async (url: string) => {
      expect(url).toBe('/plans/plan-1/documents/doc-1/download-url');
      return { data: { url: '/api/v1/plans/documents/download?token=abc', expires_at: 12345 } };
    };
    api.setHttpClientForTesting({ get: mockGet });
    const result = await api.getDocumentDownloadUrl('plan-1', 'doc-1');
    expect(result.expires_at).toBe(12345);
  });

  it('resolveDownloadUrl combines the backend origin with the relative url', () => {
    const resolved = resolveDownloadUrl('/api/v1/plans/documents/download?token=abc');
    expect(resolved).toMatch(/^https?:\/\/.+\/api\/v1\/plans\/documents\/download\?token=abc$/);
  });
});

// [Gate M10-R2 P1] handleApiError()のdefault caseがFastAPI標準の
// RequestValidationError(422、detailが{type,loc,msg,input,ctx,url}形状の
// オブジェクト配列)をそのままtoast.error()へ渡し、react-hot-toastが
// それをReact子要素としてレンダーしようとしてアプリ全体がクラッシュ
// した(React最小化エラー#31)。extractApiErrorDetailMessage()は必ず
// 文字列かnullを返すことを固定する回帰テスト。
describe('extractApiErrorDetailMessage', () => {
  it('returns a plain string detail unchanged', () => {
    expect(extractApiErrorDetailMessage('権限がありません')).toBe('権限がありません');
  });

  it('extracts msg fields from a FastAPI validation-error array and joins them', () => {
    const detail = [
      { type: 'uuid_parsing', loc: ['path', 'plan_id'], msg: 'Input should be a valid UUID', input: 'invitations', ctx: {}, url: 'https://errors.pydantic.dev' },
    ];
    const result = extractApiErrorDetailMessage(detail);
    expect(typeof result).toBe('string');
    expect(result).toBe('Input should be a valid UUID');
  });

  it('joins multiple validation-error items into one string', () => {
    const detail = [
      { type: 'missing', loc: ['body', 'email'], msg: 'Field required', input: {}, ctx: {}, url: '' },
      { type: 'missing', loc: ['body', 'password'], msg: 'Field required', input: {}, ctx: {}, url: '' },
    ];
    const result = extractApiErrorDetailMessage(detail);
    expect(typeof result).toBe('string');
    expect(result).toBe('Field required / Field required');
  });

  it('returns null for null/undefined detail', () => {
    expect(extractApiErrorDetailMessage(null)).toBeNull();
    expect(extractApiErrorDetailMessage(undefined)).toBeNull();
  });

  it('returns null rather than a raw object/array for unrecognized shapes', () => {
    expect(extractApiErrorDetailMessage([{ unexpected: 'shape' }])).toBeNull();
    expect(extractApiErrorDetailMessage({ unexpected: 'shape' })).toBeNull();
    expect(extractApiErrorDetailMessage(42)).toBeNull();
  });
});
