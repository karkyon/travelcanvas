/**
 * [Gate G8] FR-019 案の中の移動区間・予約の変更(branch-v2)の編集の規則と表示名。
 *
 * backend(app/services/branch_resources.py)と同じ規則:
 *   - 区間: 変える(本案と違う項目だけを送る)・外す・足す(出発・到着はこの案の予定。外す予定は選べない)
 *   - 予約: 別の予定へ付け替える(紐付けを外すこともできる)・取り消す予定にする(予約先へは何も送らない。採用すると
 *     「予約の取消の手続き」が準備に入る)。確定した紐付けのある予約は変えられない
 *   - 外す予定に付いた区間は「外す」しか選べない
 */
import type { BranchEventItem } from '@/services/api';
import type {
  BaseReservation, BaseSegment, EventRef, ReservationOp, ResourcesInput, SegmentFields, SegmentMode, SegmentOp,
} from '@/services/api/types/g8';

export const MODE_OPTIONS: Array<{ value: SegmentMode; label: string }> = [
  { value: 'walking', label: '徒歩' }, { value: 'train', label: '鉄道' }, { value: 'bus', label: 'バス' },
  { value: 'driving', label: '車' }, { value: 'taxi', label: 'タクシー' }, { value: 'bicycle', label: '自転車' },
  { value: 'ferry', label: '船' }, { value: 'flight', label: '飛行機' }, { value: 'mixed', label: '複合' },
];
export const MODE_LABEL = Object.fromEntries(MODE_OPTIONS.map((o) => [o.value, o.label])) as Record<SegmentMode, string>;

export const emptyResources = (): ResourcesInput => ({ segments: [], reservations: [] });

export function fromExtras(segments: SegmentOp[], reservations: ReservationOp[]): ResourcesInput {
  return { segments: segments.map((s) => ({ ...s })), reservations: reservations.map((r) => ({ ...r })) };
}

export type LiveEvent = { ref: EventRef; id: string; label: string };

/** この案に残る予定(外さない予定・足した予定)。区間・付け替えの相手の選択肢 */
export function liveEvents(items: BranchEventItem[]): LiveEvent[] {
  return items.filter((i) => !i.removed).map((i) => (i.source_event_id
    ? { ref: { event: i.source_event_id }, id: i.source_event_id, label: i.title || '(題名なし)' }
    : { ref: { key: i.key }, id: i.key, label: `${i.title || '(題名なし)'}(この案で追加)` }));
}

export const refId = (ref: EventRef | null | undefined): string | null =>
  !ref ? null : 'event' in ref ? ref.event : ref.key;

export function titleOf(items: BranchEventItem[], baseTitles: Map<string, string>) {
  const keyed = new Map(items.map((i) => [i.source_event_id ?? i.key, i.title]));
  return (id: string | null | undefined): string => (id ? keyed.get(id) ?? baseTitles.get(id) ?? '予定' : '場所');
}


const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
};

export function segmentOp(input: ResourcesInput, id: string): SegmentOp | undefined {
  return input.segments.find((s) => s.op !== 'add' && s.segment_id === id);
}

/** 区間の項目を変える(本案と同じ値に戻したら、その項目は送らない) */
export function setSegmentField(input: ResourcesInput, base: BaseSegment, field: keyof SegmentFields,
  value: unknown): ResourcesInput {
  const current = segmentOp(input, base.id);
  const fields: SegmentFields = current && current.op === 'update' ? { ...current.fields } : {};
  const baseValue = (base as unknown as Record<string, unknown>)[field];
  if (sameValue(value, baseValue)) delete fields[field];
  else (fields as Record<string, unknown>)[field] = value;
  const others = input.segments.filter((s) => s.op === 'add' || s.segment_id !== base.id);
  return {
    ...input,
    segments: Object.keys(fields).length ? [...others, { op: 'update', segment_id: base.id, fields }] : others,
  };
}

export function toggleSegmentRemove(input: ResourcesInput, base: BaseSegment): ResourcesInput {
  const current = segmentOp(input, base.id);
  const others = input.segments.filter((s) => s.op === 'add' || s.segment_id !== base.id);
  return { ...input, segments: current?.op === 'remove' ? others : [...others, { op: 'remove', segment_id: base.id }] };
}

