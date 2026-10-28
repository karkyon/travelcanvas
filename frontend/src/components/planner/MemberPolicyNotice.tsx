/**
 * [Gate G2] FR-045 旅行の所有者があなたに見せない設定にした項目の知らせ(旅程の画面の上部)。
 *
 * 所有者・何も隠されていない参加者には何も出さない。取得に失敗しても旅程の操作は止めない(何も出さない)。
 */
import React, { useEffect, useState } from 'react';
import { getMemberPolicy } from '@/services/api';
import type { MemberPolicy } from '@/services/api';

interface Props {
  planId: string;
}

const MemberPolicyNotice: React.FC<Props> = ({ planId }) => {
  const [policy, setPolicy] = useState<MemberPolicy | null>(null);

  useEffect(() => {
    let alive = true;
    getMemberPolicy(planId).then((p) => { if (alive) setPolicy(p); }).catch(() => { if (alive) setPolicy(null); });
    return () => { alive = false; };
  }, [planId]);

  if (!policy || policy.role === 'owner' || policy.my_hidden.length === 0) return null;
  const labels = policy.catalog.categories.filter((c) => policy.my_hidden.includes(c.key)).map((c) => c.label);
  return (
    <p role="note" className="mb-4 rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-sm text-ink-900"
      data-testid="member-policy-notice">
      旅行の所有者が、次の項目をあなたに見せない設定にしています: {labels.join('・')}
    </p>
  );
};

export default MemberPolicyNotice;
