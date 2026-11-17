/** [Gate TDay-Mock] 地図に出すもの(今日の予定・足跡・寄り道・雨雲・同行者) */
export interface MapFilters { plan: boolean; trail: boolean; detour: boolean; rain: boolean; crew: boolean }
export const ALL_FILTERS: MapFilters = { plan: true, trail: true, detour: true, rain: true, crew: true };

/** [Gate Hardening-A・監査 G-07] 足跡の線に端末の位置の記録を使っているか(設定が ON で、点が 2 つ以上ある時だけ) */
export function trailInUse(trailSetting: boolean, trailPoints: number): boolean {
  return trailSetting && trailPoints > 1;
}

export interface MapLineLegend { trail: boolean; walked: string; ahead: string; note: string }

/**
 * [Gate Hardening-A・監査 G-07] 地図の線の凡例。線は予定の地点を順に直線で結んだ目安で、道順(道路の経路)ではない。
 * 位置の記録を使わない時の「済んだ予定の線」を「足跡」と呼ばない(実際に歩いた跡に見せない)。道順は外の地図で案内する。
 */
export function mapLineLegend(trail: boolean): MapLineLegend {
  return trail
    ? { trail, walked: '今日の足跡(位置の記録)', ahead: 'この後の予定(直線の目安)', note: '予定の線は道順ではありません' }
    : { trail, walked: '済んだ予定(直線)', ahead: 'この後の予定(直線の目安)',
      note: '線は道順・歩いた跡ではありません。足跡は位置の記録をONにした時だけ' };
}