export function addSegment(input: ResourcesInput, from: EventRef, to: EventRef, mode: SegmentMode,
  minutes: number | null): ResourcesInput {
  const key = `seg-${Math.random().toString(36).slice(2, 10)}`;
  const fields = { from, to, mode, ...(minutes !== null ? { duration_minutes: minutes } : {}) };
  return { ...input, segments: [...input.segments, { op: 'add', key, fields }] };
}

export function removeAddedSegment(input: ResourcesInput, key: string): ResourcesInput {
  return { ...input, segments: input.segments.filter((s) => !(s.op === 'add' && s.key === key)) };
}

export function reservationOp(input: ResourcesInput, id: string): ReservationOp | undefined {
  return input.reservations.find((r) => r.reservation_id === id);
}

/** 予約の変更を置き換える(null は変えない) */
export function setReservationOp(input: ResourcesInput, id: string, op: ReservationOp | null): ResourcesInput {
  const others = input.reservations.filter((r) => r.reservation_id !== id);
  return { ...input, reservations: op ? [...others, op] : others };
}

type Result = { ok: true } | { ok: false; error: string };

/** 保存の前の確かめ(backend と同じ規則。予定を外した時に付いた区間・予約の扱いも案内する) */
export function validateResources(input: ResourcesInput, items: BranchEventItem[], base: {
  segments: BaseSegment[]; reservations: BaseReservation[];
}): Result {
  const live = new Set(liveEvents(items).map((e) => e.id));
  const removed = new Set(items.filter((i) => i.source_event_id && i.removed).map((i) => i.source_event_id as string));
  const segs = new Map(base.segments.map((s) => [s.id, s]));
  for (const s of input.segments) {
    if (s.op === 'add') {
      const a = refId(s.fields.from);
      const b = refId(s.fields.to);
      if (!a || !b || !live.has(a) || !live.has(b)) return { ok: false, error: '足す区間の出発・到着の予定を選び直してください' };
      if (a === b) return { ok: false, error: '足す区間の出発と到着が同じ予定です' };
      if ((s.fields.cost ?? null) !== null && !s.fields.currency) return { ok: false, error: '費用には通貨を付けてください' };
    } else if (s.op === 'update') {
      const b = segs.get(s.segment_id);
      if (b && (removed.has(b.from_event_id ?? '') || removed.has(b.to_event_id ?? ''))) {
        return { ok: false, error: '外す予定につながる区間は、変えずに「外す」にしてください' };
      }
      const cost = 'cost' in s.fields ? s.fields.cost : b?.cost;
      const cur = 'currency' in s.fields ? s.fields.currency : b?.currency;
      if ((cost === null || cost === undefined || cost === '') !== (cur === null || cur === undefined || cur === '')) {
        return { ok: false, error: '区間の費用と通貨は一緒に入れてください' };
      }
    }
  }
  for (const r of input.reservations) {
    if (r.op === 'relink' && r.to && !live.has(refId(r.to) ?? '')) {
      return { ok: false, error: '予約の付け替え先の予定を選び直してください' };
    }
  }
  return { ok: true };
}

/** 外す予定に付いていて、まだ扱いを決めていない区間・予約(採用の前に決める必要がある) */
export function pendingRelations(input: ResourcesInput, items: BranchEventItem[], base: {
  segments: BaseSegment[]; reservations: BaseReservation[];
}): { segments: BaseSegment[]; reservations: BaseReservation[] } {
  const removed = new Set(items.filter((i) => i.source_event_id && i.removed).map((i) => i.source_event_id as string));
  const segs = base.segments.filter((s) => (removed.has(s.from_event_id ?? '') || removed.has(s.to_event_id ?? ''))
    && segmentOp(input, s.id)?.op !== 'remove');
  const res = base.reservations.filter((r) => r.event_ids.some((e) => removed.has(e)) && !reservationOp(input, r.id));
  return { segments: segs, reservations: res };
}

export function describeSegment(s: BaseSegment, title: (id: string | null) => string): string {
  const minutes = s.duration_minutes !== null ? `${Math.round(s.duration_minutes)}分` : '所要時間なし';
  return `${title(s.from_event_id)} → ${title(s.to_event_id)}(${MODE_LABEL[s.mode]}・${minutes})`;
}

export const OP_LABEL: Record<string, string> = {
  add: '追加', remove: '外す', update: '変更', relink: '付け替え', cancel: '取り消す予定',
};
export const KIND_LABEL: Record<string, string> = { event: '予定', segment: '移動区間', reservation: '予約' };
