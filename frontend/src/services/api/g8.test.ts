/** [Gate G8] 応答の decoder(実 backend の応答を受理し、形が違えば ApiDecodeError)と API の呼び方(URL・本文・If-Match)。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fx from './__fixtures__/g8Responses.json';
import { ApiDecodeError, decodeResponse } from './decode';
import { branchDetail } from './decoders';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./index', () => ({ api }));

import { decodeG8 } from './decodersG8';
import {
  acceptOwnershipTransfer, adoptBranchG8, branchExtras, cancelOwnershipTransfer, createCorrection,
  createCorrectionRequest, declineOwnershipTransfer, getAdoptionPreview, getCorrections, getIncomingTransfers,
  getOpsJobs, getOwnership, listCorrectionRequests, requestOwnershipTransfer, resolveCorrectionRequest,
  revertCorrection, saveBranchWithResources,
} from './g8';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('decodersG8 (実 backend の応答)', () => {
  it('分岐案の区間・予約の変更を読み、以前の decoder でも詳細を読める', () => {
    const detail = decodeResponse(fx.branch_detail_resources, branchDetail, 'x');
    expect(detail.ops.length).toBe(2);
    const x = branchExtras(fx.branch_detail_resources);
    expect(x.resources.algorithm_version).toBe('branch-v2');
    expect(x.resources.base_segments[0]!.mode).toBe('driving');
    expect(x.resources.segments.map((s) => s.op)).toEqual(['remove', 'add']);
    expect(x.resources.reservations[0]).toMatchObject({ op: 'cancel', note: '雨' });
    expect(x.resource_summary).toEqual({ segments_added: 1, segments_removed: 1, segments_updated: 0,
      reservations_relinked: 0, reservations_cancel_planned: 1 });
    // 項目の無い以前の応答は空として読む
    const old = branchExtras({});
    expect(old.resources.segments).toEqual([]);
    expect(old.resource_summary.segments_added).toBe(0);
    expect(() => branchExtras({ resources: { ...fx.branch_detail_resources.resources, segments: [{ op: 'fly' }] } }))
      .toThrow(ApiDecodeError);
  });

  it('採用の前の確かめ・採用・移譲・訂正・定期の処理を受理する', () => {
    const p = decodeG8('preview', fx.adoption_preview);
    expect(p.can_adopt).toBe(true);
    expect(p.items.find((i) => i.op_id === 'segment:add:walk-1')!.requires).toEqual(['event:add:new-sake']);
    expect(p.tasks[0]!.title).toBe('予約の取消の手続き: 酒蔵見学');
    const partial = decodeG8('preview', fx.adoption_preview_partial);
    expect(partial.missing_dependencies.length).toBe(1);
    expect(partial.can_adopt).toBe(false);
    const a = decodeG8('adopt', fx.adopt_result);
    expect(a.tasks_created).toBe(1);
    expect(decodeG8('adopt', { plan_revision: 3 }).left_out).toEqual([]);
    expect(decodeG8('ownershipInfo', fx.ownership_info_owner).candidates.length).toBe(1);
    expect(decodeG8('ownershipInfo', fx.ownership_info_pending).pending!.status).toBe('pending');
    expect(decodeG8('transfers', fx.ownership_incoming)[0]!.plan_title).toBe('移譲');
    expect(decodeG8('transfer', fx.ownership_accepted).status).toBe('accepted');
    const c = decodeG8('corrections', fx.corrections_list);
    expect(c.history[0]!.after).toBe('訂正後の名前');
    expect(c.fields.find((f) => f.field === 'email')!.requires_password).toBe(true);
    expect(decodeG8('correctionRequests', fx.correction_requests_owner)[0]!.requester_name).toBeTruthy();
    expect(decodeG8('correctionRequest', fx.correction_request_resolved).status).toBe('declined');
    const jobs = decodeG8('opsJobs', fx.admin_jobs);
    expect(jobs.jobs.map((j) => j.job)).toContain('account-deletions');
    expect(() => decodeG8('opsJobs', { jobs: [{ ...fx.admin_jobs.jobs[0], state: 'great' }], attention: [] }))
      .toThrow(ApiDecodeError);
  });
});

describe('g8 の API の呼び方', () => {
  it('分岐: 予定と変更を一緒に保存・確かめ・選んで採用', async () => {
    api.put.mockResolvedValue({ data: fx.branch_detail_resources });
    await saveBranchWithResources('p1', 'b1', [], { segments: [], reservations: [] }, 7);
    expect(api.put).toHaveBeenCalledWith('/plans/p1/branches/b1/content', { events: [], resources: { segments: [], reservations: [] } },
      expect.objectContaining({ headers: { 'If-Match': '7' }, skipGlobalErrorHandler: true }));
    api.get.mockResolvedValue({ data: fx.adoption_preview });
    await getAdoptionPreview('p1', 'b1', ['a', 'b']);
    expect(api.get).toHaveBeenLastCalledWith('/plans/p1/branches/b1/adoption-preview',
      expect.objectContaining({ params: { only: 'a,b' } }));
    await getAdoptionPreview('p1', 'b1');
    expect(api.get).toHaveBeenLastCalledWith('/plans/p1/branches/b1/adoption-preview', expect.objectContaining({ params: undefined }));
    api.post.mockResolvedValue({ data: fx.adopt_result });
    const r = await adoptBranchG8('p1', 'b1', 8, ['x']);
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/branches/b1/adopt', { only: ['x'] }, expect.objectContaining({ headers: { 'If-Match': '8' } }));
    expect(r.raw).toBe(fx.adopt_result.branch);
    await adoptBranchG8('p1', 'b1', 8, null);
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/branches/b1/adopt', undefined, expect.anything());
  });

  it('移譲・訂正・定期の処理', async () => {
    api.get.mockResolvedValueOnce({ data: fx.ownership_info_owner });
    await getOwnership('p1');
    expect(api.get).toHaveBeenLastCalledWith('/plans/p1/ownership-transfer', expect.anything());
    api.post.mockResolvedValue({ data: fx.ownership_created });
    await requestOwnershipTransfer('p1', 'c1', 'pw', 'viewer', 'よろしく');
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/ownership-transfer',
      { collaborator_id: 'c1', password: 'pw', keep_role: 'viewer', message: 'よろしく' }, expect.anything());
    await cancelOwnershipTransfer('p1');
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/ownership-transfer/cancel', null, expect.anything());
    await acceptOwnershipTransfer('t1', 'pw');
    expect(api.post).toHaveBeenLastCalledWith('/ownership-transfers/t1/accept', { password: 'pw' }, expect.anything());
    await declineOwnershipTransfer('t1');
    expect(api.post).toHaveBeenLastCalledWith('/ownership-transfers/t1/decline', null, expect.anything());
    api.get.mockResolvedValueOnce({ data: fx.ownership_incoming });
    expect((await getIncomingTransfers()).length).toBe(1);
    api.get.mockResolvedValueOnce({ data: fx.corrections_list });
    await getCorrections();
    api.post.mockResolvedValue({ data: fx.corrections_self_created });
    await createCorrection({ field: 'username', value: 'A', source: 'other' });
    expect(api.post).toHaveBeenLastCalledWith('/privacy/corrections', { field: 'username', value: 'A', source: 'other' }, expect.anything());
    await revertCorrection('c9');
    expect(api.post).toHaveBeenLastCalledWith('/privacy/corrections/c9/revert', {}, expect.anything());
    await revertCorrection('c9', 'pw');
    expect(api.post).toHaveBeenLastCalledWith('/privacy/corrections/c9/revert', { password: 'pw' }, expect.anything());
    api.post.mockResolvedValue({ data: fx.correction_request_created });
    await createCorrectionRequest('p1', { field_label: '名義', proposed_value: 'B', source: 'booking_document' });
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/correction-requests',
      { field_label: '名義', proposed_value: 'B', source: 'booking_document' }, expect.anything());
    api.post.mockResolvedValue({ data: fx.correction_request_resolved });
    await resolveCorrectionRequest('p1', 'r1', 'declined', '確認できず');
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/correction-requests/r1/resolve',
      { status: 'declined', note: '確認できず' }, expect.anything());
    api.get.mockResolvedValueOnce({ data: fx.correction_requests_owner });
    await listCorrectionRequests('p1');
    api.get.mockResolvedValueOnce({ data: fx.admin_jobs });
    expect((await getOpsJobs()).jobs.length).toBeGreaterThan(5);
    expect(api.get).toHaveBeenLastCalledWith('/admin/ops/jobs', expect.anything());
  });
});
