/**
 * [Gate V2] 訪問の地図の層(FR-049)・判定(FR-050)・訂正(FR-051)の表示の純粋関数。
 *
 * - 状態は色だけで表さず、形・記号・文字を併用する(DOC-14 §8「色だけに依存しない」)
 * - 地図は外部の地図サービスに頼らない略図(予定の場所の相対位置)。地図が使えない時も一覧で同じ内容を読める
 */
import type { VisitAction, VisitAssessment, VisitItem, VisitLayerState, VisitLevel, VisitSource, VisitState } from '@/services/api';

export const LAYER_ORDER: VisitLayerState[] = ['VERIFIED', 'STAYED', 'VISITED', 'PASS_THROUGH', 'PLANNED', 'HIDDEN'];

export const LAYER_LABEL: Record<VisitLayerState, string> = {
  VERIFIED: '確認済みの訪問', STAYED: '滞在', VISITED: '訪問', PASS_THROUGH: '通過', PLANNED: '予定', HIDDEN: '非表示',
};

/** 凡例・一覧の記号(形でも区別する) */
export const LAYER_SYMBOL: Record<VisitLayerState, string> = {
  VERIFIED: '✓', STAYED: '◆', VISITED: '●', PASS_THROUGH: '◌', PLANNED: '○', HIDDEN: '－',
};

export const STATE_LABEL: Record<VisitState, string> = {
  VERIFIED_VISIT: '確認済みの訪問', LIKELY_VISIT: '訪問の可能性', PASS_THROUGH: '通過', PLANNED_ONLY: '予定だけ',
  MANUAL: '手動の記録', REJECTED: '行っていない',
};

export const LEVEL_LABEL: Record<VisitLevel, string> = { high: '高', review: '要確認', candidate: '候補' };

export const SOURCE_LABEL: Record<VisitSource, string> = {
  auto: 'サーバーに保存した軌跡から判定', device: 'この端末の軌跡から判定', user: 'あなたが決めた',
};

const EVIDENCE_LABEL: Record<string, string> = { photo: '写真', reservation: '予約', manual: '手動の記録', gps_stay: '10分以上の滞在' };

export const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`);

export function reasonText(a: VisitAssessment | null, radiusM: number): string {
  if (!a) return 'まだ判定していません';
  const r = a.reasons ?? {};
  const parts: string[] = [];
  if (r.basis === 'gps' || (r.points_inside ?? 0) > 0) {
    if (r.median_distance_m !== undefined && r.median_distance_m !== null) {
      parts.push(`予定の場所から約${Math.round(r.median_distance_m)}m(半径${r.radius_m ?? radiusM}m)`);
    }
    parts.push(`滞在 ${Math.floor((r.dwell_seconds ?? 0) / 60)}分`);
    parts.push(`半径の中の点 ${r.points_inside ?? 0}件`);
    if (r.speed_kmh !== undefined && r.speed_kmh !== null) parts.push(`速さ 約${r.speed_kmh}km/h`);
    if (r.pass_reason === 'fast') parts.push('速く移動していたため通過と判定');
    if (r.pass_reason === 'short') parts.push('2分未満だったため通過と判定');
  } else if (r.basis === 'manual') {
    parts.push('位置の軌跡なし(手動の記録から)');
  } else if (r.basis === 'none') {
    parts.push('半径の中の位置の記録なし');
  }
  if ((r.points_low_accuracy ?? 0) > 0) parts.push(`精度が100mより悪い点 ${r.points_low_accuracy}件は使っていません`);
  const ev = (r.evidence ?? []).map((k) => EVIDENCE_LABEL[k] ?? k);
  if (ev.length) parts.push(`証拠: ${ev.join('・')}`);
  return parts.join('・') || '根拠の記録がありません';
}

export interface ActionButton { action: VisitAction; label: string }

/** 訂正の操作(今の状態で意味のあるものだけ) */
export function actionsFor(item: VisitItem): ActionButton[] {
  const a = item.assessment;
  const out: ActionButton[] = [];
  if (a?.hidden) {
    out.push({ action: 'unhide', label: '隠すのをやめる' });
    return out;
  }
  if (a?.state !== 'VERIFIED_VISIT' || a.source !== 'user') out.push({ action: 'confirm', label: '行った(確定)' });
  if (a?.state !== 'PASS_THROUGH' || a.source !== 'user') out.push({ action: 'pass_through', label: '通過だった' });
  if (a?.state !== 'REJECTED') out.push({ action: 'reject', label: '行っていない' });
  out.push({ action: 'hide', label: '地図から隠す' });
  if (a && (a.source === 'user' || a.auto_state === null)) out.push({ action: 'reset', label: '自動の判定に戻す' });
  return out;
}

export const ACTION_DONE: Record<VisitAction, string> = {
  confirm: '「行った」と確定しました', pass_through: '「通過だった」に直しました', reject: '「行っていない」に直しました',
  hide: '地図と Atlas から隠しました', unhide: '隠すのをやめました', reset: '自動の判定に戻しました',
};

export interface Projected { x: number; y: number; r: number }

/** 予定の場所を略図の座標へ写す(等距円筒。範囲に余白を付け、縦横比を保つ) */
export function project(items: VisitItem[], width: number, height: number, pad = 28): Map<string, Projected> {
  const out = new Map<string, Projected>();
  if (!items.length) return out;
  const lat0 = items.reduce((s, i) => s + i.latitude, 0) / items.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const xs = items.map((i) => i.longitude * kx);
  const ys = items.map((i) => i.latitude * ky);
  const minX = Math.min(...xs) - 400;
  const maxX = Math.max(...xs) + 400;
  const minY = Math.min(...ys) - 400;
  const maxY = Math.max(...ys) + 400;
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  const offX = (width - (maxX - minX) * scale) / 2;
  const offY = (height - (maxY - minY) * scale) / 2;
  items.forEach((it, i) => {
    out.set(it.event_id, {
      x: offX + (xs[i]! - minX) * scale,
      y: height - (offY + (ys[i]! - minY) * scale),
      r: Math.max(4, it.radius_m * scale),
    });
  });
  return out;
}
