import React, { useState, useEffect } from 'react';
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
  removeCollaborator
} from '../services/api';
import type { ShareLink, Collaborator } from '../services/api';

const SharePage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  // [Gate #30] 生の共有URLはDBに保存されないため、作成直後のこの1回しか
  // 表示できない。一覧を再取得してもここには戻ってこない。
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // フォーム状態
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [sharePasscode, setSharePasscode] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor'>('viewer');
  const [inviteMessage, setInviteMessage] = useState('');

  useEffect(() => {
    if (planId) {
      loadShareSettings();
      loadCollaborators();
    }
  }, [planId]);

  const loadShareSettings = async () => {
    try {
      const response = await getShareSettings(planId!);
      setShareLinks(response.data ?? []);
    } catch (error) {
      console.error('共有設定の取得に失敗:', error);
    }
  };

  const loadCollaborators = async () => {
    try {
      const response = await getCollaborators(planId!);
      setCollaborators(response.data);
    } catch (error) {
      console.error('コラボレーター一覧の取得に失敗:', error);
    } finally {
      setIsLoading(false);
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
      });

      setJustCreatedUrl(response.data.url ? `${window.location.origin}${response.data.url}` : null);
      setSharePasscode('');
      setMaxUses('');
      await loadShareSettings();
      setMessage({ text: '共有リンクを作成しました(URLは今だけ表示されます。必ずコピーしてください)', type: 'success' });
    } catch (error) {
      setMessage({ text: '共有リンクの作成に失敗しました', type: 'error' });
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
      await removeCollaborator(planId!, collaboratorId);
      await loadCollaborators();
      setMessage({ text: 'コラボレーターを削除しました', type: 'success' });
    } catch (error) {
      setMessage({ text: 'コラボレーターの削除に失敗しました', type: 'error' });
    }
  };

  const getPermissionIcon = (role: Collaborator['role']) => {
    switch (role) {
      case 'viewer': return <Eye size={16} className="text-blue-500" />;
      case 'editor': return <Edit3 size={16} className="text-green-500" />;
      case 'owner': return <Shield size={16} className="text-purple-500" />;
      default: return <Eye size={16} className="text-gray-500" />;
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
        return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">参加済み</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">招待中</span>;
      case 'declined':
        return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">辞退</span>;
      default:
        return null;
    }
  };

  const getShareStatusBadge = (share: ShareLink) => {
    if (share.revoked_at) {
      return <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded">失効済み</span>;
    }
    if (!share.is_active) {
      return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">無効(期限切れ/上限到達)</span>;
    }
    return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">有効</span>;
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
            className="text-blue-500 hover:text-blue-700 mb-4"
          >
            ← プランナーに戻る
          </button>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            🤝 プラン共有・権限設定
          </h1>
          <p className="text-gray-600">
            URL共有、QRコード、メール招待で柔軟な共有が可能です
          </p>
        </div>

        {/* メッセージ表示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
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
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
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
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                    />
                    <button
                      onClick={() => handleCopyLink(justCreatedUrl)}
                      className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-1"
                    >
                      <Copy size={16} />
                      コピー
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(justCreatedUrl)}`}
                      alt="QRコード"
                      className="w-20 h-20 border rounded-lg bg-white"
                    />
                    <p className="text-sm text-gray-600 flex items-center gap-1">
                      <QrCode size={14} />
                      スマホでスキャンしてアクセス
                    </p>
                  </div>
                </div>
              )}

              {shareLinks.length > 0 && (
                <div className="space-y-2 mb-4">
                  {shareLinks.map((share) => (
                    <div key={share.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg text-sm">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-gray-500">...{share.token_prefix}</span>
                          {getShareStatusBadge(share)}
                          {share.has_passcode && (
                            <span title="パスコード保護あり">
                              <Shield size={14} className="text-purple-500" />
                            </span>
                          )}
                        </div>
                        <div className="text-gray-500 text-xs">
                          {share.permission === 'edit' ? '編集可能' : '閲覧のみ'}
                          {share.max_uses != null && ` ・ 使用 ${share.use_count}/${share.max_uses}回`}
                          {share.expires_at && ` ・ 期限 ${new Date(share.expires_at).toLocaleDateString('ja-JP')}`}
                        </div>
                      </div>
                      {!share.revoked_at && (
                        <button
                          onClick={() => handleRevokeShare(share.id)}
                          className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                          title="失効させる"
                        >
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {shareLinks.length === 0 && !justCreatedUrl && (
                <div className="text-center py-8 text-gray-500">
                  <Link size={48} className="mx-auto mb-4 opacity-50" />
                  <p className="mb-4">まだ共有リンクが作成されていません</p>
                </div>
              )}
            </div>

            {/* 新規共有リンクの設定 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Settings size={20} />
                新しい共有リンクを発行
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    アクセス権限
                  </label>
                  <select
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as 'view' | 'edit')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="view">👀 閲覧のみ</option>
                    <option value="edit">✏️ 編集可能(将来対応。現在は閲覧のみ動作)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    パスコード保護（任意）
                  </label>
                  <input
                    type="password"
                    value={sharePasscode}
                    onChange={(e) => setSharePasscode(e.target.value)}
                    placeholder="設定すると閲覧時に入力が必要になります"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    有効期限（任意）
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    最大使用回数（任意）
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder="例: 10"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={handleCreateShare}
                  disabled={isSaving}
                  className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? '作成中...' : '共有リンクを発行'}
                </button>
              </div>
            </div>
          </div>

          {/* 右列: コラボレーター管理 */}
          <div className="space-y-6">
            {/* メール招待 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Mail size={20} />
                メール招待
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="collaborator@example.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    権限
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'editor')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="viewer">👀 閲覧のみ</option>
                    <option value="editor">✏️ 編集可能</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    招待メッセージ（任意）
                  </label>
                  <textarea
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
                  className="w-full px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? '招待中...' : '招待を送信'}
                </button>
              </div>
            </div>

            {/* コラボレーター一覧 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
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
                          <span className="font-medium text-gray-900">
                            {collaborator.name || collaborator.email}
                          </span>
                          {getStatusBadge(collaborator.status)}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          {getPermissionIcon(collaborator.role)}
                          <span>{getPermissionText(collaborator.role)}</span>
                          <span>•</span>
                          <span>{collaborator.email}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemoveCollaborator(collaborator.id)}
                        className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                        title="削除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Users size={48} className="mx-auto mb-4 opacity-50" />
                  <p>まだコラボレーターがいません</p>
                  <p className="text-sm">メール招待でチームメンバーを追加しましょう</p>
                </div>
              )}
            </div>
          </div>
        </div>

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
