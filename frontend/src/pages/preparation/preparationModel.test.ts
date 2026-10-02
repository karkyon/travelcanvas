/**
 * [Gate P1] 準備画面の表示整形・入力変換(preparationModel)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { PackingItem, Readiness } from '@/services/api';
import {
  emptyPackingForm, emptyTaskForm, groupByCategory, isoToLocal, localToIso, packingFormToPayload, packingProgress,
  readinessSummary, taskFormToPayload,
} from './preparationModel';

const list = fx.packing_item_list as PackingItem[];

describe('preparationModel (Gate P1)', () => {
  it('準備状況の要約は「未取得」「準備完了」「残りあり」を区別する', () => {
    expect(readinessSummary(null).tone).toBe('unknown');
    expect(readinessSummary(fx.readiness_ready as Readiness)).toEqual({
      tone: 'ready', text: '出発前に対応が必要な項目はありません。',
    });
    const r = fx.readiness_attention as Readiness;
    expect(readinessSummary(r)).toEqual({ tone: 'attention', text: `要対応1件を含む${r.counts.total}件の準備が残っています。` });
    expect(readinessSummary({ ...(fx.readiness_ready as Readiness), resolved_by_tasks: 2 }).text).toContain('タスクで対応済み 2件');
  });

  it('持ち物をカテゴリ順にまとめ、進み具合を数える', () => {
    const groups = groupByCategory(list);
    expect(groups.map((g) => g.category)).toEqual(['clothing', 'health', 'electronics']);
    expect(packingProgress(list)).toEqual({ packed: 1, total: 4, requiredLeft: 1 });
  });

  it('持ち物フォームの検証と変換(個人の持ち物には担当者を送らない)', () => {
    expect(packingFormToPayload({ ...emptyPackingForm(), name: ' ' })).toEqual({ ok: false, error: '名前を入力してください' });
    expect(packingFormToPayload({ ...emptyPackingForm(), name: 'a', quantity: '0' }).ok).toBe(false);
    expect(packingFormToPayload({ ...emptyPackingForm(), name: 'a', quantity: '1.5' }).ok).toBe(false);
    expect(packingFormToPayload({ ...emptyPackingForm(), name: ' 傘 ', note: ' 折りたたみ ', quantity: '2', assignee_user_id: 'u1' }))
      .toEqual({ ok: true, data: { name: '傘', note: '折りたたみ', category: 'other', quantity: 2, is_required: false, status: 'to_prepare', scope: 'shared', assignee_user_id: 'u1' } });
    const personal = packingFormToPayload({ ...emptyPackingForm(), name: '薬', scope: 'personal', assignee_user_id: 'u1' });
    expect(personal.ok && 'assignee_user_id' in personal.data).toBe(false);
  });

  it('タスクフォーム: 題名必須、期限は端末時刻からタイムゾーン付きISOへ', () => {
    expect(taskFormToPayload(emptyTaskForm()).ok).toBe(false);
    const res = taskFormToPayload({ ...emptyTaskForm('両替'), due_local: '2026-11-01T09:30', completion_criteria: ' 受取 ' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.title).toBe('両替');
      expect(res.data.completion_criteria).toBe('受取');
      expect(res.data.due_at).toBe(new Date('2026-11-01T09:30').toISOString());
    }
    expect(taskFormToPayload({ ...emptyTaskForm('a'), due_local: '2026-13-01' })).toEqual({ ok: false, error: '期限の日時が正しくありません' });
  });

  it('日時の相互変換は端末のタイムゾーンで往復できる', () => {
    expect(localToIso('bad')).toBeNull();
    const iso = localToIso('2026-11-01T09:30') as string;
    expect(isoToLocal(iso)).toBe('2026-11-01T09:30');
    expect(isoToLocal(null)).toBe('');
  });
});
