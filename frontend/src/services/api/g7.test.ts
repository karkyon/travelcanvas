/** [Gate G7] 応答の decoder(実 backend の応答を受理し、形が違えば ApiDecodeError)と API の呼び方(URL・パラメータ)。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fx from './__fixtures__/g7Responses.json';
import { decodeResponse } from './decode';
import { accountDeletionPreview, memoryReplanResult, normalizedEvent, travelSegment, validationRunDetail } from './decoders';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./index', () => ({ api }));

import { decodeG7 } from './decodersG7';
import {
  applyCandidateG7, cancelAccountDeletion, compareBranches, deletionExtras, getCandidatesG7, getMemoryReplanG7,
  getMovementSettings, previewEventImpact, previewPartial, runMovement, saveMovementSettings, scheduleAccountDeletion,
} from './g7';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('decodersG7 (実 backend の応答)', () => {
  it('移動の既定・日ごとの疲れ・影響のプレビューを受理する', () => {
    const s = decodeG7('movementSettings', fx.movement_settings);
    expect(s.is_default).toBe(true);
    expect(s.effective?.stay_minutes.sightseeing).toBe(60);
    expect(decodeG7('movementSettings', fx.movement_settings_saved).effective?.max_continuous_minutes).toBe(120);
    const run = runMovement(fx.validation_run_movement);
    expect(run.day_metrics[0]!.estimated).toBe(true);
    // 以前の decoder でも読める(項目を足しても壊さない)
    expect(decodeResponse(fx.validation_run_movement, validationRunDetail, 'x').algorithm_version).toBe('feasibility-v2');
    expect(runMovement({}).day_metrics).toEqual([]);
    const impact = decodeG7('impact', fx.impact_preview);
    expect(impact.end_day_offset).toBe(1);
    expect(impact.new_issues.length).toBeGreaterThan(0);
  });

  it('日をまたぐ予定・最終の便を以前の decoder で読める', () => {
    const ev = decodeResponse(fx.event_cross_day, normalizedEvent, 'x') as unknown as Record<string, unknown>;
    expect(ev.local_end_time).toBe('06:10');
    expect(ev.end_day_offset).toBe(1);
    const seg = decodeResponse(fx.segment_last_departure, travelSegment, 'x') as unknown as Record<string, unknown>;
    expect(String(seg.last_departure_at)).toContain('2026-11-21T12:40');
  });

  it('目的の内訳・条件に合わせた案・一部だけの確認を受理する', () => {
    const c = decodeG7('candidates', fx.optimization_g7);
    expect(c.current.objective.terms.map((t) => t.key)).toEqual(['distance', 'constraints', 'fatigue', 'fairness']);
    expect(c.weights_given).toBe(false);
    const w = decodeG7('candidates', fx.optimization_g7_weighted);
    expect(w.candidates.some((x) => x.kinds.includes('balanced'))).toBe(true);
    expect(decodeG7('partial', fx.optimization_partial).event_ids).toHaveLength(1);
    expect(decodeG7('apply', fx.optimization_apply_partial).changed).toBeGreaterThan(0);
  });

  it('比較・思い出からの提案(v2)・猶予つきの削除を受理する', () => {
    const cmp = decodeG7('comparison', fx.branch_comparison);
    expect(cmp.branches).toHaveLength(2);
    expect(cmp.branches[0]!.budget_target?.[0]!.met).toBe(true);
    const mr = decodeG7('memoryReplan', fx.memory_replan_v2);
    expect(mr.proposals.find((p) => p.kind === 'slow_transport')?.target).toBe('segment');
    expect(mr.insights.find((i) => i.kind === 'slow_transport')?.basis).toBe('same_party');
    // 以前の decoder も新しい種類を拒まない(画面は v2 を使う)
    expect(decodeResponse(fx.memory_replan_v2, memoryReplanResult, 'x').insights.length).toBeGreaterThan(0);
    expect(decodeG7('schedule', fx.deletion_scheduled).scheduled?.due_at).toBeTruthy();
    expect(decodeG7('schedule', fx.deletion_cancelled).scheduled).toBeNull();
    const pre = decodeResponse(fx.deletion_preview_scheduled, accountDeletionPreview, 'x');
    const extra = deletionExtras(pre);
    expect(extra.can_schedule).toBe(true);
    expect(extra.scheduled?.due_at).toBeTruthy();
    expect(extra.account_delete_grace_days).toBe(14);
  });

  it('形が違えば受理しない', () => {
    expect(() => decodeG7('movementSettings', { ...fx.movement_settings, revision: -1 })).toThrow();
    expect(() => decodeG7('candidates', { ...fx.optimization_g7_weighted, weights_given: 'yes' })).toThrow();
    const bad = { ...fx.memory_replan_v2, proposals: [{ ...fx.memory_replan_v2.proposals[0], changes: [{ segment_id: 'x' }] }] };
    expect(() => decodeG7('memoryReplan', bad)).toThrow();
    expect(() => runMovement({ day_metrics: [{ day_id: 1 }] })).toThrow();
  });
});

describe('g7 API', () => {
  it('URL・パラメータ・If-Match・共通の toast を出さない指定', async () => {
    api.get.mockResolvedValueOnce({ data: fx.movement_settings });
    await getMovementSettings('p1');
    expect(api.get).toHaveBeenCalledWith('/plans/p1/movement-settings', expect.objectContaining({ skipGlobalErrorHandler: true }));
    api.put.mockResolvedValueOnce({ data: fx.movement_settings_saved });
    await saveMovementSettings('p1', { pace: 'relaxed' }, 0);
    expect(api.put).toHaveBeenCalledWith('/plans/p1/movement-settings', { settings: { pace: 'relaxed' } },
      expect.objectContaining({ headers: { 'If-Match': '0' } }));
    api.post.mockResolvedValueOnce({ data: fx.impact_preview });
    await previewEventImpact('p1', 'e1', { local_start_time: '10:00' });
    expect(api.post).toHaveBeenCalledWith('/plans/p1/events/e1/impact-preview', { local_start_time: '10:00' }, expect.anything());
    api.post.mockResolvedValueOnce({ data: fx.optimization_g7_weighted });
    await getCandidatesG7('p1', 'd1', 'walking', { distance: 5, constraints: 1, fatigue: 0, fairness: 0 });
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/days/d1/optimization-candidates',
      { travel_mode: 'walking', weights: { distance: 5, constraints: 1, fatigue: 0, fairness: 0 } }, expect.anything());
    api.post.mockResolvedValueOnce({ data: fx.optimization_partial });
    await previewPartial('p1', 'd1', 'c1', ['e1'], 'fp', 'walking', null);
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/days/d1/optimization-candidates/partial-preview',
      { candidate_id: 'c1', event_ids: ['e1'], input_fingerprint: 'fp', travel_mode: 'walking' }, expect.anything());
    api.post.mockResolvedValueOnce({ data: fx.optimization_apply_partial });
    await applyCandidateG7('p1', 'd1', 'c1', 'fp', 7, 'walking', null, ['e1']);
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/days/d1/optimization-candidates/apply',
      { candidate_id: 'c1', input_fingerprint: 'fp', travel_mode: 'walking', event_ids: ['e1'] },
      expect.objectContaining({ headers: { 'If-Match': '7' } }));
    api.get.mockResolvedValueOnce({ data: fx.branch_comparison });
    await compareBranches('p1', ['b1', 'b2']);
    expect(api.get).toHaveBeenLastCalledWith('/plans/p1/branches-comparison',
      expect.objectContaining({ params: { ids: 'b1,b2' } }));
    api.get.mockResolvedValueOnce({ data: fx.memory_replan_v2 });
    await getMemoryReplanG7('p1');
    expect(api.get).toHaveBeenLastCalledWith('/plans/p1/memory-replan', expect.anything());
    api.post.mockResolvedValueOnce({ data: fx.deletion_scheduled });
    await scheduleAccountDeletion('退会する', 'pw');
    expect(api.post).toHaveBeenLastCalledWith('/privacy/account-deletion/schedule',
      { confirmation: '退会する', password: 'pw' }, expect.anything());
    api.post.mockResolvedValueOnce({ data: fx.deletion_cancelled });
    await cancelAccountDeletion();
    expect(api.post).toHaveBeenLastCalledWith('/privacy/account-deletion/cancel', null, expect.anything());
  });
});
