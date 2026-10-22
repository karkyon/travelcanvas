/**
 * OrganizationsPage - 組織の一覧と作成(/organizations。FR-041、DOC-04 SC-31)。
 *
 * [Gate B1] 学校・会社・旅行会社などで、旅程(配布版の写し)を配り、メンバーの確認を集める。会員だけが使える。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api from '@/services/api';
import type { Organization } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { ROLE_LABEL } from '@/utils/organizations';

const OrganizationsPage: React.FC = () => {
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1d4ed8');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrgs(await api.getOrganizations());
    } catch (e) {
      setError(errorDetailMessage(e, '組織の一覧を取得できませんでした'));
      setOrgs([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createOrganization({ name, brand_color: color });
      setName('');
      await load();
    } catch (err) {
      setError(errorDetailMessage(err, '組織を作れませんでした'));
    } finally {
      setBusy(false);
    }
  };

  if (orgs === null) {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <Building2 size={28} aria-hidden="true" />
          組織
        </h1>
        <p className="text-gray-700 mb-6">
          学校・会社・旅行会社などで旅程を配り、メンバーの確認を集めます。組織の管理者でも、メンバー個人の旅行は見られません。
        </p>
        {error && <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200">{error}</p>}

        <section aria-labelledby="org-list-heading" className="mb-8">
          <h2 id="org-list-heading" className="text-lg font-semibold text-gray-900 mb-3">参加している組織</h2>
          {orgs.length === 0 ? (
            <p className="text-gray-700">まだ組織に参加していません。</p>
          ) : (
            <ul className="space-y-3">
              {orgs.map((o) => (
                <li key={o.id} className="bg-white rounded-xl shadow-xs p-4 flex items-center justify-between border-l-8"
                  style={{ borderLeftColor: o.brand_color ?? '#9ca3af' }}>
                  <div>
                    <p className="font-semibold text-gray-900">{o.name}</p>
                    <p className="text-sm text-gray-700">{ROLE_LABEL[o.role]}・メンバー {o.member_count}人</p>
                  </div>
                  <Link to={`/organizations/${o.id}`} className="px-3 py-2 rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-50"
                    aria-label={`「${o.name}」を開く`}>
                    開く
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="org-create-heading" className="bg-white rounded-xl shadow-xs p-6">
          <h2 id="org-create-heading" className="text-lg font-semibold text-gray-900 mb-3">組織を作る</h2>
          <form onSubmit={create} className="space-y-4">
            <div>
              <label htmlFor="org-name" className="block text-sm font-medium text-gray-800 mb-1">組織の名前</label>
              <input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label htmlFor="org-color" className="block text-sm font-medium text-gray-800 mb-1">ブランドの色</label>
              <input id="org-color" type="color" value={color} onChange={(e) => setColor(e.target.value)}
                className="h-10 w-20 border border-gray-300 rounded-sm" />
            </div>
            <button type="submit" disabled={busy || !name.trim()}
              className="px-4 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50">
              {busy ? '作成中…' : '組織を作る'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};

export default OrganizationsPage;
