/**
 * AccountDeletedPage - アカウント削除の完了(FR-039)。
 *
 * [Gate P9] 削除後に表示する。この端末に保存したオフラインデータを消し、ログイン状態を消す
 * (DOC-11 §8「account deleteで削除指示」)。サーバー側のセッションは削除時に失効済みのため、
 * /auth/logout は呼ばない(401で/loginへ強制遷移してしまうため)。
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { clearAllOfflinePacks } from '@/utils/offlinePack';

const AccountDeletedPage: React.FC = () => {
  const clearLocalSession = useAuthStore((s) => s.clearLocalSession);
  const [offlineCleared, setOfflineCleared] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    // [Gate G10-Q] ログイン状態は最初に消す(オフラインのデータの消去を待つ間に、失効したトークンで要求を送らない)
    clearLocalSession();
    clearAllOfflinePacks()
      .then(() => alive && setOfflineCleared(true))
      .catch(() => alive && setOfflineCleared(false));
    return () => { alive = false; };
  }, [clearLocalSession]);

  return (
    <div className="max-w-xl mx-auto px-4 py-12 text-center">
      <h1 className="text-2xl font-bold text-gray-900">アカウントを削除しました</h1>
      <p className="text-sm text-gray-700 mt-3">ご利用ありがとうございました。すべての端末でログアウトしました。</p>
      <p className="text-sm text-gray-700 mt-1" role="status">
        {offlineCleared === null ? 'この端末に保存したオフラインデータを消しています…'
          : offlineCleared ? 'この端末に保存したオフラインデータも消しました。'
            : 'この端末のオフラインデータを消せませんでした。ブラウザのサイトデータを削除してください。'}
      </p>
      <Link to="/" className="inline-block mt-6 text-blue-800 underline">トップページへ</Link>
    </div>
  );
};

export default AccountDeletedPage;
