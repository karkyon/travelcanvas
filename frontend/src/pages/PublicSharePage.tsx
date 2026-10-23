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
 *
 * [Gate G4] COL-05 Guest Travel View:
 * - 開く前に確認(info)だけを読む(使用回数を使わない)。合言葉が要るか・見える項目・見えない項目を示す
 * - 開いた後は一時トークン(画面の中だけに持つ。保存しない)で「最新を読み込む」(使用回数を使わない)
 * - 所有者が許した共有だけ、ログインした人は許された項目を自分の旅行へ複製できる
 * [Gate G4] FC-097 「問題を報告」(詐欺・有害・迷惑・大量の自動の閲覧・個人の情報・その他)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, AlertCircle, Share2, Flag, Copy, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { resolvePublicShare } from '../services/api';
import type { AbuseReason, GuestShareView, ShareInfo } from '../services/api';
import { cloneShare, getShareInfo, getShareView, reportShare } from '../services/api/g4';
import { errorDetailMessage } from '../utils/apiErrorDetail';
import SharedPlanView from '../components/share/SharedPlanView';

type LoadState = 'loading' | 'ok' | 'needs_passcode' | 'invalid';

const PublicSharePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [plan, setPlan] = useState<GuestShareView | null>(null);
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [viewToken, setViewToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<AbuseReason>('phishing');
  const [reportNote, setReportNote] = useState('');
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // [Gate M9-FE-B3] tokenにのみ依存するuseCallbackとし、eslint-disableを除去。
  const load = useCallback(async (withPasscode?: string) => {
    if (!token) return;
    try {
      const response = await resolvePublicShare(token, withPasscode);
      const view = response.data as GuestShareView;
      setPlan(view);
      setViewToken(view.view_token ?? null);
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

  // [Gate G4] 先に確認だけ読む(使用回数を使わない)。合言葉が要る時は入力を待ち、要らない時だけ開く
  useEffect(() => {
    if (!token) return;
    let alive = true;
    getShareInfo(token).then((i) => {
      if (!alive) return;
      setInfo(i);
      if (i.needs_passcode) setState('needs_passcode');
      else void load();
    }).catch((error) => {
      if (!alive) return;
      const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
      if (status === 404) setState('invalid');
      else void load(); // 確認だけ失敗した時は、以前と同じく開いて確かめる
    });
    return () => { alive = false; };
  }, [token, load]);

  const reload = async () => {
    if (!token || !viewToken) return;
    setActionError(null);
    try {
      setPlan({ ...(await getShareView(token, viewToken)), view_token: viewToken });
      setNotice('最新の内容を読み込みました');
    } catch (e) {
      const status = (e as { response?: { status?: number } } | null | undefined)?.response?.status;
      if (status === 404) setState('invalid');
      else setActionError(errorDetailMessage(e, '読み込めませんでした。もう一度リンクを開いてください'));
    }
  };

  const clone = async () => {
    if (!token || !viewToken) return;
    setActionError(null);
    try {
      const r = await cloneShare(token, viewToken);
      setNotice(`${r.message}。旅行の一覧から開けます`);
    } catch (e) {
      const status = (e as { response?: { status?: number } } | null | undefined)?.response?.status;
      // ログインしていない(この画面はログインを求めない)時は、ログインしてから開き直すよう案内する
      setActionError(status === 401 ? '複製するには、ログインしてからこのリンクを開き直してください'
        : errorDetailMessage(e, '複製できませんでした'));
    }
  };

  const report = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setActionError(null);
    try {
      await reportShare(token, reason, reportNote.trim() || undefined);
      setReportOpen(false);
      setReportNote('');
      setNotice('問題の報告を受け付けました。ありがとうございます');
    } catch (err) {
      setActionError(errorDetailMessage(err, '報告を送れませんでした'));
    }
  };

  const explained = plan?.policy_explained ?? info?.policy_explained ?? null;
  const policyPanel = explained ? (
    <details className="mt-4 text-sm text-gray-800 bg-white rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">この共有で見える情報</summary>
      <p className="mt-2">いつも見える: {explained.always.join('・')}</p>
      {explained.shown.length > 0 && <p>共有された項目: {explained.shown.map((x) => x.label).join('・')}</p>}
      {explained.hidden.length > 0 && <p>共有されていない項目: {explained.hidden.map((x) => x.label).join('・')}</p>}
      <p>どの共有でも見えない: {explained.never.join('・')}</p>
    </details>
  ) : null;

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
        <div className="max-w-md w-full bg-white rounded-xl shadow-xs p-8 text-center">
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
        <div className="max-w-md w-full bg-white rounded-xl shadow-xs p-8">
          <Lock size={40} className="mx-auto mb-4 text-blue-500" aria-hidden="true" />
          <h1 className="text-xl font-bold text-gray-900 mb-2 text-center">パスコードが必要です</h1>
          <p className="text-gray-600 text-sm mb-6 text-center">
            このプランを閲覧するにはパスコードの入力が必要です。
          </p>
          {info?.expires_at && (
            <p className="text-xs text-gray-700 mb-4 text-center">有効期限: {new Date(info.expires_at).toLocaleString('ja-JP')}</p>
          )}
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
          {policyPanel}
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
        {notice && <p role="status" className="mb-2 p-2 rounded-sm bg-green-50 text-green-900 text-sm">{notice}</p>}
        {actionError && <p role="alert" className="mb-2 p-2 rounded-sm bg-red-50 text-red-800 text-sm">{actionError}</p>}
        <div className="flex flex-wrap gap-2 mb-3">
          {viewToken && (
            <button type="button" onClick={() => void reload()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-800 bg-white">
              <RefreshCw size={14} aria-hidden="true" />最新を読み込む
            </button>
          )}
          {plan.allow_clone && viewToken && (
            <button type="button" onClick={() => void clone()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-800 bg-white">
              <Copy size={14} aria-hidden="true" />自分の旅行として複製
            </button>
          )}
        </div>
        {/* [Gate #41] days は plan 直下(itinerary.days ではない) */}
        <SharedPlanView plan={plan} titleLevel={1} />
        {policyPanel}
        <div className="mt-6 text-sm">
          {!reportOpen ? (
            <button type="button" onClick={() => setReportOpen(true)} className="inline-flex items-center gap-1 text-gray-700 underline">
              <Flag size={14} aria-hidden="true" />問題を報告
            </button>
          ) : (
            <form onSubmit={report} aria-label="問題を報告" className="bg-white border rounded-lg p-3 space-y-2">
              <label className="block text-gray-800">問題の種類
                <select className="ml-2 border rounded-sm px-2 py-1" value={reason} onChange={(e) => setReason(e.target.value as AbuseReason)}>
                  <option value="phishing">詐欺・なりすまし(ログインや支払いを求める)</option>
                  <option value="malware">有害なファイル・リンク</option>
                  <option value="spam">迷惑な宣伝</option>
                  <option value="privacy">個人の情報が公開されている</option>
                  <option value="other">その他</option>
                </select>
              </label>
              <label className="block text-gray-800">詳しく(任意)
                <textarea className="mt-1 w-full border rounded-sm px-2 py-1" rows={2} maxLength={500} value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)} />
              </label>
              <div className="flex gap-2">
                <button type="submit" className="px-3 py-1.5 rounded-sm bg-gray-800 text-white">報告する</button>
                <button type="button" className="px-3 py-1.5 rounded-sm border" onClick={() => setReportOpen(false)}>やめる</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicSharePage;
