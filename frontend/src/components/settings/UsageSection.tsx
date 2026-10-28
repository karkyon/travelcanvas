/**
 * [Gate G5] BILL-02 今月の使用量(設定 → 使用量)。上限は月ごと(UTC の月で数える)。
 * 上限に達した操作(アップロード・取込・移動の候補・共有リンク)は止まり、来月か、管理者の見直しで再開する。
 */
import React, { useEffect, useState } from 'react';
import { getMyUsage } from '@/services/api/g5';
import type { UsageSummary } from '@/services/api/types/g5';
import UsageList from '@/pages/settings/UsageList';

const UsageSection: React.FC = () => {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getMyUsage().then(setUsage).catch(() => setFailed(true));
  }, []);
  return (
    <section aria-labelledby="usage-heading" className="space-y-3">
      <h2 id="usage-heading" className="text-lg font-semibold text-ink-900">今月の使用量{usage ? `(${usage.period})` : ''}</h2>
      {failed && <p className="text-sm text-ink-700">使用量を取得できませんでした。時間をおいて開き直してください。</p>}
      {usage && <UsageList usage={usage} />}
    </section>
  );
};

export default UsageSection;
