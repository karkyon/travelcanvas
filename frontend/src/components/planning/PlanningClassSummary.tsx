/**
 * [FR059-B] 旅行相談の入口に、自分のクラスと今月の旅程相談の枠を出す(旅行が決まる前。旅行ごとの枠は下書き・旅程で出す)。
 * docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §3・§6。
 */
import React, { useEffect, useState } from 'react';
import { getMyEntitlements } from '@/services/api/planningUsage';
import type { MyEntitlements } from '@/services/api/types/planningUsage';
import { classLine } from './planningUsageModel';

const PlanningClassSummary: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [mine, setMine] = useState<MyEntitlements | null>(null);
  useEffect(() => {
    let active = true;
    getMyEntitlements().then((e) => { if (active) setMine(e); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!mine) return null;
  return (
    <p className={`text-xs text-ink-700 ${className}`.trim()} data-testid="planning-class-summary">
      <span className="font-semibold text-ink-900">AI・外部検索の利用枠</span>{' '}
      {classLine(mine)}
      {mine.class !== 'guest' && !mine.providers_connected && ' · 外部の有料の提供元は未接続(0円)'}
      {' · 旅行の費用(予算)とは別です'}
    </p>
  );
};

export default PlanningClassSummary;
