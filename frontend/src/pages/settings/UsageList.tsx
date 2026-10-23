/** [Gate G5] BILL-02 使用量の一覧(利用者・組織で共用)。上限の8割を越えたら注意、上限に達したら止まることを示す。 */
import React from 'react';
import type { UsageSummary } from '@/services/api/types/g5';
import { formatUsage } from './usageFormat';

const UsageList: React.FC<{ usage: UsageSummary }> = ({ usage }) => (
  <ul className="space-y-2" aria-label="使用量">
    {usage.metrics.map((row) => {
      const pct = row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 100;
      return (
        <li key={row.metric} className="text-sm">
          <div className="flex flex-wrap justify-between gap-2 text-gray-900">
            <span>{row.label}</span>
            <span>{formatUsage(row, row.used)} / {formatUsage(row, row.limit)}{row.overridden ? '(個別の上限)' : ''}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-sm mt-1" role="progressbar" aria-label={`${row.label}の使用量`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className={`h-2 rounded-sm ${row.exceeded ? 'bg-red-600' : row.warning ? 'bg-amber-500' : 'bg-blue-600'}`} style={{ width: `${pct}%` }} />
          </div>
          {row.exceeded ? (
            <p className="text-red-800 mt-1">上限に達しました。来月まで待つか、管理者に見直しを依頼してください。</p>
          ) : row.warning ? (
            <p className="text-amber-900 mt-1">上限の8割を越えました。</p>
          ) : null}
        </li>
      );
    })}
  </ul>
);

export default UsageList;
