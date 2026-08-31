import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Link, QrCode, Mail, Copy, Eye, Edit3, Shield, 
  Users, Trash2, Settings, CheckCircle, AlertCircle 
} from 'lucide-react';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { 
  createShareLink, 
  getShareSettings, 
  updateShareSettings,
  inviteCollaborator,
  getCollaborators,
  removeCollaborator 
} from '../services/api';

interface ShareSettings {
  share_url: string;
  qr_code_url: string;
  share_token: string;
  permission: 'view_only' | 'comment' | 'edit';
  expires_at?: string;
  password_protected: boolean;
  allow_public: boolean;
}

interface Collaborator {
  id: string;
  email: string;
  full_name: string;
  permission: 'view_only' | 'comment' | 'edit' | 'admin';
  joined_at: string;
  last_activity?: string;
  status: 'pending' | 'active' | 'inactive';
}

const SharePage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  
  const [shareSettings, setShareSettings] = useState<ShareSettings | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  // フォーム状態
  const [permission, setPermission] = useState<'view_only' | 'comment' | 'edit'>('view_only');
  const [sharePassword, setSharePassword] = useState('');
  const [allowPublic, setAllowPublic] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
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
      if (response.data) {
        setShareSettings(response.data);
        setPermission(response.data.permission);
        setAllowPublic(response.data.allow_public);
        if (response.data.expires_at) {
          setExpiryDate(response.data.expires_at.split('T')[0]);
        }
      }
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
        share_password: sharePassword || undefined,
        allow_public: allowPublic
      });
      
      setShareSettings(response.data);
      setMessage({ text: '共有リンクを作成しました', type: 'success' });
    } catch (error) {
      setMessage({ text: '共有リンクの作成に失敗しました', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateShare = async () => {
    if (!shareSettings) return;
    
    setIsSaving(true);
    try {
      await updateShareSettings(planId!, shareSettings.share_token, {
        permission,
        expires_at: expiryDate ? `${expiryDate}T23:59:59Z` : undefined,
        share_password: sharePassword || undefined,
        allow_public: allowPublic
      });
      
      await loadShareSettings();
      setMessage({ text: '共有設定を更新しました', type: 'success' });
    } catch (error) {
      setMessage({ text: '共有設定の更新に失敗しました', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = async () => {
    if (shareSettings?.share_url) {
      try {
        await navigator.clipboard.writeText(shareSettings.share_url);
        setMessage({ text: 'リンクをコピーしました', type: 'success' });
      } catch (error) {
        setMessage({ text: 'リンクのコピーに失敗しました', type: 'error' });
      }
    }
  };

  const handleInviteCollaborator = async () => {
    if (!inviteEmail) return;
    
    setIsSaving(true);
    try {
      await inviteCollaborator(planId!, {
        email: inviteEmail,
        permission: 'edit',
        message: inviteMessage
      });
      
      setInviteEmail('');
      setInviteMessage('');
      await loadCollaborators();
      setMessage({ text: 'コラボレーターを招待しました', type: 'success' });
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

  const getPermissionIcon = (perm: string) => {
    switch (perm) {
      case 'view_only': return <Eye size={16} className="text-blue-500" />;
      case 'comment': return <Edit3 size={16} className="text-yellow-500" />;
      case 'edit': return <Edit3 size={16} className="text-green-500" />;
      case 'admin': return <Shield size={16} className="text-purple-500" />;
      default: return <Eye size={16} className="text-gray-500" />;
    }
  };

  const getPermissionText = (perm: string) => {
    switch (perm) {
      case 'view_only': return '閲覧のみ';
      case 'comment': return 'コメント可';
      case 'edit': return '編集可能';
      case 'admin': return '管理者';
      default: return '不明';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">アクティブ</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">招待中</span>;
      case 'inactive':
        return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">非アクティブ</span>;
      default:
        return null;
    }
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
              
              {shareSettings ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      共有URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={shareSettings.share_url}
                        readOnly
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                      />
                      <button
                        onClick={handleCopyLink}
                        className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-1"
                      >
                        <Copy size={16} />
                        コピー
                      </button>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      QRコード
                    </label>
                    <div className="flex items-center gap-4">
                      <img
                        src={shareSettings.qr_code_url}
                        alt="QRコード"
                        className="w-24 h-24 border rounded-lg"
                      />
                      <div>
                        <p className="text-sm text-gray-600 mb-2">
                          スマホでスキャンしてアクセス
                        </p>
                        <a
                          href={shareSettings.qr_code_url}
                          download="qrcode.png"
                          className="inline-flex items-center gap-1 px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                        >
                          <QrCode size={14} />
                          ダウンロード
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Link size={48} className="mx-auto mb-4 opacity-50" />
                  <p className="mb-4">まだ共有リンクが作成されていません</p>
                </div>
              )}
            </div>

            {/* 権限設定 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Settings size={20} />
                権限設定
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    アクセス権限
                  </label>
                  <select
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="view_only">👀 閲覧のみ</option>
                    <option value="comment">💬 コメント可能</option>
                    <option value="edit">✏️ 編集可能</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    パスワード保護（任意）
                  </label>
                  <input
                    type="password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder="パスワードを設定（推奨）"
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
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="allowPublic"
                    checked={allowPublic}
                    onChange={(e) => setAllowPublic(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="allowPublic" className="ml-2 block text-sm text-gray-700">
                    検索エンジンでの公開を許可
                  </label>
                </div>
              </div>
              
              <div className="mt-6">
                {shareSettings ? (
                  <button
                    onClick={handleUpdateShare}
                    disabled={isSaving}
                    className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? '更新中...' : '設定を更新'}
                  </button>
                ) : (
                  <button
                    onClick={handleCreateShare}
                    disabled={isSaving}
                    className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? '作成中...' : '共有リンクを作成'}
                  </button>
                )}
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
                            {collaborator.full_name || collaborator.email}
                          </span>
                          {getStatusBadge(collaborator.status)}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          {getPermissionIcon(collaborator.permission)}
                          <span>{getPermissionText(collaborator.permission)}</span>
                          <span>•</span>
                          <span>{collaborator.email}</span>
                        </div>
                        {collaborator.last_activity && (
                          <p className="text-xs text-gray-400 mt-1">
                            最終アクティビティ: {new Date(collaborator.last_activity).toLocaleDateString('ja-JP')}
                          </p>
                        )}
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
                <li>パスワード保護を設定することを強く推奨します</li>
                <li>有効期限を設定することでセキュリティが向上します</li>
                <li>編集権限を与える場合は信頼できる相手にのみ付与してください</li>
                <li>不要になった共有リンクは削除してください</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SharePage;