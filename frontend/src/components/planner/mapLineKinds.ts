/**
 * [Gate② UX P0] 地図の凡例の「線の種類」。引いた線があるものだけを出す(線の無い種類を出さない)。
 * 道に沿った経路(実線)と、道の経路が無い区間の直線(点線・目安)を区別し、点線を道だと誤解させない。
 * 競合比較レポート(2026-11-20)の「地図の線も道路ルート/直線の目安を常時区別」に対応。
 */
export interface LineKind {
  key: 'road' | 'straight';
  label: string;
  dashed: boolean;
}

/**
 * @param drawsLegs 区間ごとの線を引いているか(引かない時は予定の順の点線だけ)
 * @param legIsRoad 区間ごとに、道に沿った経路で引いたか
 * @param routeLinePoints 予定の順の点線の点の数(区間の線を引かない時に使う)
 */
export function mapLineKinds(drawsLegs: boolean, legIsRoad: boolean[], routeLinePoints: number): LineKind[] {
  if (!drawsLegs) {
    return routeLinePoints > 1 ? [{ key: 'straight', label: '予定の順(直線・道ではない)', dashed: true }] : [];
  }
  return [
    ...(legIsRoad.some(Boolean) ? [{ key: 'road' as const, label: '道に沿った経路', dashed: false }] : []),
    ...(legIsRoad.some((r) => !r) ? [{ key: 'straight' as const, label: '直線(目安・道ではない)', dashed: true }] : []),
  ];
}
