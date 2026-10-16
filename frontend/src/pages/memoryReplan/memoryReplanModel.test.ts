import { describe, it, expect } from 'vitest';
import { basisText, insightText } from './memoryReplanModel';

describe('memoryReplanModel (Gate P17)', () => {
  it('傾向と根拠を文章にする', () => {
    const i = { kind: 'stay_longer' as const, event_type: 'sightseeing', minutes: 45, samples: 3,
      plans: ['金沢', '上野', '奈良'], examples: ['美術館', '博物館'], applicable: true };
    expect(insightText(i)).toBe('「観光」の予定では、実際の滞在が予定より平均45分長くなっています');
    expect(basisText(i)).toBe('根拠: 金沢・上野ほかの3件(例: 美術館、博物館)');
    expect(insightText({ ...i, kind: 'often_skipped', event_type: 'shopping', samples: 2, skipped: 2 }))
      .toBe('「買い物」の予定は2件のうち2件に行きませんでした。候補として扱うのも一案です');
    expect(insightText({ ...i, kind: 'late_arrival', event_type: null, minutes: 20 })).toMatch(/平均20分遅れて/);
    expect(insightText({ ...i, kind: 'stay_shorter', event_type: 'museum' })).toBe('「美術館・博物館」の予定では、実際の滞在が予定より平均45分短くなっています');
  });
});
