/**
 * PublicSharePage - 共有トークンによる公開閲覧ページ
 *
 * [Gate #30] これまで共有リンク(PlanShareLink)は発行されるだけで、それを
 * 実際に解決して閲覧する画面が存在しなかった(生成されたtokenは誰にも
 * 使われないまま終わっていた)。本ページは /s/:token でアクセスし、
 * ログイン不要でプランの閲覧専用ビューを表示する。
 *
 * 管理画面(SharePage.tsx, /share/:planId)とは意図的にpath自体を分離して
 * いる(監査指摘: 管理画面と公開画面のroute衝突解消)。
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, MapPin, Calendar, AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { resolvePublicShare } from '../services/api';
import type { PublicSharedPlan } from '../services/api';

type LoadState = 'loading' | 'ok' | 'needs_passcode' | 'invalid';

const PublicSharePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [plan, setPlan] = useState<PublicSharedPlan | null>(null);
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async (withPasscode?: string) => {
    if (!token) return;
    try {
      const response = await resolvePublicShare(token, withPasscode);
      setPlan(response.data);
      setState('ok');
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401) {
        setState('needs_passcode');
        if (withPasscode) {
          setPasscodeError('パスコードが正しくありません');
        }
      } else {
        setState('invalid');
      }
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSubmitPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setPasscodeError(null);
    await load(passcode);
    setSubmitting(false);
  };

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm p-8 text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">このリンクは無効です</h1>
          <p className="text-gray-600 text-sm">
            共有リンクが失効しているか、有効期限が切れているか、使用回数の上限に達しています。
            プランの共有者に新しいリンクの発行を依頼してください。
          </p>
        </div>
      </div>
    );
  }

  if (state === 'needs_passcode') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm p-8">
          <Lock size={40} className="mx-auto mb-4 text-blue-500" />
          <h1 className="text-xl font-bold text-gray-900 mb-2 text-center">パスコードが必要です</h1>
          <p className="text-gray-600 text-sm mb-6 text-center">
            このプランを閲覧するにはパスコードの入力が必要です。
          </p>
          <form onSubmit={handleSubmitPasscode} className="space-y-4">
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="パスコード"
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            {passcodeError && (
              <p className="text-sm text-red-600">{passcodeError}</p>
            )}
            <button
              type="submit"
              disabled={submitting || !passcode}
              className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '確認中...' : '閲覧する'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!plan) return null;

  const days: any[] = (plan.itinerary && (plan.itinerary as any).days) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-2 inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
          <Lock size={12} />
          共有リンクによる閲覧専用ビュー
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">{plan.title}</h1>
        <div className="flex flex-wrap items-center gap-4 text-gray-600 text-sm mb-6">
          {plan.destination && (
            <span className="flex items-center gap-1">
              <MapPin size={16} />
              {plan.destination}
            </span>
          )}
          {(plan.start_date || plan.end_date) && (
            <span className="flex items-center gap-1">
              <Calendar size={16} />
              {plan.start_date ? new Date(plan.start_date).toLocaleDateString('ja-JP') : '未定'}
              {' 〜 '}
              {plan.end_date ? new Date(plan.end_date).toLocaleDateString('ja-JP') : '未定'}
            </span>
          )}
        </div>

        {plan.description && (
          <p className="text-gray-700 mb-8 whitespace-pre-wrap">{plan.description}</p>
        )}

        {days.length > 0 ? (
          <div className="space-y-4">
            {days.map((day: any, idx: number) => (
              <div key={idx} className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="font-semibold text-gray-900 mb-2">
                  {day.title || `${idx + 1}日目`}
                </h2>
                {Array.isArray(day.events) && day.events.length > 0 ? (
                  <ul className="space-y-2">
                    {day.events.map((ev: any, evIdx: number) => (
                      <li key={evIdx} className="text-sm text-gray-700 border-l-2 border-blue-200 pl-3">
                        {ev.title || ev.name || '(名称未設定のイベント)'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400">予定はまだ登録されていません</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
            まだ日程が登録されていません
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicSharePage;
