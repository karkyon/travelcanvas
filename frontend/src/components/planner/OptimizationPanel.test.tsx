/**
 * [Gate L4] OptimizationPanel(SC-16 説明可能な最適化)の画面テスト。
 * - 候補の計算: 今の順との比較表、理由、変わる予定、解消する問題、動かさない予定
 * - 適用: 確認→入力の版(input_fingerprint)と本案のrevisionを送る→プランを読み直す→元に戻す
 * - 閲覧者は適用できない。409は理由を表示する
 * [Gate G7] MOVE-04 目的の内訳・条件を変える(重み)・選んだ予定だけの確認と適用(実 backend の応答 g7Responses.json)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import g7 from '@/services/api/__fixtures__/g7Responses.json';
import { decodeG7 } from '@/services/api/decodersG7';
import type { G7Candidates } from '@/services/api/types/g7';
import type { TravelPlan } from '@/types';

const m = vi.hoisted(() => ({
  getOptimizationCandidates: vi.fn(),
  applyOptimizationCandidate: vi.fn(),
  previewPartial: vi.fn(),
  loadPlan: vi.fn(),
  undoLastChange: vi.fn(),
}));

vi.mock('../../services/api/g7', () => ({
  getCandidatesG7: m.getOptimizationCandidates,
  applyCandidateG7: m.applyOptimizationCandidate,
  previewPartial: m.previewPartial,
}));
vi.mock('../../store/planStore', () => ({
  usePlanStore: { getState: () => ({ loadPlan: m.loadPlan, undoLastChange: m.undoLastChange }) },
}));

import OptimizationPanel from './OptimizationPanel';

const data = decodeG7('candidates', g7.optimization_g7) as G7Candidates;
const weighted = decodeG7('candidates', g7.optimization_g7_weighted) as G7Candidates;
const plan = { id: data.plan_id, days: [{ id: data.day_id }] } as unknown as TravelPlan;

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getOptimizationCandidates.mockResolvedValue(data);
  m.applyOptimizationCandidate.mockResolvedValue(g7.optimization_apply_partial);
  m.previewPartial.mockResolvedValue(decodeG7('partial', g7.optimization_partial));
  m.loadPlan.mockResolvedValue(undefined);
  window.confirm = vi.fn(() => true);
});

async function open() {
  render(<OptimizationPanel plan={plan} dayIndex={0} />);
  fireEvent.click(screen.getByRole('button', { name: /この日の並べ替え/ }));
  fireEvent.click(screen.getByRole('button', { name: '並べ替え候補を計算する' }));
  await waitFor(() => expect(m.getOptimizationCandidates).toHaveBeenCalledWith(data.plan_id, data.day_id, 'walking', null));
  // 計算が終わる(ボタンが読み込み中の表示から戻る)まで待つ
  await screen.findByRole('button', { name: '並べ替え候補を計算する' });
}

describe('OptimizationPanel (Gate L4)', () => {
  it('候補ごとに今の順との比較・理由・変わる予定・解消する問題を示す', async () => {
    await open();
    const best = screen.getByRole('region', { name: '制約・検証を優先した案' });
    expect(within(best).getByRole('table')).toHaveTextContent('守れていない制約1件0件改善');
    expect(within(best).getByRole('list', { name: '制約・検証を優先した案の理由' })).toHaveTextContent('守れていない制約が1件減ります');
    expect(best).toHaveTextContent('解消する問題');
    expect(best).toHaveTextContent('地点C:');
    expect(screen.getByRole('region', { name: '移動が最短の案' })).toHaveTextContent('移動距離が約');
  });

  it('適用は確認のうえ入力の版とrevisionを送り、プランを読み直す。元に戻せる', async () => {
    await open();
    const best = data.candidates.find((c) => c.kinds.includes('constraints'))!;
    fireEvent.click(screen.getByRole('button', { name: `「${best.label}」を適用` }));
    await waitFor(() => expect(m.applyOptimizationCandidate).toHaveBeenCalledWith(
      data.plan_id, data.day_id, best.id, data.input_fingerprint, data.base_revision, data.travel_mode, null, null));
    await waitFor(() => expect(m.loadPlan).toHaveBeenCalledWith(data.plan_id));
    expect(await screen.findByText(/を適用しました/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '直前の変更を取り消す' }));
    await waitFor(() => expect(m.undoLastChange).toHaveBeenCalled());
  });

  it('確認で取り消すと適用しない。409は理由を表示する', async () => {
    await open();
    window.confirm = vi.fn(() => false);
    const first = data.candidates[0]!;
    fireEvent.click(screen.getByRole('button', { name: `「${first.label}」を適用` }));
    expect(m.applyOptimizationCandidate).not.toHaveBeenCalled();
    window.confirm = vi.fn(() => true);
    m.applyOptimizationCandidate.mockRejectedValue({ response: { status: 409, data: fx.optimization_stale_error } });
    fireEvent.click(screen.getByRole('button', { name: `「${first.label}」を適用` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('もう一度候補を計算してください');
  });

  it('閲覧者は適用できない。候補が無い時は注意を示す', async () => {
    m.getOptimizationCandidates.mockResolvedValue({ ...data, can_apply: false });
    await open();
    expect(screen.queryByRole('button', { name: /を適用/ })).not.toBeInTheDocument();
    m.getOptimizationCandidates.mockResolvedValue({ ...data, candidates: [], warnings: ['今の順番より良い候補は見つかりませんでした'] });
    fireEvent.click(screen.getByRole('button', { name: '並べ替え候補を計算する' }));
    expect(await screen.findByRole('list', { name: '並べ替えの注意' })).toHaveTextContent('今の順番より良い候補は見つかりませんでした');
  });
});

describe('OptimizationPanel (Gate G7 MOVE-04)', () => {
  it('案ごとに目的の内訳(値・重み・点と合計)を示す', async () => {
    await open();
    const best = screen.getByRole('region', { name: '制約・検証を優先した案' });
    const list = within(best).getByRole('list', { name: '制約・検証を優先した案の目的の内訳' });
    expect(list).toHaveTextContent('移動距離');
    expect(list).toHaveTextContent('検証・制約');
    expect(list).toHaveTextContent('合計');
    expect(within(best).getByRole('table')).toHaveTextContent('疲れの目安');
  });

  it('条件を変えて計算すると重みを送り、条件に合わせた案が加わる', async () => {
    await open();
    m.getOptimizationCandidates.mockResolvedValue(weighted);
    fireEvent.click(screen.getByRole('button', { name: /条件を変える/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '移動距離' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'この条件で計算する' }));
    await waitFor(() => expect(m.getOptimizationCandidates).toHaveBeenLastCalledWith(
      data.plan_id, data.day_id, 'walking', { distance: 5, constraints: 3, fatigue: 1, fairness: 1 }));
    expect(await screen.findByRole('region', { name: /条件に合わせた案/ })).toBeInTheDocument();
  });

  it('選んだ予定だけを確かめてから適用する(event_ids を送る)', async () => {
    await open();
    const first = data.candidates[0]!;
    const region = screen.getByRole('region', { name: first.label });
    const change = first.changes[0]!;
    fireEvent.click(within(region).getAllByRole('checkbox')[0]!);
    fireEvent.click(within(region).getByRole('button', { name: /選んだ1件だけ動かした結果を確かめる/ }));
    await waitFor(() => expect(m.previewPartial).toHaveBeenCalledWith(
      data.plan_id, data.day_id, first.id, [change.event_id], data.input_fingerprint, data.travel_mode, null));
    fireEvent.click(await within(region).findByRole('button', { name: '選んだ予定だけ適用' }));
    await waitFor(() => expect(m.applyOptimizationCandidate).toHaveBeenCalledWith(
      data.plan_id, data.day_id, first.id, data.input_fingerprint, data.base_revision, data.travel_mode, null,
      [change.event_id]));
    expect(await screen.findByText(/のうち1件を適用しました/)).toBeInTheDocument();
  });
});
