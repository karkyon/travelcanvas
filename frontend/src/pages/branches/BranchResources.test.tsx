/** [Gate G8] FR-019 案の中の区間・予約の変更(規則・編集の画面)と、選んで採用する画面。 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/g8Responses.json';
import type { BranchEventItem } from '@/services/api';
import type { AdoptionPreview, BranchResources, ResourcesInput } from '@/services/api/types/g8';

const g8 = vi.hoisted(() => ({ getAdoptionPreview: vi.fn() }));
vi.mock('@/services/api/g8', () => g8);

import BranchResourcesPanel from './BranchResourcesPanel';
import AdoptionDialog from './AdoptionDialog';
import {
  addSegment, emptyResources, liveEvents, pendingRelations, removeAddedSegment, setReservationOp, setSegmentField,
  toggleSegmentRemove, validateResources,
} from './resourcesModel';

const res = fx.branch_detail_resources.resources as unknown as BranchResources;
const seg = res.base_segments[0]!;
const rsv = res.base_reservations[0]!;
const A = seg.from_event_id!; // 藤居本家
const B = seg.to_event_id!; // 岡村本家(予約が付く)

const item = (over: Partial<BranchEventItem>): BranchEventItem => ({
  key: over.source_event_id ?? 'k', source_event_id: null, day_id: 'd1', title: '', event_type: 'sightseeing',
  local_start_time: null, is_all_day: false, sort_order: 0, locked: false, removed: false, note: null, ...over,
});
const baseItems = [item({ source_event_id: A, title: '藤居本家' }), item({ source_event_id: B, title: '岡村本家', sort_order: 1 })];
const titles = new Map([[A, '藤居本家'], [B, '岡村本家']]);
const base = { segments: res.base_segments, reservations: res.base_reservations };

describe('resourcesModel', () => {
  it('区間: 本案と同じ値に戻すと送らない・外す/戻す・足す/取り消す', () => {
    let v = setSegmentField(emptyResources(), seg, 'mode', 'walking');
    expect(v.segments).toEqual([{ op: 'update', segment_id: seg.id, fields: { mode: 'walking' } }]);
    v = setSegmentField(v, seg, 'duration_minutes', 15);
    expect(v.segments[0]).toMatchObject({ fields: { mode: 'walking' } });
    v = setSegmentField(v, seg, 'mode', 'driving');
    expect(v.segments).toEqual([]);
    v = toggleSegmentRemove(v, seg);
    expect(v.segments).toEqual([{ op: 'remove', segment_id: seg.id }]);
    expect(toggleSegmentRemove(v, seg).segments).toEqual([]);
    v = addSegment(emptyResources(), { event: A }, { event: B }, 'bus', 10);
    const added = v.segments[0]!;
    expect(added).toMatchObject({ op: 'add', fields: { from: { event: A }, to: { event: B }, mode: 'bus', duration_minutes: 10 } });
    expect(removeAddedSegment(v, (added as { key: string }).key).segments).toEqual([]);
  });

  it('確かめ: 外す予定へつながる区間の変更・同じ予定どうし・費用だけ・残らない付け替え先は止める', () => {
    const removedB = [baseItems[0]!, { ...baseItems[1]!, removed: true }];
    expect(validateResources(setSegmentField(emptyResources(), seg, 'mode', 'bus'), removedB, base))
      .toEqual({ ok: false, error: '外す予定につながる区間は、変えずに「外す」にしてください' });
    expect(validateResources(addSegment(emptyResources(), { event: A }, { event: A }, 'bus', null), baseItems, base).ok).toBe(false);
    expect(validateResources(addSegment(emptyResources(), { event: A }, { event: B }, 'bus', null), removedB, base).ok).toBe(false);
    const noCur = setSegmentField(setSegmentField(emptyResources(), seg, 'currency', null), seg, 'cost', '100');
    expect(validateResources(noCur, baseItems, base)).toEqual({ ok: false, error: '区間の費用と通貨は一緒に入れてください' });
    const relink = setReservationOp(emptyResources(), rsv.id, { op: 'relink', reservation_id: rsv.id, to: { event: B } });
    expect(validateResources(relink, removedB, base).ok).toBe(false);
    expect(validateResources(relink, baseItems, base)).toEqual({ ok: true });
    // 外す予定に付いた区間・予約は扱いを決めるまで残る
    expect(pendingRelations(emptyResources(), removedB, base)).toEqual({ segments: [seg], reservations: [rsv] });
    const decided = setReservationOp(toggleSegmentRemove(emptyResources(), seg), rsv.id, { op: 'cancel', reservation_id: rsv.id, note: null });
    expect(pendingRelations(decided, removedB, base)).toEqual({ segments: [], reservations: [] });
    expect(liveEvents([...removedB, item({ key: 'new', title: '喜多酒造' })]).map((e) => e.label))
      .toEqual(['藤居本家', '喜多酒造(この案で追加)']);
  });
});

function Harness({ items, resources = res, editable = true, spy }: {
  items: BranchEventItem[]; resources?: BranchResources; editable?: boolean; spy?: (v: ResourcesInput) => void;
}) {
  const [value, setValue] = useState<ResourcesInput>(emptyResources());
  return (
    <BranchResourcesPanel resources={resources} value={value} items={items} baseTitles={titles} editable={editable}
      onChange={(v) => { setValue(v); spy?.(v); }} />
  );
}

describe('BranchResourcesPanel', () => {
  it('予定を外すと、付いた区間・予約の扱いを促し、外す・取り消す予定にすると消える', () => {
    const spy = vi.fn();
    render(<Harness items={[baseItems[0]!, { ...baseItems[1]!, removed: true }]} spy={spy} />);
    expect(screen.getByTestId('branch-resources-pending')).toHaveTextContent('区間1件・予約1件の扱いを決めてください');
    const s = screen.getByTestId(`branch-segment-${seg.id}`);
    expect(within(s).getByLabelText('移動手段')).toBeDisabled();
    expect(s).toHaveTextContent('藤居本家 → 岡村本家(車・15分)');
    fireEvent.click(within(s).getByRole('button', { name: '藤居本家 → 岡村本家(車・15分)を外す' }));
    const r = screen.getByTestId(`branch-reservation-${rsv.id}`);
    fireEvent.click(within(r).getByLabelText('取り消す予定にする'));
    expect(r).toHaveTextContent('予約先では取り消されません');
    expect(within(r).getByLabelText('付け替え先')).toBeDisabled();
    expect(screen.queryByTestId('branch-resources-pending')).toBeNull();
    expect(spy).toHaveBeenLastCalledWith({ segments: [{ op: 'remove', segment_id: seg.id }],
      reservations: [{ op: 'cancel', reservation_id: rsv.id, note: null }] });
  });

  it('区間を変える・足す、予約を付け替える(費用を入れると通貨も付ける)', () => {
    const spy = vi.fn();
    render(<Harness items={[...baseItems, item({ key: 'new-sake', title: '喜多酒造', sort_order: 2 })]} spy={spy} />);
    const s = screen.getByTestId(`branch-segment-${seg.id}`);
    fireEvent.change(within(s).getByLabelText('移動手段'), { target: { value: 'taxi' } });
    fireEvent.change(within(s).getByLabelText('費用'), { target: { value: '800' } });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({
      segments: [{ op: 'update', segment_id: seg.id, fields: { mode: 'taxi', cost: '800' } }] }));
    const add = screen.getByRole('group', { name: '区間を足す' });
    const button = within(add).getByRole('button', { name: 'この区間を足す' });
    expect(button).toBeDisabled();
    fireEvent.change(within(add).getByLabelText('出発の予定'), { target: { value: A } });
    fireEvent.change(within(add).getByLabelText('到着の予定'), { target: { value: 'new-sake' } });
    fireEvent.change(within(add).getByLabelText('所要時間(分・空なら概算)'), { target: { value: '12' } });
    fireEvent.click(button);
    expect(screen.getByText('追加: 藤居本家 → 喜多酒造(徒歩・12分)')).toBeInTheDocument();
    const r = screen.getByTestId(`branch-reservation-${rsv.id}`);
    fireEvent.change(within(r).getByLabelText('付け替え先'), { target: { value: 'new-sake' } });
    const last = spy.mock.lastCall![0] as ResourcesInput;
    expect(last.reservations).toEqual([{ op: 'relink', reservation_id: rsv.id, to: { key: 'new-sake' } }]);
    expect(last.segments.filter((x) => x.op === 'add')).toHaveLength(1);
    fireEvent.change(within(r).getByLabelText('付け替え先'), { target: { value: '__none__' } });
    expect((spy.mock.lastCall![0] as ResourcesInput).reservations).toEqual([{ op: 'relink', reservation_id: rsv.id, to: null }]);
  });

  it('見せない設定では費用・予約を出さず、編集できない時は操作を出さない。確定した紐付けは変えられない', () => {
    const { unmount } = render(<Harness items={baseItems} resources={{ ...res, costs_hidden: true, reservations_hidden: true }} />);
    expect(screen.queryByLabelText('費用')).toBeNull();
    expect(screen.getByText('予約は見せない設定のため表示していません。')).toBeInTheDocument();
    unmount();
    render(<Harness items={baseItems} editable={false}
      resources={{ ...res, base_reservations: [{ ...rsv, locked: true }] }} />);
    expect(screen.queryByRole('group', { name: '区間を足す' })).toBeNull();
    expect(screen.queryByRole('button', { name: /を外す$/ })).toBeNull();
    const r = screen.getByTestId(`branch-reservation-${rsv.id}`);
    expect(r).toHaveTextContent('確定した紐付け');
    expect(within(r).getByLabelText('取り消す予定にする')).toBeDisabled();
  });
});

describe('AdoptionDialog', () => {
  const full = fx.adoption_preview as AdoptionPreview;
  const partial = fx.adoption_preview_partial as AdoptionPreview;
  beforeEach(() => g8.getAdoptionPreview.mockReset());

  it('すべて採用・作る準備を見せ、選びを外すと頼る変更の不足で止める。選んだ分だけ採用する', async () => {
    g8.getAdoptionPreview.mockResolvedValueOnce(full);
    const onAdopt = vi.fn();
    render(<AdoptionDialog planId="p1" branchId="b1" isOpen busy={false} onClose={() => {}} onAdopt={onAdopt} />);
    const dialog = await screen.findByTestId('adoption-dialog');
    expect(await within(dialog).findByText('予約の取消の手続き: 酒蔵見学', { exact: false })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('頼る変更: 予定「喜多酒造」');
    expect(g8.getAdoptionPreview).toHaveBeenCalledWith('p1', 'b1', null);
    fireEvent.click(within(dialog).getByRole('button', { name: 'すべて採用' }));
    expect(onAdopt).toHaveBeenLastCalledWith(null);

    g8.getAdoptionPreview.mockResolvedValueOnce(partial);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /予定・追加: 喜多酒造/ }));
    expect(await within(dialog).findByTestId('adoption-missing')).toHaveTextContent('予定「喜多酒造」 も選んでください');
    expect(g8.getAdoptionPreview).toHaveBeenLastCalledWith('p1', 'b1',
      full.items.map((i) => i.op_id).filter((id) => id !== 'event:add:new-sake'));
    expect(within(dialog).getByRole('button', { name: '選んだ4件を採用' })).toBeDisabled();

    g8.getAdoptionPreview.mockResolvedValueOnce({ ...partial, can_adopt: true, missing_dependencies: [] });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /移動区間・追加: 藤居本家 → 喜多酒造/ }));
    const go = await within(dialog).findByRole('button', { name: '選んだ3件を採用' });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    expect(onAdopt).toHaveBeenLastCalledWith([
      'event:6552136b-789a-41b8-80fe-5759161af9ee', 'segment:7ed98604-68c9-4b28-a149-279403540409',
      'reservation:97adba7d-d1ac-42cb-8e08-7d83ff85becf']);
    expect(dialog).toHaveTextContent('選ばなかった変更は本案へ当てません');
  });

  it('本案と食い違う変更は理由を出し、確かめの失敗も出す', async () => {
    g8.getAdoptionPreview.mockResolvedValueOnce({ ...full, can_adopt: false,
      conflicts: [{ kind: 'segment', op_id: 'segment:7ed98604-68c9-4b28-a149-279403540409', reason: 'changed_in_plan' }] });
    const { unmount } = render(<AdoptionDialog planId="p1" branchId="b1" isOpen busy={false} onClose={() => {}} onAdopt={() => {}} />);
    expect(await screen.findByText('移動区間「藤居本家 → 岡村本家」: 分岐した後に本案でも変更されています')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'すべて採用' })).toBeDisabled();
    unmount();
    g8.getAdoptionPreview.mockRejectedValueOnce({ response: { status: 409, data: { detail: '案が変わりました' } } });
    render(<AdoptionDialog planId="p1" branchId="b1" isOpen busy={false} onClose={() => {}} onAdopt={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('案が変わりました');
  });
});

