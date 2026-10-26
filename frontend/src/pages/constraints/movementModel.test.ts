/** [Gate G7] MOVE-03 移動・滞在の既定の入力の変換と、日ごとの疲れの目安の文言。 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/g7Responses.json';
import { decodeG7 } from '@/services/api/decodersG7';
import { runMovement } from '@/services/api/g7';
import { dayMetricText, draftFrom, draftToSettings, hm } from './movementModel';

describe('movementModel', () => {
  it('保存された設定 → 入力 → 送る設定(宿泊・移動の滞在は送らない、1日の上限は時間→分)', () => {
    const s = decodeG7('movementSettings', fx.movement_settings).settings;
    const d = draftFrom(s);
    expect(d.stays.sightseeing).toBe('60');
    expect(d.maxDayHours).toBe('');
    const out = draftToSettings({ ...d, maxDayHours: '9', size: '3' });
    expect(out.max_day_minutes).toBe(540);
    expect(out.party?.size).toBe(3);
    expect(out.stay_minutes && 'accommodation' in out.stay_minutes).toBe(false);
    expect(out.max_continuous_minutes).toBeNull();
  });

  it('整数でない入力は理由つきで拒む', () => {
    const d = draftFrom(decodeG7('movementSettings', fx.movement_settings).settings);
    expect(() => draftToSettings({ ...d, margin: '1.5' })).toThrow('最終の便の前の余裕は整数で入力してください');
  });

  it('日ごとの疲れの目安を文にする(見積もりを含むことを示す)', () => {
    const m = runMovement(fx.validation_run_movement).day_metrics[0]!;
    expect(dayMetricText(m)).toBe('活動4時間・休憩なし最長4時間(疲れの目安33%・ゆとり)・見積もりを含む');
    expect(hm(75)).toBe('1時間15分');
    expect(hm(40)).toBe('40分');
  });
});
