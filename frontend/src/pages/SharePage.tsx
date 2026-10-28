/**
 * SharePage - プラン共有・権限設定(/share/:planId)。
 *
 * [Gate F45] FR-045(CA-003)項目単位の共有の規則:
 * - 共有リンクごとに閲覧者へ見せる項目を選ぶ(最小限・標準・すべて(機密を除く)、または1つずつ)
 * - 機密の項目(住所・メモ・予約の概要)は1つずつ選び、「URLを知る人なら誰でも見られる」ことの確認が要る
 * - 予約番号・チケット・文書・連絡先・正確な位置・支払いはどの設定でも見せない(一覧で示す)
 * - 発行前・発行後に「閲覧者に見える内容」をこの画面で確認できる(使用回数を消費しない。以前の
 *   「共有前プレビューを開く」は実際のURLを開くため回数を1回使っていた)
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Link, QrCode, Mail, Copy, Eye, Edit3, Shield,
  Users, Trash2, Ban, Settings, CheckCircle, AlertCircle
} from 'lucide-react';
import LoadingSpinner from '../components/common/LoadingSpinner';
import {
  createShareLink,
  getShareSettings,
  revokeShareLink,
  inviteCollaborator,
  getCollaborators,
  removeCollaborator,
  previewSharePolicy,
  previewShareLink,
} from '../services/api';
import type { ShareLink, Collaborator, ShareFieldKey, SharePolicyCatalog, SharePreset, SharePreview, ShareWithheld } from '../services/api';
import { errorDetailMessage } from '../utils/apiErrorDetail';
import SharedPlanView from '../components/share/SharedPlanView';
import { describeCollaboratorRemoval } from '../store/itemDeletionMessages';
import MemberPolicyPanel from '@/components/share/MemberPolicyPanel';
import OwnershipTransferPanel from '@/components/share/OwnershipTransferPanel';
import LocalQrCode from '../components/share/LocalQrCode';

const PRESET_BUTTONS: Array<{ value: SharePreset; label: string }> = [
  { value: 'minimal', label: '最小限' }, { value: 'standard', label: '標準' }, { value: 'all', label: 'すべて(機密を除く)' },
];
const STANDARD_FIELDS: ShareFieldKey[] = ['plan_description', 'day_titles', 'event_times'];
const WITHHELD_LABEL: Array<[keyof ShareWithheld, string]> = [
  ['confirmation_numbers', '予約番号'], ['tickets', 'チケット・QR'], ['documents', '文書'],
  ['exact_locations', '正確な位置'], ['reservations', '予約'], ['event_addresses', '予定の住所'], ['event_notes', '予定のメモ'],
];

const SharePage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  // [Gate #30] 生の共有URLはDBに保存されないため、作成直後のこの1回しか
  // 表示できない。一覧を再取得してもここには戻ってこない。
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<ShareLink | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // フォーム状態
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [sharePasscode, setSharePasscode] = useState('');
  // [Gate G4] COL-05 受け取った人が許可された項目だけを自分の旅行へ複製してよい(既定は不可)
  const [allowClone, setAllowClone] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor'>('viewer');
  const [inviteMessage, setInviteMessage] = useState('');
  // [Gate F45] 見せる項目と共有前プレビュー
  const [catalog, setCatalog] = useState<SharePolicyCatalog | null>(null);
  const [fields, setFields] = useState<ShareFieldKey[]>(STANDARD_FIELDS);
  const [ackConfidential, setAckConfidential] = useState(false);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [previewOf, setPreviewOf] = useState<string | null>(null); // null=発行前の設定、文字列=リンクの token_prefix
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewSeq = useRef(0);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  const confidentialKeys = useMemo(
    () => new Set((catalog?.fields ?? []).filter((f) => f.classification === 'confidential').map((f) => f.key)),
    [catalog],
  );
  const selectedConfidential = fields.filter((k) => confidentialKeys.has(k));
  const needsAck = selectedConfidential.length > 0 && !ackConfidential;
  const labelOf = useCallback(
    (k: ShareFieldKey) => catalog?.fields.find((f) => f.key === k)?.label ?? k,
    [catalog],
  );

  // [Gate M9-FE-B3] planIdにのみ依存するuseCallbackとし、effectの依存を正しく
  // 宣言する(発火条件は従来どおりplanId変化時のみ)。
  const loadShareSettings = useCallback(async () => {
    try {
      const response = await getShareSettings(planId!);
      setShareLinks(response.data ?? []);
    } catch (error) {
      console.error('共有設定の取得に失敗:', error);
    }
  }, [planId]);

  const loadCollaborators = useCallback(async () => {
    try {
      const response = await getCollaborators(planId!);
      setCollaborators(response.data);
    } catch (error) {
      console.error('コラボレーター一覧の取得に失敗:', error);
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    if (planId) {
      loadShareSettings();
      loadCollaborators();
    }
  }, [planId, loadShareSettings, loadCollaborators]);

  // [Gate F45] 発行前の設定で閲覧者に見える内容。機密を選んで確認していない間は取得しない(backend も 422 で拒む)
  useEffect(() => {
    if (!planId || needsAck) return;
    const id = ++previewSeq.current;
    const timer = window.setTimeout(async () => {
      try {
        const res = await previewSharePolicy(planId, {
          fields, acknowledge_confidential: fields.some((k) => confidentialKeys.has(k)) ? true : undefined,
        });
        if (id !== previewSeq.current) return;
        const loaded = res.catalog;
        setCatalog((cur) => cur ?? loaded);
        setPreview(res);
        setPreviewOf(null);
        setPreviewError(null);
      } catch (error) {
        if (id === previewSeq.current) setPreviewError(errorDetailMessage(error, '閲覧者に見える内容を取得できませんでした'));
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [planId, fields, needsAck, confidentialKeys]);

  const toggleField = (key: ShareFieldKey) => {
    setFields((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      if (!next.some((k) => confidentialKeys.has(k))) setAckConfidential(false);
      return next;
    });
  };

  const applyPreset = (preset: SharePreset) => {
    setFields(catalog?.presets[preset] ?? (preset === 'minimal' ? [] : STANDARD_FIELDS));
    setAckConfidential(false);
  };

  const showLinkPreview = async (share: ShareLink) => {
    previewSeq.current += 1; // 発行前の設定の取得結果で上書きしない
    try {
      const res = await previewShareLink(planId!, share.id);
      const loaded = res.catalog;
      setCatalog((cur) => cur ?? loaded);
      setPreview(res);
      setPreviewOf(share.token_prefix);
      setPreviewError(null);
      window.setTimeout(() => previewHeading.current?.focus(), 0);
    } catch (error) {
      setPreviewError(errorDetailMessage(error, '閲覧者に見える内容を取得できませんでした'));
    }
  };

  const handleCreateShare = async () => {
    setIsSaving(true);
    try {
      const response = await createShareLink(planId!, {
        permission,
        expires_at: expiryDate ? `${expiryDate}T23:59:59Z` : undefined,
        passcode: sharePasscode || undefined,
        max_uses: maxUses ? Number(maxUses) : undefined,
        fields,
        acknowledge_confidential: selectedConfidential.length > 0 ? ackConfidential : undefined,
        ...(allowClone ? { allow_clone: true } : {}),
      });

      setJustCreatedUrl(response.data.url ? `${window.location.origin}${response.data.url}` : null);
      setJustCreated(response.data);
      setSharePasscode('');
      setMaxUses('');
      setAllowClone(false);
      await loadShareSettings();
      setMessage({ text: '共有リンクを作成しました(URLは今だけ表示されます。必ずコピーしてください)', type: 'success' });
    } catch (error) {
      setMessage({ text: errorDetailMessage(error, '共有リンクの作成に失敗しました'), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    if (!confirm('この共有リンクを失効させますか？(この操作は取り消せません)')) return;
    try {
      await revokeShareLink(planId!, shareId);
      await loadShareSettings();
      setMessage({ text: '共有リンクを失効させました', type: 'success' });
    } catch (error) {
      setMessage({ text: '共有リンクの失効に失敗しました', type: 'error' });
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ text: 'リンクをコピーしました', type: 'success' });
    } catch (error) {
      setMessage({ text: 'リンクのコピーに失敗しました', type: 'error' });
    }
  };

  const handleInviteCollaborator = async () => {
    if (!inviteEmail) return;

    setIsSaving(true);
    try {
      await inviteCollaborator(planId!, {
        email: inviteEmail,
        role: inviteRole,
        message: inviteMessage || undefined,
      });

      setInviteEmail('');
      setInviteMessage('');
      await loadCollaborators();
      setMessage({ text: 'コラボレーターを招待しました(招待中ステータスで一覧に追加されます。メール通知は現時点では送信されません。相手にはリンクを直接共有してください)', type: 'success' });
    } catch (error) {
      setMessage({ text: 'コラボレーターの招待に失敗しました', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveCollaborator = async (collaboratorId: string) => {
    if (!confirm('このコラボレーターを削除しますか？')) return;

    try {
      // [Gate B-013] 参加者・チケット担当に割り当てられていても削除でき、割当だけが外れる
      const result = await removeCollaborator(planId!, collaboratorId);
      await loadCollaborators();
      setMessage({ text: describeCollaboratorRemoval(result.data), type: 'success' });
    } catch (error) {
      setMessage({ text: 'コラボレーターの削除に失敗しました', type: 'error' });
    }
  };

  const getPermissionIcon = (role: Collaborator['role']) => {
    switch (role) {
      case 'viewer': return <Eye size={16} className="text-blue-500" />;
      case 'editor': return <Edit3 size={16} className="text-green-500" />;
      case 'owner': return <Shield size={16} className="text-purple-500" />;
      default: return <Eye size={16} className="text-ink-500" />;
    }
  };

  const getPermissionText = (role: Collaborator['role']) => {
    switch (role) {
      case 'viewer': return '閲覧のみ';
      case 'editor': return '編集可能';
      case 'owner': return '管理者';
      default: return '不明';
    }
  };

  const getStatusBadge = (status: Collaborator['status']) => {
    switch (status) {
      case 'accepted':
        return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-sm">参加済み</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-sm">招待中</span>;
      case 'declined':
        return <span className="px-2 py-1 text-xs bg-gray-100 text-ink-900 rounded-sm">辞退</span>;
      default:
        return null;
    }
  };

  const getShareStatusBadge = (share: ShareLink) => {
    if (share.revoked_at) {
      return <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-sm">失効済み</span>;
    }
    if (!share.is_active) {
      return <span className="px-2 py-1 text-xs bg-gray-100 text-ink-900 rounded-sm">無効(期限切れ/上限到達)</span>;
    }
    return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-sm">有効</span>;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/planner')}
            className="text-blue-700 hover:text-blue-900 mb-4"
          >
            ← プランナーに戻る
          </button>
          <h1 className="text-3xl font-bold text-ink-900 mb-4">
            🤝 プラン共有・権限設定
          </h1>
          <p className="text-ink-700">
            URL共有、QRコード、メール招待で柔軟な共有が可能です
          </p>
        </div>

        {/* メッセージ表示 */}
        {message && (
          <div role={message.type === 'error' ? 'alert' : 'status'} className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-100 text-green-800 border border-green-200'
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 左列: 共有設定 */}
          <div className="space-y-6">
            {/* URL共有 */}
            <div className="bg-surface rounded-xl shadow-xs p-6">
              <h2 className="text-lg font-semibold text-ink-900 mb-4 flex items-center gap-2">
                <Link size={20} />
                URL共有
              </h2>

              {justCreatedUrl && (
                <div className="mb-4 space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800 font-medium">
                    このURLは今だけ表示されます。ページを離れると二度と表示できません。
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={justCreatedUrl}
                      readOnly
                      aria-label="発行した共有URL"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-surface text-sm"
                    />
                    <button
                      onClick={() => handleCopyLink(justCreatedUrl)}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1"
                    >
                      <Copy size={16} />
                      コピー
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    {/* [Gate E1] QRは端末内で作る(共有URLのトークンを外部へ送らない) */}
                    <LocalQrCode value={justCreatedUrl} size={80} label="共有リンクのQRコード" />
                    <p className="text-sm text-ink-700 flex items-center gap-1">
                      <QrCode size={14} aria-hidden="true" />
                      スマホでスキャンしてアクセス
                    </p>
                  </div>

                  {/* [Gate #41 / CA-002] 所有者が共有プレビューで公開内容を事前確認できる。
                      [Gate F45] 実際のURLを開くと使用回数を1回使うため、この画面のプレビューで確かめる */}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => justCreated && showLinkPreview(justCreated)}
                      className="flex-1 text-center px-3 py-2 border border-blue-300 text-blue-800 rounded-lg hover:bg-blue-100 text-sm"
                    >
                      閲覧者に見える内容を確認
                    </button>
                    <button
                      onClick={async () => {
                        if (navigator.share) {
                          try {
                            await navigator.share({ title: 'TravelCanvas', url: justCreatedUrl });
                          } catch {
                            /* ユーザーによるキャンセルは無視 */
                          }
                        } else {
                          await handleCopyLink(justCreatedUrl);
                        }
                      }}
                      className="px-3 py-2 border border-gray-300 text-ink-700 rounded-lg hover:bg-gray-50 text-sm"
                    >
                      共有する
                    </button>
                  </div>
                </div>
              )}

              {shareLinks.length > 0 && (
                <div className="space-y-2 mb-4">
                  {shareLinks.map((share) => (
                    <div key={share.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg text-sm">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-ink-700">...{share.token_prefix}</span>
                          {getShareStatusBadge(share)}
                          {share.has_passcode && (
                            <span title="パスコード保護あり" className="inline-flex items-center gap-0.5 text-xs text-purple-800">
                              <Shield size={14} aria-hidden="true" />
                              <span className="sr-only">パスコード保護あり</span>
                            </span>
                          )}
                        </div>
                        <div className="text-ink-700 text-xs">
                          {share.permission === 'edit' ? '編集可能' : '閲覧のみ'}
                          {` ・ 使用 ${share.use_count}${share.max_uses != null ? `/${share.max_uses}` : ''}回`}
                          {share.expires_at && ` ・ 期限 ${new Date(share.expires_at).toLocaleDateString('ja-JP')}`}
                          {share.last_accessed_at
                            ? ` ・ 最終閲覧 ${new Date(share.last_accessed_at).toLocaleString('ja-JP')}`
                            : ' ・ 未閲覧'}
                        </div>
                        <div className="text-ink-700 text-xs">
                          見せる項目: {share.fields.length > 0 ? share.fields.map(labelOf).join('・') : '最小限(旅行名・期間・予定名だけ)'}
                        </div>
                        {(() => {
                          // [Gate G4] COL-05 複製の可否 / FC-097 管理者・自動の対応で止めた理由
                          const g4 = share as typeof share & { allow_clone?: boolean; revoked_reason?: string | null };
                          return (
                            <div className="text-ink-700 text-xs">
                              {g4.allow_clone && '受け取った人が複製できます'}
                              {g4.revoked_reason === 'abuse_auto' && '問題の報告が続いたため自動で止めました(サポートへ連絡できます)'}
                              {g4.revoked_reason === 'admin_abuse' && '管理者が利用の規則により止めました'}
                            </div>
                          );
                        })()}
                      </div>
                      <button
                        type="button"
                        onClick={() => showLinkPreview(share)}
                        className="p-2 text-blue-800 hover:bg-blue-50 rounded-sm transition-colors"
                        aria-label={`共有リンク「...${share.token_prefix}」で見える内容を確認`}
                        title="見える内容を確認"
                      >
                        <Eye size={16} aria-hidden="true" />
                      </button>
                      {!share.revoked_at && (
                        <button
                          onClick={() => handleRevokeShare(share.id)}
                          className="p-2 text-red-700 hover:text-red-900 hover:bg-red-50 rounded-sm transition-colors"
                          title="失効させる"
                          aria-label={`共有リンク「...${share.token_prefix}」を失効させる`}
                        >
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {shareLinks.length === 0 && !justCreatedUrl && (
                <div className="text-center py-8 text-ink-700">
                  <Link size={48} className="mx-auto mb-4 opacity-50" aria-hidden="true" />
                  <p className="mb-4">まだ共有リンクが作成されていません</p>
                </div>
              )}
            </div>

            {/* 新規共有リンクの設定 */}
            <div className="bg-surface rounded-xl shadow-xs p-6">
              <h2 className="text-lg font-semibold text-ink-900 mb-4 flex items-center gap-2">
                <Settings size={20} />
                新しい共有リンクを発行
              </h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="share-permission" className="block text-sm font-medium text-ink-700 mb-2">
                    アクセス権限
                  </label>
                  <select
                    id="share-permission"
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as 'view' | 'edit')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="view">👀 閲覧のみ</option>
                    <option value="edit">✏️ 編集可能(将来対応。現在は閲覧のみ動作)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="share-passcode" className="block text-sm font-medium text-ink-700 mb-2">
                    パスコード保護（任意）
                  </label>
                  <input
                    id="share-passcode"
                    type="password"
                    value={sharePasscode}
                    onChange={(e) => setSharePasscode(e.target.value)}
                    placeholder="設定すると閲覧時に入力が必要になります"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-ink-900">
                  <input type="checkbox" checked={allowClone} onChange={(e) => setAllowClone(e.target.checked)} />
                  受け取った人が、共有した項目だけを自分の旅行として複製できるようにする
                </label>

                <div>
                  <label htmlFor="share-expiry" className="block text-sm font-medium text-ink-700 mb-2">
                    有効期限（任意）
                  </label>
                  <input
                    id="share-expiry"
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="share-max-uses" className="block text-sm font-medium text-ink-700 mb-2">
                    最大使用回数（任意）
                  </label>
                  <input
                    id="share-max-uses"
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder="例: 10"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* [Gate F45] FR-045 閲覧者に見せる項目 */}
                <fieldset className="border border-gray-200 rounded-lg p-4">
                  <legend className="px-1 text-sm font-medium text-ink-900">閲覧者に見せる項目</legend>
                  <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="まとめて選ぶ">
                    {PRESET_BUTTONS.map((p) => (
                      <button key={p.value} type="button" onClick={() => applyPreset(p.value)}
                        className="text-sm px-3 py-1 rounded-full border border-gray-300 text-ink-900 hover:bg-gray-100">
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-700 mb-2">
                    いつも見せる: {(catalog?.always ?? ['旅行名', '目的地', '期間', '予定名', '予定の種類']).join('・')}
                  </p>
                  {catalog ? (
                    <>
                      <ul className="space-y-2">
                        {catalog.fields.filter((f) => f.classification === 'internal').map((f) => (
                          <li key={f.key}>
                            <label className="flex items-start gap-2 text-sm text-ink-900">
                              <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggleField(f.key)}
                                aria-describedby={`share-field-${f.key}`} className="mt-1" />
                              <span>{f.label}<span id={`share-field-${f.key}`} className="block text-xs text-ink-700">{f.description}</span></span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-sm font-medium text-amber-900">機密の項目(必要なものだけ1つずつ選んでください)</p>
                      <ul className="space-y-2 mt-1">
                        {catalog.fields.filter((f) => f.classification === 'confidential').map((f) => (
                          <li key={f.key}>
                            <label className="flex items-start gap-2 text-sm text-ink-900">
                              <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggleField(f.key)}
                                aria-describedby={`share-field-${f.key}`} className="mt-1" />
                              <span>{f.label}(機密)<span id={`share-field-${f.key}`} className="block text-xs text-ink-700">{f.description}</span></span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {selectedConfidential.length > 0 && (
                        <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-lg">
                          <p className="text-sm text-amber-900">
                            URLを知っている人なら誰でも「{selectedConfidential.map(labelOf).join('・')}」を見られます。
                            転送やスクリーンショットで広がることがあります。
                          </p>
                          <label className="mt-2 flex items-start gap-2 text-sm text-ink-900">
                            <input type="checkbox" checked={ackConfidential} onChange={(e) => setAckConfidential(e.target.checked)} className="mt-1" />
                            機密の項目を見せることを確認しました
                          </label>
                        </div>
                      )}
                      <p className="mt-3 text-xs text-ink-700">
                        どの設定でも見せない: {catalog.restricted.map((r) => r.label).join('・')}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-ink-700">項目を読み込み中です…</p>
                  )}
                </fieldset>
              </div>

              <div className="mt-6">
                <button
                  onClick={handleCreateShare}
                  disabled={isSaving || needsAck}
                  className="w-full px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? '作成中...' : '共有リンクを発行'}
                </button>
              </div>
            </div>
          </div>

          {/* 右列: コラボレーター管理 */}
          <div className="space-y-6">
            {/* メール招待 */}
            <div className="bg-surface rounded-xl shadow-xs p-6">
              <h2 className="text-lg font-semibold text-ink-900 mb-4 flex items-center gap-2">
                <Mail size={20} />
                メール招待
              </h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="invite-email" className="block text-sm font-medium text-ink-700 mb-2">
                    メールアドレス
                  </label>
                  <input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="collaborator@example.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="invite-role" className="block text-sm font-medium text-ink-700 mb-2">
                    権限
                  </label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'editor')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="viewer">👀 閲覧のみ</option>
                    <option value="editor">✏️ 編集可能</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="invite-message" className="block text-sm font-medium text-ink-700 mb-2">
                    招待メッセージ（任意）
                  </label>
                  <textarea
                    id="invite-message"
                    value={inviteMessage}
                    onChange={(e) => setInviteMessage(e.target.value)}
                    placeholder="一緒に旅行プランを作りましょう！"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <button
                  onClick={handleInviteCollaborator}
                  disabled={!inviteEmail || isSaving}
                  className="w-full px-4 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? '招待中...' : '招待を送信'}
                </button>
              </div>
            </div>

            {/* コラボレーター一覧 */}
            <div className="bg-surface rounded-xl shadow-xs p-6">
              <h2 className="text-lg font-semibold text-ink-900 mb-4 flex items-center gap-2">
                <Users size={20} />
                コラボレーター ({collaborators.length})
              </h2>

              {collaborators.length > 0 ? (
                <div className="space-y-3">
                  {collaborators.map((collaborator) => (
                    <div
                      key={collaborator.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-ink-900">
                            {collaborator.name || collaborator.email}
                          </span>
                          {getStatusBadge(collaborator.status)}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-ink-700">
                          {getPermissionIcon(collaborator.role)}
                          <span>{getPermissionText(collaborator.role)}</span>
                          <span>•</span>
                          <span>{collaborator.email}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemoveCollaborator(collaborator.id)}
                        className="p-2 text-red-700 hover:text-red-900 hover:bg-red-50 rounded-sm transition-colors"
                        title="削除"
                        aria-label={`${collaborator.email} を削除`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-ink-700">
                  <Users size={48} className="mx-auto mb-4 opacity-50" aria-hidden="true" />
                  <p>まだコラボレーターがいません</p>
                  <p className="text-sm">メール招待でチームメンバーを追加しましょう</p>
                </div>
              )}
            </div>

            {/* [Gate G2] FR-045 参加者に見せない項目(所有者だけに表示) */}
            <MemberPolicyPanel planId={planId!} reloadKey={collaborators.length} />

            {/* [Gate G8] FR-021 所有者の移譲(所有者だけに表示) */}
            <OwnershipTransferPanel planId={planId!} reloadKey={collaborators.length} />
            <p className="mt-4 text-sm">
              <a className="text-blue-700 underline" href={`/planner/${planId}/corrections`}
                onClick={(e) => { e.preventDefault(); navigate(`/planner/${planId}/corrections`); }}>
                参加者からの情報の訂正の申し出を見る
              </a>
            </p>
          </div>
        </div>

        {/* [Gate F45] 共有前プレビュー(閲覧者に見える内容。使用回数を消費しない) */}
        <section className="mt-8 bg-surface rounded-xl shadow-xs p-6" aria-labelledby="share-preview-heading">
          <h2 id="share-preview-heading" ref={previewHeading} tabIndex={-1} className="text-lg font-semibold text-ink-900 mb-1 flex items-center gap-2">
            <Eye size={20} aria-hidden="true" />
            閲覧者に見える内容
          </h2>
          <p className="text-sm text-ink-700 mb-4" aria-live="polite">
            {previewOf ? `発行済みのリンク「...${previewOf}」で見える内容です。` : '今の設定で発行すると見える内容です。'}
            確認しても使用回数は減りません。
          </p>
          {previewError && <p role="alert" className="text-sm text-red-800 mb-3">{previewError}</p>}
          {!previewOf && needsAck && (
            <p className="text-sm text-amber-900 mb-3">機密の項目を見せることを確認すると、見える内容を表示します。</p>
          )}
          {preview && (
            <>
              {WITHHELD_LABEL.some(([k]) => preview.withheld[k] > 0) && (
                <p className="text-sm text-ink-900 mb-4">
                  見せない情報: {WITHHELD_LABEL.filter(([k]) => preview.withheld[k] > 0).map(([k, label]) => `${label} ${preview.withheld[k]}件`).join('・')}
                </p>
              )}
              <div className="border border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
                <SharedPlanView plan={preview.view} titleLevel={3} />
              </div>
            </>
          )}
        </section>

        {/* 注意事項 */}
        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-yellow-600 mt-0.5" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">💡 共有時の注意事項</p>
              <ul className="list-disc list-inside space-y-1">
                <li>共有URLは発行直後の画面でしか表示されません。必ずその場でコピーしてください</li>
                <li>パスコード保護を設定することを強く推奨します</li>
                <li>有効期限・最大使用回数を設定することでセキュリティが向上します</li>
                <li>編集権限を与える場合は信頼できる相手にのみ付与してください</li>
                <li>不要になった共有リンクは失効させてください</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SharePage;
