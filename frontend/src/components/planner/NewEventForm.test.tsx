/**
 * [Gate② G2-10] 予定の新規追加フォーム: 住所から位置を探す・場所の情報を調べる時の、成功・0件・提供元の障害・通信エラー・再試行。
 * 提供元の障害(unavailable)を「住所が見つからない」と誤認させず、次に何をすればよいかを示すこと。
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ geocodeAddress: vi.fn(), getPlaceInfo: vi.fn() }));
vi.mock('@/services/api/planEdit', () => ({ geocodeAddress: m.geocodeAddress, getPlaceInfo: m.getPlaceInfo }));
vi.mock('./SpotMiniMap', () => ({ default: () => <div data-testid="mini-map" /> }));

import NewEventForm from './NewEventForm';
import type { NewEventData } from './newEventLookup';

type LookupState = { busy: boolean; result: Parameters<typeof NewEventForm>[0]['lookupState']['result']; error: string | null };

const Harness: React.FC<{ initial?: NewEventData }> = ({ initial = { title: '伊勢神宮', address: '三重県伊勢市宇治館町1' } }) => {
  const [data, setData] = useState<NewEventData>(initial);
  const [urlRows, setUrlRows] = useState<string[]>(['']);
  const [stay, setStay] = useState({ h: '1', m: '0' });
  const [lookupState, setLookupState] = useState<LookupState>({ busy: false, result: null, error: null });
  return (
    <>
      <NewEventForm data={data} setData={setData} urlRows={urlRows} setUrlRows={setUrlRows} stay={stay} setStay={setStay}
        near={null} lookupState={lookupState} setLookupState={setLookupState} />
      <div data-testid="pos">{typeof data.latitude === 'number' ? `${data.latitude},${data.longitude}` : 'none'}</div>
    </>
  );
};

const geo = (over: Record<string, unknown> = {}) => ({ candidates: [], sources: [], unavailable: false, ...over });
const info = (over: Record<string, unknown> = {}) => ({
  provider: 'multi', attribution: '', license: '', license_url: '', cached: false, unavailable: false, error_code: null,
  sources: [], candidates: [], ...over,
});

beforeEach(() => { m.geocodeAddress.mockReset(); m.getPlaceInfo.mockReset(); });

describe('住所から位置を探す', () => {
  it('見つかった時は位置を入れ、どの住所の位置にしたかを示す', async () => {
    m.geocodeAddress.mockResolvedValue(geo({ candidates: [{ latitude: 34.455, longitude: 136.725, address: '三重県伊勢市宇治館町1' }] }));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    await waitFor(() => expect(screen.getByTestId('pos').textContent).toBe('34.455,136.725'));
    expect(screen.getByRole('status').textContent).toContain('の位置にしました');
  });

  it('0件の時は「見つかりませんでした」と書き方の確認を促す', async () => {
    m.geocodeAddress.mockResolvedValue(geo());
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('位置が見つかりませんでした'));
    expect(screen.getByRole('status').textContent).toContain('住所の書き方');
    expect(screen.getByTestId('pos').textContent).toBe('none');
  });

  it('提供元の障害の時は、住所の間違いではないと伝え、待って再試行を促す(0件と同じ文にしない)', async () => {
    m.geocodeAddress.mockResolvedValue(geo({ unavailable: true }));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('繋がらず'));
    const note = screen.getByRole('status').textContent ?? '';
    expect(note).toContain('住所が間違っているという意味ではありません');
    expect(note).toContain('もう一度');
    expect(note).not.toContain('見つかりませんでした');
  });

  it('通信が失敗した時も固まらず、押し直せる', async () => {
    m.geocodeAddress.mockRejectedValue(new Error('network'));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('位置を読めませんでした'));
    expect((screen.getByTestId('new-geocode') as HTMLButtonElement).disabled).toBe(false);
  });

  it('障害のあとの再試行で成功すると、位置が入り、障害の注意は消える', async () => {
    m.geocodeAddress.mockResolvedValueOnce(geo({ unavailable: true }))
      .mockResolvedValueOnce(geo({ candidates: [{ latitude: 34.455, longitude: 136.725, address: null }] }));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('繋がらず'));
    fireEvent.click(screen.getByTestId('new-geocode'));
    await waitFor(() => expect(screen.getByTestId('pos').textContent).toBe('34.455,136.725'));
    expect(screen.getByRole('status').textContent).not.toContain('繋がらず');
    expect(m.geocodeAddress).toHaveBeenCalledTimes(2);
  });

  it('住所・場所名・タイトルが全て空なら、検索を呼ばない(入力不正)', () => {
    render(<Harness initial={{ title: '', address: '' }} />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    expect(m.geocodeAddress).not.toHaveBeenCalled();
    expect(screen.getByTestId('pos').textContent).toBe('none');
  });
});

describe('場所の情報を調べる', () => {
  it('名前が空なら、先に名前を入れるよう促し、検索を呼ばない', () => {
    render(<Harness initial={{ title: '', location_name: '' }} />);
    fireEvent.click(screen.getByTestId('new-lookup'));
    expect(screen.getByTestId('new-lookup-note').textContent).toContain('先にタイトル');
    expect(m.getPlaceInfo).not.toHaveBeenCalled();
  });

  it('提供元の障害は「応答しませんでした」、0件は「見つかりませんでした」で区別する', async () => {
    m.getPlaceInfo.mockResolvedValueOnce(info({ unavailable: true }));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-lookup'));
    await waitFor(() => expect(screen.getByTestId('new-lookup-note').textContent).toContain('応答しませんでした'));
    m.getPlaceInfo.mockResolvedValueOnce(info());
    fireEvent.click(screen.getByTestId('new-lookup'));
    await waitFor(() => expect(screen.getByTestId('new-lookup-note').textContent).toContain('見つかりませんでした'));
    expect(screen.getByTestId('new-lookup-note').textContent).toContain('住所を入れて');
  });

  it('通信が失敗した時は読めなかったことを示し、押し直せる', async () => {
    m.getPlaceInfo.mockRejectedValue(new Error('timeout'));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-lookup'));
    await waitFor(() => expect(screen.getByTestId('new-lookup-note').textContent).toContain('読めませんでした'));
    expect((screen.getByTestId('new-lookup') as HTMLButtonElement).disabled).toBe(false);
  });

  it('見つかった時は注意文を出さず、候補を表示する', async () => {
    m.getPlaceInfo.mockResolvedValue(info({ candidates: [{
      name: '伊勢神宮 内宮', address: '三重県伊勢市宇治館町1', phone: null, website: null, category: 'sightseeing', osm_type: null,
      latitude: 34.455, longitude: 136.725, source_url: null, links: [], notes: [] }] }));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('new-lookup'));
    await waitFor(() => expect(screen.getByTestId('new-lookup-result')).toBeTruthy());
    expect(screen.queryByTestId('new-lookup-note')).toBeNull();
  });
});
