/**
 * [Gate V2] 訪問の地図の表示の純粋関数。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { VisitItem, VisitsOverview } from '@/services/api';
import { actionsFor, project, reasonText } from './visitModel';

const assessed = fx.visits_assessed as unknown as VisitsOverview;
const reassessed = fx.visits_reassessed as unknown as VisitsOverview;
const byTitle = (o: VisitsOverview, t: string) => o.items.find((i) => i.title === t)!;

describe('visitModel (Gate V2)', () => {
  it('根拠を文で示す(距離・滞在・点・速さ・通過の理由)', () => {
    const k = byTitle(assessed, '清水寺');
    expect(reasonText(k.assessment, k.radius_m)).toBe('予定の場所から約22m(半径200m)・滞在 12分・半径の中の点 7件・速さ 約0km/h');
    const s = byTitle(assessed, '京都駅');
    expect(reasonText(s.assessment, s.radius_m)).toMatch(/速く移動していたため通過と判定/);
    expect(reasonText(null, 200)).toBe('まだ判定していません');
    expect(reasonText({ ...k.assessment!, reasons: { basis: 'manual', evidence: ['manual', 'reservation'] } }, 200))
      .toBe('位置の軌跡なし(手動の記録から)・証拠: 手動の記録・予約');
  });

  it('今の状態で意味のある訂正だけを出す', () => {
    const labels = (i: VisitItem) => actionsFor(i).map((a) => a.action);
    expect(labels(byTitle(assessed, '大阪城'))).toEqual(['confirm', 'pass_through', 'reject', 'hide']);
    expect(labels(byTitle(assessed, '清水寺'))).toEqual(['confirm', 'pass_through', 'reject', 'hide']);
    expect(labels(byTitle(reassessed, '清水寺'))).toEqual(['pass_through', 'reject', 'hide', 'reset']);
    const hidden = { ...byTitle(assessed, '清水寺'), assessment: { ...byTitle(assessed, '清水寺').assessment!, hidden: true } };
    expect(labels(hidden)).toEqual(['unhide']);
  });

  it('略図の座標: 枠の中に収まり、北が上・東が右', () => {
    const pos = project(assessed.items, 640, 360);
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(640);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(360);
    }
    const k = pos.get(byTitle(assessed, '清水寺').event_id)!;
    const o = pos.get(byTitle(assessed, '大阪城').event_id)!;
    expect(k.y).toBeLessThan(o.y); // 京都は大阪より北
    expect(k.x).toBeGreaterThan(o.x); // 京都は大阪より東
    expect(project([], 640, 360).size).toBe(0);
  });
});
