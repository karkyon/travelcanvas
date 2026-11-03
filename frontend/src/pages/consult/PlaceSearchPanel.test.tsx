/**
 * [Gate SearchUAT] 「候補を探す」の入口は1つ。検索元の選択・Google の利用の条件・失敗の分類・再試行・二重押し・選択の保持。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ searchNearby: vi.fn(), consultPlaces: vi.fn() }));
vi.mock('@/services/api/g11discover', () => ({ searchNearby: api.searchNearby }));
vi.mock('@/services/api/consultAi', async (orig) => ({
  ...(await orig<typeof import('@/services/api/consultAi')>()), consultPlaces: api.consultPlaces,
}));

import PlaceSearchPanel, { type PlaceSearchProps } from './PlaceSearchPanel';
import type { ConsultAiStatus } from '@/services/api/consultAi';
import type { NearbyResult } from '@/services/api/types/g11discover';

const op = (over: Partial<ConsultAiStatus['operations']['places.search']> = {}) => ({
  provider: 'google_places', included: true, key_ready: true, suspended: false, reason: null, ready: true, ...over });
const status = (over: Partial<ConsultAiStatus> = {}, place = {}): ConsultAiStatus => ({
  class: 'journey', class_label: 'Journey', consent: { ai_processing: true }, stub: false, model: 'gpt-5-nano',
  max_text_chars: 3000,
  operations: { 'ai.generate': op(), 'places.search': op(place), 'routes.element': op() } as ConsultAiStatus['operations'],
  ...over,
});
const usage = (remaining = '40') => ({ currency: 'JPY', plan_cap: '50', plan_used: '10', plan_reserved: '0',
  plan_remaining: remaining, class: 'journey' });
const spot = (id: string, name: string): NearbyResult => ({ id, provider: 'overpass', name, category: 'attraction',
  location: { latitude: 34.49, longitude: 136.71, address: null }, retrieved_at: '2026-11-01T00:00:00+00:00',
  distance_m: 2300, within_radius: true, radius_guaranteed: true });
const ok = (rows: NearbyResult[]) => ({ query: '', category: 'sightseeing', radius_km: 10, base: null, total: rows.length,
  candidates: rows, unavailable_providers: [], provider_errors: {} });
const failed = (code: string) => ({ ...ok([]), unavailable_providers: ['overpass'], provider_errors: { overpass: code } });

function setup(over: Partial<PlaceSearchProps> = {}) {
  const props: PlaceSearchProps = {
    areaName: '伊勢', base: { latitude: 34.4875, longitude: 136.7091 }, picked: {}, pickedGoogle: {},
    onPick: vi.fn(), onPickGoogle: vi.fn(), autoSearch: false,
    google: { status: status(), usage: usage(), ensureSession: vi.fn().mockResolvedValue('sid'), onUsage: vi.fn() },
    ...over,
  };
  const view = render(<PlaceSearchPanel {...props} />);
  return { props, view };
}

describe('候補を探す(入口は1つ)', () => {
  beforeEach(() => { api.searchNearby.mockReset(); api.consultPlaces.mockReset(); });

  it('カテゴリ・名前・範囲・検索元・実行が一か所。既定は OpenStreetMap(無料)で、検索元を表示する', async () => {
    api.searchNearby.mockResolvedValue(ok([spot('s1', '皇大神宮')]));
    setup();
    expect(screen.getByRole('form', { name: '候補を探す' })).toBeInTheDocument();
    expect(screen.getByTestId('consult-source-osm')).toBeChecked();
    expect(screen.getByTestId('consult-search-using')).toHaveTextContent('検索元: OpenStreetMap(無料) · 伊勢の周り 半径10km');
    fireEvent.click(screen.getByTestId('consult-category-market'));
    fireEvent.change(screen.getByLabelText('検索範囲'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('consult-search'));
    await waitFor(() => expect(api.searchNearby).toHaveBeenCalledWith(expect.objectContaining({ category: 'market',
      radius_km: 5, latitude: 34.4875 })));
    expect(await screen.findByTestId('consult-result-s1')).toHaveTextContent('出典: OpenStreetMap');
    expect(api.consultPlaces).not.toHaveBeenCalled();
  });

  it('[AreaGeo] OpenStreetMap が時間切れでも Wikipedia の座標付き記事が並ぶ。出典は行ごとに Wikipedia と示す', async () => {
    api.searchNearby.mockResolvedValue({ ...ok([{ ...spot('w1', '伊勢神宮'), provider: 'wikipedia', radius_guaranteed: false }]),
      unavailable_providers: ['overpass'], provider_errors: { overpass: 'timeout' } });
    setup();
    fireEvent.click(screen.getByTestId('consult-search'));
    const row = await screen.findByTestId('consult-result-w1');
    expect(row).toHaveTextContent('出典: Wikipedia');
    expect(row).not.toHaveTextContent('出典: OpenStreetMap');
  });

  it('[PlaceKinds] 種類のバッジ・写真・希望に合う順・種類と希望で絞り込む。探し方を説明する', async () => {
    const w = (id: string, name: string, kind: string, dist: number, thumb: string | null = null): NearbyResult => ({
      ...spot(id, name), provider: 'wikipedia', radius_guaranteed: false, kind, distance_m: dist, thumbnail_url: thumb,
      description: kind === 'museum' ? '三重県鳥羽市にある水族館' : null });
    api.searchNearby.mockResolvedValue(ok([w('h1', '鳥羽国際ホテル', 'lodging', 100), w('t1', '賀多神社', 'shrine_temple', 400),
      w('m1', '鳥羽水族館', 'museum', 200, 'https://upload.wikimedia.org/aq.jpg'), w('l1', '遊園地', 'leisure', 50)]));
    setup({ preferences: ['culture', 'quiet'] });
    fireEvent.click(screen.getByTestId('consult-search'));
    const items = await screen.findAllByRole('listitem');
    const order = items.map((li) => li.getAttribute('data-kind')).filter(Boolean);
    expect(order).toEqual(['museum', 'shrine_temple', 'lodging', 'leisure']); // 希望に合う種類 → 近い順、静かな希望ではテーマパークは後
    expect(screen.getByTestId('consult-kind-badge-m1')).toHaveTextContent('博物館・美術館・水族館');
    expect(screen.getByTestId('consult-match-t1')).toHaveTextContent('希望に合う: 歴史・文化・静か');
    expect(screen.getByTestId('consult-result-m1').querySelector('img')).toHaveAttribute('src', 'https://upload.wikimedia.org/aq.jpg');
    expect(screen.getByTestId('consult-result-m1')).toHaveTextContent('三重県鳥羽市にある水族館');
    expect(screen.getByTestId('consult-results-logic')).toHaveTextContent('市町村そのもの・役所・学校');
    fireEvent.click(screen.getByTestId('consult-kind-lodging'));
    expect(screen.queryByTestId('consult-result-t1')).toBeNull();
    expect(screen.getByTestId('consult-result-h1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consult-kind-lodging'));
    fireEvent.click(screen.getByTestId('consult-only-match'));
    expect(screen.queryByTestId('consult-result-h1')).toBeNull();
    expect(screen.getByTestId('consult-result-t1')).toBeInTheDocument();
  });

  it('[S3] 429 の後は待つ時間を示す。保存した結果・前の結果(古い)は取得の古さと一緒に示す', async () => {
    api.searchNearby
      .mockResolvedValueOnce({ ...failed('rate_limited'), provider_retry_after: { overpass: 120 } })
      .mockResolvedValueOnce({ ...ok([spot('s1', '皇大神宮')]), cached_providers: { overpass: { age_seconds: 600, stale: false } } })
      .mockResolvedValueOnce({ ...ok([spot('s2', '前の店')]), unavailable_providers: ['overpass'],
        provider_errors: { overpass: 'timeout' }, cached_providers: { overpass: { age_seconds: 7300, stale: true } } });
    setup();
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-search-error')).toHaveTextContent('あと約2分はアプリから送りません');
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    expect(await screen.findByTestId('consult-results-cached')).toHaveTextContent('10分前に OpenStreetMap から取得');
    expect(screen.queryByTestId('consult-search-error')).toBeNull();
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-result-s2')).toBeInTheDocument();
    expect(screen.getByTestId('consult-results-cached')).toHaveTextContent('前の結果(2時間前');
    expect(screen.getByTestId('consult-search-error')).toHaveTextContent('時間内に答えませんでした');
  });

  it('該当なしと提供元の失敗を分ける。失敗では前の結果を残し、もう一度探せる。自動で有料へ切り替えない', async () => {
    api.searchNearby.mockResolvedValueOnce(ok([spot('s1', '皇大神宮')])).mockResolvedValueOnce(failed('blocked'))
      .mockResolvedValueOnce(ok([]));
    setup();
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-result-s1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consult-search'));
    const err = await screen.findByTestId('consult-search-error');
    expect(err).toHaveTextContent('要求を受け付けませんでした');
    expect(err).toHaveTextContent('該当なしではありません');
    expect(screen.getByTestId('consult-result-s1')).toBeInTheDocument(); // 前の結果は残る
    expect(screen.getByTestId('consult-search-google')).toHaveTextContent('Google で探す(有料');
    expect(api.consultPlaces).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    expect(await screen.findByTestId('consult-results-empty')).toHaveTextContent('該当なし');
    expect(screen.queryByTestId('consult-search-error')).toBeNull();
  });

  it.each([
    ['rate_limited', '回数の制限'], ['timeout', '時間内に答えませんでした'], ['provider_timeout', '時間切れ'],
    ['server_error', '障害'], ['network', '接続できませんでした'], ['unreadable', '応答を読めませんでした'],
  ])('失敗の分類 %s を言葉にする', async (code, text) => {
    api.searchNearby.mockResolvedValue(failed(code));
    setup();
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-search-error')).toHaveTextContent(text);
  });

  it('TravelCanvas のサーバーに届かない時も入力を残して再試行できる', async () => {
    api.searchNearby.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(ok([spot('s2', '外宮')]));
    setup();
    fireEvent.change(screen.getByLabelText('名前・雰囲気(空でも可)'), { target: { value: '神宮' } });
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-search-error')).toHaveTextContent('サーバーに届きませんでした');
    expect(screen.getByLabelText('名前・雰囲気(空でも可)')).toHaveValue('神宮');
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    expect(await screen.findByTestId('consult-result-s2')).toBeInTheDocument();
    expect(api.searchNearby).toHaveBeenLastCalledWith(expect.objectContaining({ query: '神宮' }));
  });

  it('連打しても1回だけ送る', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    api.searchNearby.mockReturnValue(new Promise((r) => { resolve = r; }));
    setup();
    const btn = screen.getByTestId('consult-search');
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.submit(screen.getByRole('form', { name: '候補を探す' }));
    await act(async () => { resolve(ok([])); });
    expect(api.searchNearby).toHaveBeenCalledTimes(1);
  });

  it('Google は利用者が選んだ時だけ。結果は同じ並び・同じ「旅程案に入れる」・出典と取得時刻', async () => {
    api.consultPlaces.mockResolvedValue({ results: [{ provider: 'google_places', place_id: 'P1', name: 'おかげ横丁',
      address: '伊勢市', latitude: 34.46, longitude: 136.72, maps_uri: 'https://maps.google.com/?cid=1' }],
    usage: usage('35'), attribution: 'Google', retrieved_at: '2026-11-01T00:00:00+00:00', notice: '', stub: false });
    const { props } = setup();
    fireEvent.click(screen.getByTestId('consult-category-food'));
    fireEvent.click(screen.getByTestId('consult-source-google'));
    expect(screen.getByTestId('consult-search-using')).toHaveTextContent('検索元: Google(有料・この相談の利用枠)');
    fireEvent.click(screen.getByTestId('consult-search'));
    await waitFor(() => expect(api.consultPlaces).toHaveBeenCalledWith('sid', '食べ物 伊勢',
      { latitude: 34.4875, longitude: 136.7091 }, expect.any(String), 10));
    expect(api.searchNearby).not.toHaveBeenCalled();
    const row = await screen.findByTestId('consult-result-P1');
    expect(row).toHaveTextContent('出典: Google');
    expect(row).toHaveTextContent('営業時間・料金は未確認');
    fireEvent.click(screen.getByTestId('consult-pick-P1'));
    expect(props.onPickGoogle).toHaveBeenCalledWith(expect.objectContaining({ place_id: 'P1', maps_uri: 'https://maps.google.com/?cid=1' }), true);
    expect(props.google.onUsage).toHaveBeenCalled();
  });

  it.each([
    [status({ class: 'guest', class_label: 'Guest' }), usage(), 'ゲストでは使えません', 'ログイン'],
    [status({}, { included: false }), usage(), 'クラスには Google の検索が含まれません', '会員クラス'],
    [status({}, { key_ready: false, reason: 'secret_unverified' }), usage(), '鍵の有効性をまだ確かめていません', '有効性を確認'],
    [status({}, { suspended: true }), usage(), '止めています', '戻す'],
    [status(), usage('0'), '利用枠(上限)に達しました', 'OpenStreetMap(無料)で探せます'],
  ])('Google を使えない時は理由と解決を検索欄の近くに出し、選べない', (st, us, reason, fix) => {
    setup({ google: { status: st, usage: us, ensureSession: vi.fn(), onUsage: vi.fn() } });
    expect(screen.getByTestId('consult-source-google')).toBeDisabled();
    expect(screen.getByTestId('consult-google-availability')).toHaveTextContent(reason);
    expect(screen.getByTestId('consult-google-availability')).toHaveTextContent(fix);
  });

  it('Google が「処理中」と答えた時は、同じ入力のもう一度に同じ Idempotency-Key を使う', async () => {
    const busyErr = { response: { status: 409, data: { detail: { code: 'request_in_progress', message: '処理中です' } } } };
    api.consultPlaces.mockRejectedValueOnce(busyErr).mockResolvedValueOnce({ results: [], usage: usage(), attribution: 'Google',
      retrieved_at: '2026-11-01T00:00:00+00:00', notice: '', stub: false });
    setup();
    fireEvent.click(screen.getByTestId('consult-source-google'));
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-search-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    expect(await screen.findByTestId('consult-results-empty')).toHaveTextContent('Google で探しました');
    expect(api.consultPlaces.mock.calls[0]![3]).toBe(api.consultPlaces.mock.calls[1]![3]);
  });

  const gResult = () => ({ results: [], usage: usage(), attribution: 'Google', retrieved_at: '2026-11-01T00:00:00+00:00',
    notice: '', stub: false });

  it('[F03] 応答が届かなかった(通信・時間切れ・5xx)後のやり直しは同じキー(二度課金しない)', async () => {
    api.consultPlaces.mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce({ response: { status: 503, data: { detail: { code: 'provider_timeout', message: '時間切れ' } } } })
      .mockResolvedValueOnce(gResult());
    setup();
    fireEvent.click(screen.getByTestId('consult-source-google'));
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-search-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    await waitFor(() => expect(api.consultPlaces).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByTestId('consult-search-retry'));
    expect(await screen.findByTestId('consult-results-empty')).toBeInTheDocument();
    const keys = api.consultPlaces.mock.calls.map((c) => c[3]);
    expect(new Set(keys).size).toBe(1);
  });

  it('[F03] 済んだ要求(idempotent_replay)は原価計上済みと示し、探し直しは新しい検索(新しいキー)', async () => {
    api.consultPlaces.mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: 'idempotent_replay', message: '済み' } } } })
      .mockResolvedValueOnce(gResult());
    setup();
    fireEvent.click(screen.getByTestId('consult-source-google'));
    fireEvent.click(screen.getByTestId('consult-search'));
    await screen.findByTestId('consult-search-error');
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    await waitFor(() => expect(screen.getByTestId('consult-search-error')).toHaveTextContent('原価は計上されています'));
    expect(screen.getByTestId('consult-search-retry')).toHaveTextContent('新しい検索として探す(有料・1回)');
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    await screen.findByTestId('consult-results-empty');
    const keys = api.consultPlaces.mock.calls.map((c) => c[3]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('[F03] 送る前に断られた(4xx)後は新しいキー', async () => {
    api.consultPlaces.mockRejectedValueOnce({ response: { status: 429, data: { detail: { code: 'feature_quota_exceeded',
      message: '回数の上限' } } } }).mockResolvedValueOnce(gResult());
    setup();
    fireEvent.click(screen.getByTestId('consult-source-google'));
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-search-error')).toHaveTextContent('回数の上限');
    fireEvent.click(screen.getByTestId('consult-search-retry'));
    await screen.findByTestId('consult-results-empty');
    expect(api.consultPlaces.mock.calls[0]![3]).not.toBe(api.consultPlaces.mock.calls[1]![3]);
  });

  it('[F04] Google にも検索範囲を送り、範囲は優先だけと示す', async () => {
    api.consultPlaces.mockResolvedValue(gResult());
    setup();
    fireEvent.click(screen.getByTestId('consult-source-google'));
    fireEvent.change(screen.getByLabelText('検索範囲'), { target: { value: '5' } });
    expect(screen.getByTestId('consult-search-using')).toHaveTextContent('半径5km');
    expect(screen.getByTestId('consult-search-using')).toHaveTextContent('範囲の外の場所も出ることがあります');
    fireEvent.click(screen.getByTestId('consult-search'));
    await waitFor(() => expect(api.consultPlaces).toHaveBeenCalledWith('sid', '観光 伊勢', expect.anything(), expect.any(String), 5));
  });

  it('[F06] 一部だけの結果は「完全な結果」と区別して示す', async () => {
    api.searchNearby.mockResolvedValue({ ...ok([spot('s1', '皇大神宮')]), partial_providers: ['overpass'] });
    setup();
    fireEvent.click(screen.getByTestId('consult-search'));
    expect(await screen.findByTestId('consult-results-partial')).toHaveTextContent('一部だけの結果');
    expect(screen.getByTestId('consult-result-s1')).toBeInTheDocument();
  });
});
