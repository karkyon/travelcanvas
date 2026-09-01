import React, { useState, useCallback, useEffect } from 'react';
import { useToast } from './common/Toast';
import { api } from '../services/api';
import Button from './common/Button';
import Input from './common/Input';
import Card from './common/Card';
import Modal from './common/Modal';
import { LoadingSpinner } from './common/LoadingSpinner';
import type { TravelPlan } from '../types';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: TravelPlan;
}

interface ShareSettings {
  permission: 'view_only' | 'comment' | 'edit';
  expires_at?: string;
  share_password?: string;
  allow_public: boolean;
}

interface ShareData {
  share_url: string;
  qr_code_url: string;
  share_token: string;
  permission: string;
  expires_at?: string;
  password_protected: boolean;
}

interface Collaborator {
  id: string;
  email: string;
  name: string;
  permission: string;
  joined_at: string;
  last_active?: string;
}

const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, plan }) => {
  const { addToast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [shareSettings, setShareSettings] = useState<ShareSettings>({
    permission: 'view_only',
    allow_public: false
  });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'share' | 'invite' | 'manage'>('share');

  // 既存の共有設定を取得
  useEffect(() => {
    if (isOpen && plan.id) {
      fetchShareSettings();
      fetchCollaborators();
    }
  }, [isOpen, plan.id]);

  // 共有設定取得
  const fetchShareSettings = useCallback(async () => {
    try {
      const response = await api.get(`/travel/plans/${plan.id}/share`);
      if (response.data.data) {
        setShareData(response.data.data);
      }
    } catch (error) {
      console.log('共有設定が見つかりません');
    }
  }, [plan.id]);

  // コラボレーター一覧取得
  const fetchCollaborators = useCallback(async () => {
    try {
      const response = await api.get(`/travel/plans/${plan.id}/collaborators`);
      setCollaborators(response.data.data || []);
    } catch (error) {
      console.log('コラボレーター情報の取得に失敗');
    }
  }, [plan.id]);

  // 共有リンク作成/更新
  const createShareLink = useCallback(async () => {
    setLoading(true);
    
    try {
      const response = await api.post(`/travel/plans/${plan.id}/share`, shareSettings);
      const newShareData = response.data.data;
      
      setShareData(newShareData);
      
      addToast({
        type: 'success',
        message: '共有リンクを作成しました'
      });
      
    } catch (error: any) {
      console.error('共有リンク作成エラー:', error);
      addToast({
        type: 'error',
        message: error.response?.data?.error?.message || '共有リンクの作成に失敗しました'
      });
    } finally {
      setLoading(false);
    }
  }, [plan.id, shareSettings, addToast]);

  // 共有リンク削除
  const deleteShareLink = useCallback(async () => {
    if (!shareData || !confirm('共有リンクを削除しますか？')) return;
    
    setLoading(true);
    
    try {
      await api.delete(`/travel/plans/${plan.id}/share/${shareData.share_token}`);
      setShareData(null);
      
      addToast({
        type: 'success',
        message: '共有リンクを削除しました'
      });
      
    } catch (error: any) {
      console.error('共有リンク削除エラー:', error);
      addToast({
        type: 'error',
        message: '共有リンクの削除に失敗しました'
      });
    } finally {
      setLoading(false);
    }
  }, [plan.id, shareData, addToast]);

  // URLをクリップボードにコピー
  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast({
        type: 'success',
        message: 'クリップボードにコピーしました'
      });
    } catch (error) {
      // フォールバック
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
      addToast({
        type: 'success',
        message: 'クリップボードにコピーしました'
      });
    }
  }, [addToast]);

  // コラボレーター招待
  const inviteCollaborator = useCallback(async () => {
    if (!inviteEmail.trim()) {
      addToast({
        type: 'warning',
        message: 'メールアドレスを入力してください'
      });
      return;
    }

    setLoading(true);
    
    try {
      await api.post(`/travel/plans/${plan.id}/collaborators`, {
        email: inviteEmail.trim(),
        permission: shareSettings.permission,
        message: inviteMessage.trim() || undefined
      });
      
      setInviteEmail('');
      setInviteMessage('');
      await fetchCollaborators();
      
      addToast({
        type: 'success',
        message: '招待を送信しました'
      });
      
    } catch (error: any) {
      console.error('招待送信エラー:', error);
      addToast({
        type: 'error',
        message: error.response?.data?.error?.message || '招待の送信に失敗しました'
      });
    } finally {
      setLoading(false);
    }
  }, [plan.id, inviteEmail, inviteMessage, shareSettings.permission, addToast, fetchCollaborators]);

  // SNS共有
  const shareToSNS = useCallback((platform: 'twitter' | 'facebook' | 'line') => {
    if (!shareData) return;
    
    const url = encodeURIComponent(shareData.share_url);
    const text = encodeURIComponent(`${plan.title} - TravelCanvasで作成した旅行プラン`);
    
    let shareUrl = '';
    
    switch (platform) {
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
        break;
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
        break;
      case 'line':
        shareUrl = `https://social-plugins.line.me/lineit/share?url=${url}&text=${text}`;
        break;
    }
    
    window.open(shareUrl, '_blank', 'width=600,height=400');
  }, [shareData, plan.title]);

  // 権限表示のヘルパー
  const getPermissionLabel = useCallback((permission: string) => {
    switch (permission) {
      case 'view_only': return '👀 閲覧のみ';
      case 'comment': return '💬 コメント可能';
      case 'edit': return '✏️ 編集可能';
      case 'admin': return '👑 管理者';
      default: return permission;
    }
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="プランを共有" size="lg">
      <Modal.Body>
        {/* タブナビゲーション */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'share'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('share')}
          >
            🔗 リンク共有
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'invite'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('invite')}
          >
            📧 招待
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'manage'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('manage')}
          >
            👥 メンバー管理
          </button>
        </div>

        {/* リンク共有タブ */}
        {activeTab === 'share' && (
          <div className="space-y-6">
            {/* 権限設定 */}
            <Card>
              <Card.Header title="アクセス権限設定" />
              <Card.Body>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      アクセス権限
                    </label>
                    <select
                      value={shareSettings.permission}
                      onChange={(e) => setShareSettings(prev => ({ 
                        ...prev, 
                        permission: e.target.value as any 
                      }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="view_only">👀 閲覧のみ - プランの閲覧・印刷のみ可能</option>
                      <option value="comment">💬 コメント可能 - 閲覧とコメント追加が可能</option>
                      <option value="edit">✏️ 編集可能 - スポット追加・編集・削除が可能</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        有効期限（オプション）
                      </label>
                      <input
                        type="datetime-local"
                        value={shareSettings.expires_at || ''}
                        onChange={(e) => setShareSettings(prev => ({ 
                          ...prev, 
                          expires_at: e.target.value || undefined 
                        }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        パスワード（オプション）
                      </label>
                      <Input
                        type="password"
                        value={shareSettings.share_password || ''}
                        onChange={(e) => setShareSettings(prev => ({ 
                          ...prev, 
                          share_password: e.target.value || undefined 
                        }))}
                        placeholder="パスワードを設定"
                        fullWidth
                      />
                    </div>
                  </div>

                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={shareSettings.allow_public}
                      onChange={(e) => setShareSettings(prev => ({ 
                        ...prev, 
                        allow_public: e.target.checked 
                      }))}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">
                      検索エンジンでの公開を許可する
                    </span>
                  </label>

                  <Button
                    variant="primary"
                    onClick={createShareLink}
                    loading={loading}
                    fullWidth
                  >
                    {shareData ? '設定を更新' : '共有リンクを作成'}
                  </Button>
                </div>
              </Card.Body>
            </Card>

            {/* 共有リンク */}
            {shareData && (
              <Card>
                <Card.Header title="共有リンク" />
                <Card.Body>
                  <div className="space-y-4">
                    {/* URL */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        共有URL
                      </label>
                      <div className="flex gap-2">
                        <Input
                          value={shareData.share_url}
                          readOnly
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          onClick={() => copyToClipboard(shareData.share_url)}
                        >
                          📋 コピー
                        </Button>
                      </div>
                    </div>

                    {/* QRコード */}
                    <div className="text-center">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        QRコード
                      </label>
                      <div className="inline-block p-4 bg-white border rounded-lg">
                        <img
                          src={shareData.qr_code_url}
                          alt="QR Code"
                          className="w-32 h-32"
                        />
                      </div>
                      <div className="mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = shareData.qr_code_url;
                            link.download = `${plan.title}_qr.png`;
                            link.click();
                          }}
                        >
                          📥 ダウンロード
                        </Button>
                      </div>
                    </div>

                    {/* SNS共有 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        SNSで共有
                      </label>
                      <div className="flex gap-2 justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => shareToSNS('twitter')}
                          className="bg-blue-500 text-white hover:bg-blue-600"
                        >
                          🐦 Twitter
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => shareToSNS('facebook')}
                          className="bg-blue-800 text-white hover:bg-blue-900"
                        >
                          📘 Facebook
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => shareToSNS('line')}
                          className="bg-green-500 text-white hover:bg-green-600"
                        >
                          💚 LINE
                        </Button>
                      </div>
                    </div>

                    {/* 共有情報 */}
                    <div className="bg-gray-50 rounded-lg p-3 text-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-gray-600">権限:</span>
                          <span className="ml-1 font-medium">
                            {getPermissionLabel(shareData.permission)}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600">パスワード保護:</span>
                          <span className="ml-1 font-medium">
                            {shareData.password_protected ? '🔒 あり' : '🔓 なし'}
                          </span>
                        </div>
                        {shareData.expires_at && (
                          <div className="col-span-2">
                            <span className="text-gray-600">有効期限:</span>
                            <span className="ml-1 font-medium">
                              {new Date(shareData.expires_at).toLocaleString('ja-JP')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <Button
                      variant="danger"
                      onClick={deleteShareLink}
                      loading={loading}
                      fullWidth
                    >
                      共有リンクを削除
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            )}
          </div>
        )}

        {/* 招待タブ */}
        {activeTab === 'invite' && (
          <div className="space-y-6">
            <Card>
              <Card.Header title="メール招待" />
              <Card.Body>
                <div className="space-y-4">
                  <Input
                    label="メールアドレス"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                    fullWidth
                  />

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      権限
                    </label>
                    <select
                      value={shareSettings.permission}
                      onChange={(e) => setShareSettings(prev => ({ 
                        ...prev, 
                        permission: e.target.value as any 
                      }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="view_only">👀 閲覧のみ</option>
                      <option value="comment">💬 コメント可能</option>
                      <option value="edit">✏️ 編集可能</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      招待メッセージ（オプション）
                    </label>
                    <textarea
                      value={inviteMessage}
                      onChange={(e) => setInviteMessage(e.target.value)}
                      placeholder="一緒に旅行プランを作りましょう！"
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <Button
                    variant="primary"
                    onClick={inviteCollaborator}
                    loading={loading}
                    disabled={!inviteEmail.trim()}
                    fullWidth
                  >
                    招待を送信
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </div>
        )}

        {/* メンバー管理タブ */}
        {activeTab === 'manage' && (
          <div className="space-y-6">
            <Card>
              <Card.Header title={`コラボレーター (${collaborators.length}人)`} />
              <Card.Body>
                {collaborators.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">👥</div>
                    <p>まだコラボレーターはいません</p>
                    <p className="text-sm mt-1">招待タブからメンバーを招待しましょう</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {collaborators.map((collaborator) => (
                      <div
                        key={collaborator.id}
                        className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">
                            {collaborator.name || collaborator.email}
                          </div>
                          <div className="text-sm text-gray-500">
                            {collaborator.email}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            参加: {new Date(collaborator.joined_at).toLocaleDateString('ja-JP')}
                            {collaborator.last_active && (
                              <span className="ml-2">
                                最終アクティブ: {new Date(collaborator.last_active).toLocaleDateString('ja-JP')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">
                            {getPermissionLabel(collaborator.permission)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              // TODO: 権限変更・削除機能の実装
                            }}
                          >
                            管理
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline" onClick={onClose}>
          閉じる
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ShareModal;