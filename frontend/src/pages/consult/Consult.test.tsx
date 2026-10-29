/**
 * [Gate G11] 段階5 行き先が未定の旅行相談(UIX-M15〜M19)。
 * 希望 → 確認(未確認の行は条件に使わない・曖昧さの問い)→ 方面の比較(未照会を値にしない)→ 方面の詳細 → 下書き。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  extractIntent: vi.fn(), compareAreas: vi.fn(), createTripDraft: vi.fn(), getTripDraft: vi.fn(),
  updateDraftSlots: vi.fn(), commitTripDraft: vi.fn(), searchNearby: vi.fn(),
}));
vi.mock('@/services/api/tripIntent', () => ({
  extractIntent: api.extractIntent, compareAreas: api.compareAreas, createTripDraft: api.createTripDraft,
  getTripDraft: api.getTripDraft, updateDraftSlots: api.updateDraftSlots, commitTripDraft: api.commitTripDraft,
}));
vi.mock('@/services/api/g11discover', () => ({ searchNearby: api.searchNearby }));
vi.mock('@/components/planning/PlanningUsageMeter', () => ({ default: () => null }));
vi.mock('@/components/planning/PlanningClassSummary', () => ({ default: () => null }));
vi.mock('./AreaMap', () => ({
  default: ({ pins, onSelect }: { pins: Array<{ name: string; order: number }>; onSelect: (n: string) => void }) => (
    <div data-testid="area-map-mock">
      {pins.map((p) => <button key={p.name} type="button" onClick={() => onSelect(p.name)}>{`pin ${p.order} ${p.name}`}</button>)}
    </div>
  ),
}));

import TripConsultPage from './TripConsultPage';
import TripDraftPage from './TripDraftPage';
import {
  EXAMPLE_TEXT, initReview, intentOf, loadState, moveSlot, openQuestions, placeSlot, removeSlot, sortSlots,
} from './consultModel';
import type { IntentExtraction, TripDraft } from '@/services/api/types/tripIntent';

const item = (key: string, over: Record<string, unknown>) => ({
  key, label: key, value: null, display: '', source: 'text', strength: 'undecided', evidence: null, question: null,
  needs_answer: false, note: null, sensitive: false, ...over,
});

const EXTRACTION: IntentExtraction = {
  extractor: 'text_rules', ai_connected: false, nights: 1,
  areas: [{ name: '伊勢', source: 'user_input' }, { name: '福井', source: 'user_input' }, { name: '滋賀', source: 'user_input' },
    { name: '淡路島', source: 'user_input' }],
  items: [
    item('origin', { value: '枚方', display: '枚方', strength: 'required', evidence: '枚方から車で' }),
    item('party_size', { value: 4, display: '4人', strength: 'required' }),
    item('nights', { value: 1, display: '1泊2日', strength: 'required' }),
    item('transport', { value: { mode: 'car', highway: true }, display: '自家用車 · 高速道路を使う', strength: 'required' }),
    item('one_way', { value: 3, display: '3時間くらいまで', needs_answer: true, question: {
      id: 'one_way_strength', text: 'q', options: [{ value: 'preferred', label: '希望' }, { value: 'required', label: '絶対条件' }],
      suggested: 'preferred', hint: null } }),
    item('room', { value: 'same_room', display: '全員で同じ部屋', strength: 'required' }),
    item('budget', { value: { min: 60000, max: 80000, scope: null }, display: '6〜8万円', strength: 'preferred', needs_answer: true,
      question: { id: 'budget_scope', text: 'q', options: [], suggested: 'total', hint: null } }),
    item('dates', { value: { status: 'undecided' }, display: '未定', source: 'unspecified' }),
    item('preferences', { value: ['quiet', 'calm'], display: '静か', strength: 'preferred' }),
    item('purpose', { display: '個人的な理由', sensitive: true }),
  ] as IntentExtraction['items'],
};

const geo = (lat: number | null) => ({ status: lat === null ? 'unavailable' : 'ok', latitude: lat, longitude: lat ? 136 : null,
  label: lat ? '伊勢市' : null, provider: 'nominatim', source_url: null, retrieved_at: '2026-10-29T00:00:00+00:00' }) as const;
const areaRow = (name: string, lat: number | null, limit = 'unknown') => ({
  name, source: 'user_input' as const, geocode: geo(lat), straight_km: lat ? 98.4 : null,
  drive: { status: 'not_connected', note: '未照会' }, limit_check: { status: limit, note: '運転時間は未照会' },
  lodging: { status: 'not_connected', note: '' }, quietness: { status: 'unverified', note: '' },
  hours: { status: 'date_pending', note: '' },
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  window.sessionStorage.clear();
  window.scrollTo = vi.fn();
});

describe('確認の決まり(consultModel)', () => {
  it('文章から読み取った行は確かめるまで条件に使わない。あなたの入力は使う。曖昧さの問いが残る', () => {
    const r = initReview(EXTRACTION);
    expect(r.confirmed.origin).toBe(false);
    expect(r.personal).toBe(true);
    expect(openQuestions(r)).toEqual(['one_way', 'budget']);
    const i = intentOf(r);
    expect(i.origin).toBeNull();
    expect(i.party_size).toBeNull();
    expect(i.nights).toBe(1);
    expect(i.one_way_hours).toBeNull();
    const ok = intentOf({ ...r, confirmed: { ...r.confirmed, origin: true, budget: true },
      values: { ...r.values, budget_scope: 'total' } });
    expect(ok.origin).toBe('枚方');
    expect(ok).toMatchObject({ budget_min: 60000, budget_max: 80000, budget_scope: 'total' });
    expect(JSON.stringify(ok)).not.toContain('記念');
  });

  it('下書きの並び: 同じ時間帯の中で入れ替え、端では隣の時間帯へ移る。最後の日に宿は無い', () => {
    const s = [{ day: 1, part: 'morning' as const, candidate_id: 'a' }, { day: 1, part: 'morning' as const, candidate_id: 'b' },
      { day: 1, part: 'afternoon' as const, candidate_id: 'c' }];
    expect(moveSlot(s, 'b', -1, 2)!.map((x) => x.candidate_id)).toEqual(['b', 'a', 'c']);
    expect(moveSlot(s, 'a', -1, 2)).toBeNull();
    const down = moveSlot(s, 'b', 1, 2)!;
    expect(down.find((x) => x.candidate_id === 'b')!.part).toBe('lunch');
    expect(moveSlot([{ day: 2, part: 'evening', candidate_id: 'z' }], 'z', 1, 2)).toBeNull();
    expect(placeSlot(s, 'a', 2, 'lunch').find((x) => x.candidate_id === 'a')).toEqual({ day: 2, part: 'lunch', candidate_id: 'a' });
    expect(removeSlot(s, 'a')).toHaveLength(2);
    expect(sortSlots([{ day: 2, part: 'morning', candidate_id: 'x' }, ...s])[3]!.candidate_id).toBe('x');
  });
});

function renderConsult() {
  return render(
    <MemoryRouter initialEntries={['/trip-consult']}>
      <Routes>
        <Route path="/trip-consult" element={<TripConsultPage />} />
        <Route path="/planner/:planId/draft" element={<p>下書きの画面</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('旅行相談の流れ', () => {
  it('希望 → 確認 → 方面の比較 → 方面の詳細 → 下書き。旅行は最後の操作まで作らない', async () => {
    api.extractIntent.mockResolvedValue(EXTRACTION);
    api.compareAreas.mockResolvedValue({ origin: { query: '枚方', ...geo(34.8) }, retrieved_at: '2026-10-29T00:00:00+00:00',
      providers: { geocode: 'nominatim', route: null, lodging: null, crowd: null, destination_suggestions: null },
      areas: [areaRow('伊勢', 34.4), areaRow('福井', 36.0, 'likely_exceeds'), areaRow('滋賀', 35.0), areaRow('淡路島', null)] });
    api.searchNearby.mockResolvedValue({ query: '', category: 'sightseeing', radius_km: 10, base: null, total: 1,
      candidates: [{ id: 'sc1', provider: 'overpass', name: '伊勢神宮', category: 'attraction',
        location: { latitude: 34.45, longitude: 136.72, address: null }, retrieved_at: '2026-10-29T00:00:00+00:00',
        distance_m: 3000, within_radius: true, radius_guaranteed: true }] });
    api.createTripDraft.mockResolvedValue({ plan_id: 'p1', revision: 1, candidates: 2 });
    renderConsult();

    // 1. 希望を伝える: 文章が空なら先へ進めず理由を示す。要約は入力に追従する
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('行き先が決まっていなくても、相談から始められます');
    fireEvent.click(screen.getByTestId('consult-extract'));
    expect(await screen.findByRole('alert')).toHaveTextContent('希望の文章か、出発地を入力してください');
    fireEvent.click(screen.getByRole('button', { name: '例文を入れる' }));
    fireEvent.change(screen.getByLabelText('出発地'), { target: { value: '大阪府枚方市' } });
    expect(screen.getByTestId('brief-summary-出発地')).toHaveTextContent('大阪府枚方市');
    expect(screen.getByText(/まだ旅行も予約も作りません/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consult-extract'));
    await waitFor(() => expect(api.extractIntent).toHaveBeenCalledWith(expect.objectContaining({
      text: EXAMPLE_TEXT, origin: '大阪府枚方市' })));

    // 2. 確認: AI は未接続と書く。問いに答えるまで先へ進めない。個人的な理由は保存しないと示す
    expect(await screen.findByText(/AI の読み取りは未接続/)).toBeInTheDocument();
    expect(screen.getByTestId('review-personal')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('片道の時間が「希望」か「絶対条件」か');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '片道の時間の扱い' })).getByRole('radio', { name: /希望/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '宿泊費の範囲' })).getByRole('radio', { name: /全員の合計/ }));
    fireEvent.click(screen.getByTestId('review-confirm-origin'));
    expect(screen.queryByText(/片道の時間が「希望」か/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('consult-compare'));
    await waitFor(() => expect(api.compareAreas).toHaveBeenCalledWith({ origin: '枚方', areas: ['伊勢', '福井', '滋賀', '淡路島'],
      one_way_hours: 3, one_way_strength: 'preferred' }));

    // 3. 方面の比較: 最初の3件と「他の候補も見る」。未照会を値にしない。選ぶだけでは旅程にしない
    expect(await screen.findByTestId('area-row-伊勢')).toBeInTheDocument();
    expect(screen.queryByTestId('area-row-淡路島')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /他の候補も見る\(\+1\)/ }));
    expect(screen.getByTestId('area-row-淡路島')).toHaveTextContent('位置を照会できませんでした(未照会)');
    expect(screen.getByTestId('area-row-伊勢')).toHaveTextContent('実走行時間・高速料金は未照会');
    expect(screen.getByTestId('area-row-伊勢')).toHaveTextContent('料金・空室は未照会');
    expect(screen.getByTestId('area-limit-福井')).toHaveTextContent('⚠ 希望を超えそう');
    expect(screen.getByTestId('areas-provider-note')).toHaveTextContent('道路・宿・混み具合の提供元は未接続');
    expect(screen.queryByText(/点|スコア|相性/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'pin 3 滋賀' }));
    expect(screen.getByTestId('area-row-滋賀')).toHaveAttribute('data-selected', 'true');
    expect(api.createTripDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('area-open-伊勢'));

    // 4. 方面の詳細: 探す → 選ぶ → 何も選ばずに押すと理由を示す → 下書き
    expect(await screen.findByText('SELECTED AREA · 伊勢')).toBeInTheDocument();
    expect(screen.getByTestId('consult-results-idle')).toHaveTextContent('まだ探していません');
    fireEvent.click(screen.getByTestId('consult-create-draft'));
    expect(screen.getByText(/行きたい場所がまだ選ばれていません/)).toBeInTheDocument();
    expect(api.createTripDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('consult-category-quiet'));
    fireEvent.click(screen.getByTestId('consult-search'));
    await waitFor(() => expect(api.searchNearby).toHaveBeenCalledWith(expect.objectContaining({ category: 'quiet',
      latitude: 34.4, radius_km: 10 })));
    fireEvent.click(await screen.findByTestId('consult-pick-sc1'));
    expect(screen.getByTestId('consult-check-0')).toHaveTextContent('1件 選択');
    expect(screen.getByTestId('consult-check-1')).toHaveTextContent('未照会');
    fireEvent.change(screen.getByLabelText('見つけた記事・SNS の投稿を参考に足す'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: '出典として足す' }));
    expect(screen.getByText(/http:\/\/ か https:\/\//)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('見つけた記事・SNS の投稿を参考に足す'), { target: { value: 'https://example.com/ise' } });
    fireEvent.click(screen.getByRole('button', { name: '出典として足す' }));
    fireEvent.click(screen.getByTestId('consult-create-draft'));
    await waitFor(() => expect(api.createTripDraft).toHaveBeenCalled());
    const input = api.createTripDraft.mock.calls[0]![0];
    expect(input.area).toMatchObject({ name: '伊勢', latitude: 34.4, provider: 'nominatim' });
    expect(input.search_candidate_ids).toEqual(['sc1']);
    expect(input.source_urls).toEqual(['https://example.com/ise']);
    expect(input.intent).toMatchObject({ origin: '枚方', nights: 1, one_way_strength: 'preferred', budget_scope: 'total' });
    expect(input.intent.party_size).toBeNull(); // 確かめていない行は使わない
    expect(await screen.findByText('下書きの画面')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('tc.consult')).toBeNull();
  });

  it('入力の途中はこのタブで覚え、読み取りに失敗しても文章を失わない', async () => {
    api.extractIntent.mockRejectedValue(new Error('offline'));
    renderConsult();
    fireEvent.change(screen.getByLabelText('希望・事情'), { target: { value: '伊勢が候補' } });
    fireEvent.click(screen.getByTestId('consult-extract'));
    expect(await screen.findByRole('alert')).toHaveTextContent('文章は消えていません');
    expect(screen.getByLabelText('希望・事情')).toHaveValue('伊勢が候補');
    expect(loadState().brief.text).toBe('伊勢が候補');
  });
});

const DRAFT: TripDraft = {
  plan_id: 'p1', title: '伊勢・1泊2日の旅程案', revision: 3, can_edit: true,
  area: { name: '伊勢', latitude: 34.4, longitude: 136.7, provider: 'nominatim', retrieved_at: null },
  intent: { transport: 'car' }, nights: 1,
  days: [{ day: 1, label: '1日目', parts: [] }, { day: 2, label: '2日目', parts: [] }],
  slots: [{ day: 1, part: 'morning', candidate_id: 'a' }, { day: 1, part: 'morning', candidate_id: 'b' }],
  candidates: [
    { id: 'a', title: '伊勢神宮', category: 'attraction', latitude: 1, longitude: 1, provider: 'overpass', retrieved_at: null,
      source_url: null, source_kind: 'search', status: 'open' },
    { id: 'b', title: '二見浦', category: 'viewpoint', latitude: 1, longitude: 1, provider: 'overpass', retrieved_at: null,
      source_url: null, source_kind: 'search', status: 'open' },
    { id: 'c', title: '鳥羽の食堂', category: 'restaurant', latitude: 1, longitude: 1, provider: 'overpass', retrieved_at: null,
      source_url: null, source_kind: 'search', status: 'open' },
    { id: 'u', title: 'example.com', category: null, latitude: null, longitude: null, provider: null, retrieved_at: null,
      source_url: 'https://example.com/ise', source_kind: 'url', status: 'open' },
  ],
  committed_at: null,
  checklist: { places: { status: 'selected', count: 2 }, lodging: { status: 'not_connected' }, route: { status: 'not_connected' },
    hours: { status: 'date_pending' } },
};

function renderDraft() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/draft']}>
      <Routes>
        <Route path="/planner/:planId/draft" element={<TripDraftPage />} />
        <Route path="/planner/:planId" element={<p>旅程の画面</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('未確定の旅程の下書き', () => {
  it('未確定と示し、移動の区間・未照会を出し、並べ替え → 読み上げ → 元に戻す、日付を決めて旅程にする', async () => {
    api.getTripDraft.mockResolvedValue(DRAFT);
    api.updateDraftSlots.mockImplementation(async (_p: string, slots: TripDraft['slots'], rev: number) => ({ ...DRAFT, slots, revision: rev + 1 }));
    api.commitTripDraft.mockResolvedValue({ plan_id: 'p1', revision: 6, events: 2, days: [] });
    renderDraft();
    expect(await screen.findByTestId('draft-banner')).toHaveTextContent('旅程ドラフト · まだ確定していません');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('伊勢・1泊2日の旅程案');
    expect(screen.getByTestId('draft-segment')).toHaveTextContent('自家用車 · 経路・所要時間は未照会');
    expect(screen.getByTestId('draft-validation')).toHaveTextContent('未照会(道路の提供元が未接続)');
    expect(screen.getByRole('tab', { name: /1日目/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('参考の出典(場所は未確認 · 候補箱で確かめる)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '二見浦を上へ' }));
    await waitFor(() => expect(api.updateDraftSlots).toHaveBeenCalledWith('p1', [
      { day: 1, part: 'morning', candidate_id: 'b' }, { day: 1, part: 'morning', candidate_id: 'a' }], 3));
    expect(screen.getByTestId('draft-live')).toHaveTextContent('二見浦を上へ移しました。移動時間と営業時間は未照会のままです');
    fireEvent.click(screen.getByTestId('draft-undo'));
    await waitFor(() => expect(api.updateDraftSlots).toHaveBeenLastCalledWith('p1', DRAFT.slots, 4));
    expect(screen.getByTestId('draft-live')).toHaveTextContent('前の並びに戻しました');

    fireEvent.click(screen.getByRole('button', { name: /鳥羽の食堂 を1日目の午後へ/ }));
    await waitFor(() => expect(api.updateDraftSlots).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole('tab', { name: '全日程を横断で見る' }));
    expect(screen.getByTestId('draft-all-days')).toHaveTextContent('1日目');
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'この日を編集 →' })[1]!); });
    expect(screen.getByRole('tab', { name: /2日目/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.change(screen.getByLabelText('初日'), { target: { value: '2026-11-28' } });
    fireEvent.click(screen.getByTestId('draft-commit'));
    await waitFor(() => expect(api.commitTripDraft).toHaveBeenCalledWith('p1', '2026-11-28', 'Asia/Tokyo', 6));
    expect(await screen.findByText('旅程の画面')).toBeInTheDocument();
  });

  it('旅程にした後・閲覧だけの人は並べ替えられない。旅行相談の下書きでなければ知らせる', async () => {
    api.getTripDraft.mockResolvedValueOnce({ ...DRAFT, committed_at: '2026-10-29T00:00:00+00:00' });
    const { unmount } = renderDraft();
    expect(await screen.findByTestId('draft-banner')).toHaveTextContent('旅程にしました');
    expect(screen.queryByRole('button', { name: '二見浦を上へ' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('draft-commit')).not.toBeInTheDocument();
    unmount();
    api.getTripDraft.mockRejectedValueOnce({ response: { status: 404 } });
    renderDraft();
    expect(await screen.findByRole('alert')).toHaveTextContent('この下書きは見つかりません');
  });
});
