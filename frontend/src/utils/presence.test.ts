import { describe, it, expect } from 'vitest';
import type { PresenceChange, PresenceViewer } from '@/services/api';
import { describeChange, othersChanges, othersEditing, presenceClientId } from './presence';

const change = (over: Partial<PresenceChange>): PresenceChange => ({
  revision: 2, actor_label: 'B', is_self: false, source: 'manual', undone: false, count: 1,
  items: [{ entity_type: 'travel_event', action: 'update', label: '清水寺' }], at: null, ...over,
});

describe('共同編集の文面 (Gate C1)', () => {
  it('誰が・どの予定を・何をしたか', () => {
    expect(describeChange(change({}))).toBe('Bさんが「清水寺」を更新しました');
    expect(describeChange(change({ items: [{ entity_type: 'travel_event', action: 'delete', label: '昼食' }] })))
      .toBe('Bさんが「昼食」を削除しました');
    expect(describeChange(change({ items: [{ entity_type: 'travel_day', action: 'create', label: '2026-11-02' }] })))
      .toBe('Bさんが2026-11-02の日程を追加しました');
    expect(describeChange(change({ count: 4 }))).toBe('Bさんが4件の予定・日程を変更しました');
    expect(describeChange(change({ source: 'undo' }))).toBe('Bさんが直前の変更を元に戻しました');
  });

  it('自分の変更は数えず、新しい順に最大3件', () => {
    const list = [1, 2, 3, 4, 5].map((r) => change({ revision: r, is_self: r === 5 }));
    expect(othersChanges(list).map((c) => c.revision)).toEqual([4, 3, 2]);
  });

  it('同じ予定を編集中の他の人', () => {
    const v = (label: string, is_self: boolean, id: string | null): PresenceViewer => ({
      user_id: label, label, role: 'editor', is_self, devices: 1, seen_at: '',
      editing: id ? { kind: 'event', id, label: 'x' } : null,
    });
    expect(othersEditing([v('あなた', true, 'e1'), v('B', false, 'e1'), v('C', false, 'e2')], 'e1').map((x) => x.label))
      .toEqual(['B']);
    expect(othersEditing([v('B', false, 'e1')], null)).toEqual([]);
  });

  it('端末の印はタブの中で同じ', () => {
    const a = presenceClientId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(presenceClientId()).toBe(a);
  });
});
