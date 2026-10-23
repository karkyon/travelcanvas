/** [Gate G5] ORG-01 組織のロゴ(認証つきで取り出して表示する。取り出せなければ何も出さない)。 */
import React, { useEffect, useState } from 'react';
import { getOrgLogoUrl } from '@/services/api/g5';

const OrgLogo: React.FC<{ orgId: string; version: string | null; size?: number }> = ({ orgId, version, size = 48 }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    getOrgLogoUrl(orgId).then((u) => {
      made = u;
      if (alive) setUrl(u);
      else URL.revokeObjectURL(u);
    }).catch(() => setUrl(null));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [orgId, version]);
  if (!url) return null;
  return <img src={url} alt="組織のロゴ" width={size} height={size} className="rounded-sm object-contain bg-white" style={{ maxHeight: size }} />;
};

export default OrgLogo;
