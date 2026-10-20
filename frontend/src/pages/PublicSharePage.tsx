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
 *
 * [Gate F45] 本文は components/share/SharedPlanView(所有者の共有前プレビューと共通)で表示する。
 * 所有者がリンクごとに選んだ項目だけが backend から届く(FR-045)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, AlertCircle, Share2 } from 'lucide-react';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { resolvePublicShare } from '../services/api';
import type { PublicSharedPlan } from '../services/api';
import SharedPlanView from '../components/share/SharedPlanView';

type LoadState = 'loading' | 'ok' | 'needs_passcode' | 'invalid';

const PublicSharePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [plan, setPlan] = useState<PublicSharedPlan | null>(null);
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // [Gate M9-FE-B3] tokenにのみ依存するuseCallbackとし、eslint-disableを除去。
  const load = useCallback(async (withPasscode?: string) => {
    if (!token) return;
    try {
      const response = await resolvePublicShare(token, withPasscode);
      setPlan(response.data);
      setState('ok');
    } catch (error) {
      const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
      if (status === 401) {
        setState('needs_passcode');
        if (withPasscode) {
          setPasscodeError('パスコードが正しくありません');
        }
      } else {
        setState('invalid');
      }
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmitPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setPasscodeError(null);
    await load(passcode);
    setSubmitting(false);
  };

  // [Gate #41 / CA-002] 「Web Share APIおよびLINE共有導線」への対応。
  // navigator.shareが使えない環境(主にPC版ブラウザ)ではURLコピーへ
  // フォールバックする。
  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: plan?.title || 'TravelCanvas', url });
      } catch {
        // ユーザーによるキャンセル等は何もしない。
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      window.alert('リンクをコピーしました');
    } catch {
      window.prompt('このURLをコピーしてください', url);
    }
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
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400" aria-hidden="true" />
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
          <Lock size={40} className="mx-auto mb-4 text-blue-500" aria-hidden="true" />
          <h1 className="text-xl font-bold text-gray-900 mb-2 text-center">パスコードが必要です</h1>
          <p className="text-gray-600 text-sm mb-6 text-center">
            このプランを閲覧するにはパスコードの入力が必要です。
          </p>
          <form onSubmit={handleSubmitPasscode} className="space-y-4">
            <label htmlFor="public-share-passcode" className="sr-only">パスコード</label>
            <input
              id="public-share-passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="パスコード"
              aria-invalid={passcodeError ? true : undefined}
              aria-describedby={passcodeError ? 'public-share-passcode-error' : undefined}
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            {passcodeError && (
              <p id="public-share-passcode-error" className="text-sm text-red-700" role="alert">{passcodeError}</p>
            )}
            <button
              type="submit"
              disabled={submitting || !passcode}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '確認中...' : '閲覧する'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!plan) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-2">
          <div className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
            <Lock size={12} aria-hidden="true" />
            共有リンクによる閲覧専用ビュー
          </div>
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Share2 size={14} aria-hidden="true" />
            共有
          </button>
        </div>
        {/* [Gate #41] days は plan 直下(itinerary.days ではない) */}
        <SharedPlanView plan={plan} titleLevel={1} />
      </div>
    </div>
  );
};

export default PublicSharePage;
