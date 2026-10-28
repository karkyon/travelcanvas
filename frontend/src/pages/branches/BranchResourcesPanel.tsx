/**
 * [Gate G8] FR-019 案の中の移動区間・予約を変える(branch-v2)。保存は予定と一緒に BranchDetailPage が行う。
 *
 * - 移動区間: 移動手段・所要時間・費用を変える、外す、新しく足す(この案の予定どうし)
 * - 予約: 別の予定へ付け替える・紐付けを外す・取り消す予定にする(予約先へは何も送らない。採用すると準備の一覧に
 *   「予約の取消の手続き」が入る)。確定した紐付けのある予約は変えられない
 * - 予約・費用を見せない設定の参加者には、その欄を出さない
 */
import React, { useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { BranchEventItem } from '@/services/api';
import type { BranchResources, ResourcesInput, SegmentMode } from '@/services/api/types/g8';
import {
  MODE_OPTIONS, addSegment, describeSegment, liveEvents, pendingRelations, refId, removeAddedSegment,
  reservationOp, segmentOp, setReservationOp, setSegmentField, titleOf, toggleSegmentRemove,
} from './resourcesModel';

interface Props {
  resources: BranchResources;
  value: ResourcesInput;
  items: BranchEventItem[];
  baseTitles: Map<string, string>;
  editable: boolean;
  onChange: (next: ResourcesInput) => void;
}

const input = 'w-full border rounded-sm px-2 py-1 text-sm';

const BranchResourcesPanel: React.FC<Props> = ({ resources, value, items, baseTitles, editable, onChange }) => {
  const title = useMemo(() => titleOf(items, baseTitles), [items, baseTitles]);
  const live = useMemo(() => liveEvents(items), [items]);
  const removedIds = useMemo(() => new Set(items.filter((i) => i.removed && i.source_event_id)
    .map((i) => i.source_event_id as string)), [items]);
  const pending = pendingRelations(value, items, { segments: resources.base_segments, reservations: resources.base_reservations });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<SegmentMode>('walking');
  const [minutes, setMinutes] = useState('');
  const refOf = (id: string) => live.find((e) => e.id === id)?.ref;

  const add = () => {
    const a = refOf(from);
    const b = refOf(to);
    if (!a || !b || from === to) return;
    const m = minutes.trim() === '' ? null : Math.max(0, Math.round(Number(minutes)));
    onChange(addSegment(value, a, b, mode, Number.isFinite(m as number) ? m : null));
    setFrom('');
    setTo('');
    setMinutes('');
  };

  return (
    <Card padding="md">
      <section aria-labelledby="branch-resources">
        <h2 id="branch-resources" className="font-semibold text-ink-900">移動区間・予約</h2>
        <p className="text-xs text-ink-700 mt-1">
          この案の中だけで変えます。採用するまで本案は変わりません。予約は予約先へ何も送りません。
        </p>
        {(pending.segments.length > 0 || pending.reservations.length > 0) && (
          <p className="text-sm text-amber-900 mt-2" role="note" data-testid="branch-resources-pending">
            {`外す予定に付いた${pending.segments.length ? `区間${pending.segments.length}件` : ''}`
              + `${pending.segments.length && pending.reservations.length ? '・' : ''}`
              + `${pending.reservations.length ? `予約${pending.reservations.length}件` : ''}`
              + 'の扱いを決めてください(区間は外す、予約は付け替えるか取り消す予定にする)。'}
          </p>
        )}

        <h3 className="font-medium text-ink-900 mt-3">移動区間</h3>
        {resources.base_segments.length === 0 && <p className="text-sm text-ink-700">本案に移動区間はありません。</p>}
        <ul className="space-y-2 mt-1" aria-label="移動区間">
          {resources.base_segments.map((s) => {
            const op = segmentOp(value, s.id);
            const removed = op?.op === 'remove';
            const fields = op?.op === 'update' ? op.fields : {};
            const touchesRemoved = removedIds.has(s.from_event_id ?? '') || removedIds.has(s.to_event_id ?? '');
            const cur = <K extends keyof typeof s>(k: K) => (k in fields ? (fields as Record<string, unknown>)[k as string] : s[k]);
            return (
              <li key={s.id} className={`border rounded-sm p-2 ${removed ? 'bg-gray-50' : ''}`} data-testid={`branch-segment-${s.id}`}>
                <p className={`text-sm text-ink-900 ${removed ? 'line-through' : ''}`}>{describeSegment(s, title)}</p>
                <div className="grid gap-2 sm:grid-cols-4 mt-1 items-end">
                  <div>
                    <label htmlFor={`seg-mode-${s.id}`} className="block text-xs text-ink-900">移動手段</label>
                    <select id={`seg-mode-${s.id}`} className={input} disabled={!editable || removed || touchesRemoved}
                      value={String(cur('mode'))} onChange={(e) => onChange(setSegmentField(value, s, 'mode', e.target.value))}>
                      {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`seg-min-${s.id}`} className="block text-xs text-ink-900">所要時間(分)</label>
                    <input id={`seg-min-${s.id}`} type="number" min={0} className={input}
                      disabled={!editable || removed || touchesRemoved}
                      value={cur('duration_minutes') === null || cur('duration_minutes') === undefined ? '' : String(cur('duration_minutes'))}
                      onChange={(e) => onChange(setSegmentField(value, s, 'duration_minutes',
                        e.target.value === '' ? null : Math.max(0, Number(e.target.value))))} />
                  </div>
                  {!resources.costs_hidden && (
                    <div>
                      <label htmlFor={`seg-cost-${s.id}`} className="block text-xs text-ink-900">費用</label>
                      <input id={`seg-cost-${s.id}`} type="number" min={0} className={input}
                        disabled={!editable || removed || touchesRemoved}
                        value={cur('cost') === null || cur('cost') === undefined ? '' : String(Number(cur('cost')))}
                        onChange={(e) => {
                          const next = setSegmentField(value, s, 'cost', e.target.value === '' ? null : e.target.value);
                          const needsCurrency = e.target.value !== '' && !cur('currency');
                          onChange(needsCurrency ? setSegmentField(next, s, 'currency', 'JPY') : next);
                        }} />
                    </div>
                  )}
                  {editable && (
                    <Button variant="ghost" size="sm" onClick={() => onChange(toggleSegmentRemove(value, s))}
                      aria-label={`${describeSegment(s, title)}を${removed ? '戻す' : '外す'}`}>
                      {removed ? '戻す' : '外す'}
                    </Button>
                  )}
                </div>
                {touchesRemoved && !removed && (
                  <p className="text-xs text-amber-900 mt-1">この区間がつなぐ予定を外すため、区間も外してください。</p>
                )}
              </li>
            );
          })}
          {value.segments.filter((s) => s.op === 'add').map((s) => s.op === 'add' && (
            <li key={s.key} className="border rounded-sm p-2 bg-green-50" data-testid={`branch-segment-new-${s.key}`}>
              <p className="text-sm text-ink-900">
                {`追加: ${title(refId(s.fields.from))} → ${title(refId(s.fields.to))}`
                  + `(${MODE_OPTIONS.find((m) => m.value === s.fields.mode)?.label ?? s.fields.mode}`
                  + `${s.fields.duration_minutes !== undefined && s.fields.duration_minutes !== null ? `・${s.fields.duration_minutes}分` : ''})`}
              </p>
              {editable && (
                <Button variant="ghost" size="sm" onClick={() => onChange(removeAddedSegment(value, s.key))}>取り消す</Button>
              )}
            </li>
          ))}
        </ul>
        {editable && live.length >= 2 && (
          <fieldset className="mt-2 border rounded-sm p-2">
            <legend className="text-xs text-ink-900 px-1">区間を足す</legend>
            <div className="grid gap-2 sm:grid-cols-4 items-end">
              <div>
                <label htmlFor="seg-add-from" className="block text-xs text-ink-900">出発の予定</label>
                <select id="seg-add-from" className={input} value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">選ぶ</option>
                  {live.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="seg-add-to" className="block text-xs text-ink-900">到着の予定</label>
                <select id="seg-add-to" className={input} value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">選ぶ</option>
                  {live.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="seg-add-mode" className="block text-xs text-ink-900">移動手段</label>
                <select id="seg-add-mode" className={input} value={mode} onChange={(e) => setMode(e.target.value as SegmentMode)}>
                  {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="seg-add-min" className="block text-xs text-ink-900">所要時間(分・空なら概算)</label>
                <input id="seg-add-min" type="number" min={0} className={input} value={minutes}
                  onChange={(e) => setMinutes(e.target.value)} />
              </div>
            </div>
            <Button variant="secondary" size="sm" className="mt-2" onClick={add} disabled={!from || !to || from === to}>
              この区間を足す
            </Button>
          </fieldset>
        )}

        {!resources.reservations_hidden && (
          <>
            <h3 className="font-medium text-ink-900 mt-4">予約</h3>
            {resources.base_reservations.length === 0 && <p className="text-sm text-ink-700">本案に予約はありません。</p>}
            <ul className="space-y-2 mt-1" aria-label="予約">
              {resources.base_reservations.map((r) => {
                const op = reservationOp(value, r.id);
                const relinkTo = op?.op === 'relink' ? (refId(op.to) ?? '__none__') : '';
                const cancel = op?.op === 'cancel';
                return (
                  <li key={r.id} className="border rounded-sm p-2" data-testid={`branch-reservation-${r.id}`}>
                    <p className="text-sm text-ink-900">
                      {`${r.label}(${r.event_ids.length ? r.event_ids.map((e) => title(e)).join('・') : '予定なし'})`}
                      {r.locked && <span className="ml-2 px-1.5 rounded-sm bg-gray-200 text-ink-900 text-xs">確定した紐付け</span>}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end mt-1">
                      <div>
                        <label htmlFor={`res-to-${r.id}`} className="block text-xs text-ink-900">付け替え先</label>
                        <select id={`res-to-${r.id}`} className={input} disabled={!editable || r.locked || cancel}
                          value={relinkTo}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') onChange(setReservationOp(value, r.id, null));
                            else if (v === '__none__') onChange(setReservationOp(value, r.id, { op: 'relink', reservation_id: r.id, to: null }));
                            else {
                              const ref = refOf(v);
                              if (ref) onChange(setReservationOp(value, r.id, { op: 'relink', reservation_id: r.id, to: ref }));
                            }
                          }}>
                          <option value="">変えない</option>
                          {r.event_ids.length > 0 && <option value="__none__">紐付けを外す</option>}
                          {live.filter((e) => !(r.event_ids.length === 1 && r.event_ids[0] === e.id)).map((e) =>
                            <option key={e.id} value={e.id}>{e.label}</option>)}
                        </select>
                      </div>
                      <label className="flex items-center gap-1 text-sm text-ink-900">
                        <input type="checkbox" checked={cancel} disabled={!editable || r.locked || r.status === 'cancelled'}
                          onChange={(e) => onChange(setReservationOp(value, r.id,
                            e.target.checked ? { op: 'cancel', reservation_id: r.id, note: null } : null))} />
                        取り消す予定にする
                      </label>
                    </div>
                    {cancel && (
                      <p className="text-xs text-amber-900 mt-1">
                        採用しても予約先では取り消されません。準備の一覧に「予約の取消の手続き」が入ります
                        {r.cancellation_deadline ? `(取消期限 ${new Date(r.cancellation_deadline).toLocaleString('ja-JP')})` : ''}。
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {resources.reservations_hidden && (
          <p className="text-sm text-ink-700 mt-3">予約は見せない設定のため表示していません。</p>
        )}
      </section>
    </Card>
  );
};

export default BranchResourcesPanel;
