/**
 * [G11-Layout] 地図の下の「この日の移動概算」の行。
 *
 * 以前は概算を読み終わってから行が現れ、地図の枠が 24px 伸びて下の予定の一覧がずれていた
 * (docs/trace/gate-g11-layout-trace.md)。読み込み中・読めない時も同じ1行の場所を確保し、状態を文字で出す。
 * 値を作らない(読めない時は概算を出さない)。
 */
import React from 'react';
import type { RoutePreview } from '@/services/api';

export type RouteSummaryStatus = 'off' | 'loading' | 'ready' | 'failed';

interface Props {
  status: RouteSummaryStatus;
  preview: RoutePreview | null;
}

const RouteSummaryLine: React.FC<Props> = ({ status, preview }) => {
  if (status === 'off') return null;
  let body: React.ReactNode;
  if (status === 'loading') {
    body = <span className="text-ink-700">この日の移動概算を読み込んでいます…</span>;
  } else if (status === 'failed' || !preview) {
    body = <span className="text-ink-700">この日の移動概算を読めませんでした(地図と予定はそのまま使えます)</span>;
  } else if (preview.total_distance_km != null && preview.total_duration_minutes != null) {
    body = (
      <span>
        この日の移動概算: 約{preview.total_distance_km}km・約{Math.round(preview.total_duration_minutes)}分
        <span className="text-ink-700">(直線距離ベースの概算、確定値ではありません)</span>
      </span>
    );
  } else {
    body = <span className="text-ink-700">一部区間の移動概算は算出できません(位置情報不明の地点を含みます)</span>;
  }
  return (
    <div className="min-h-[1rem] text-xs text-ink-500 px-1" data-testid="route-summary" data-status={status}
      role="status" aria-busy={status === 'loading'}>
      {body}
    </div>
  );
};

export default RouteSummaryLine;
