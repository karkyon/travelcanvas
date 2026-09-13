/**
 * DocumentsPage - FR-013文書ウォレット(documents)のUI。
 *
 * [Gate R3-10] backend/app/api/v1/documents.py (Gate R3-6)はAPI/DBのみ
 * 実装済みでfrontendから一切到達不能だった(DOC-02 §1.1「画面だけ、APIだけ、
 * DBだけ存在する状態は完成としない」に反する状態)。本画面でPlannerPage
 * から到達可能にする。
 *
 * [Gate M6改訂] Gate M5でbackendにObject Storage実連携(実アップロード・
 * 暗号化保存・期限付きダウンロードURL)が追加されたため、本画面も
 * `uploadDocument`(実ファイルアップロード)経由へ切り替えた。旧来の
 * "local-pending/..."プレースホルダーによるメタデータのみ登録は廃止する
 * (ADR-object-storage.md参照)。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, FileText, Trash2, Upload, Download } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getDocuments, uploadDocument, deleteDocument, getDocumentDownloadUrl, resolveDownloadUrl } from '@/services/api';
import type { TravelDocument, DocumentClassification } from '@/services/api';

const CLASSIFICATION_OPTIONS: { value: DocumentClassification; label: string }[] = [
  { value: 'public', label: '公開' },
  { value: 'internal', label: '内部(共同編集者に通常表示)' },
  { value: 'confidential', label: '機密' },
  { value: 'restricted', label: '厳重管理' },
];

const CLASSIFICATION_LABEL: Record<string, string> = Object.fromEntries(
  CLASSIFICATION_OPTIONS.map((o) => [o.value, o.label])
);

function formatSize(bytes: number | null): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DocumentsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<TravelDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [classification, setClassification] = useState<DocumentClassification>('internal');
  const [documentType, setDocumentType] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    if (!planId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getDocuments(planId);
      setDocuments(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '文書一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const resetCreateForm = () => {
    setSelectedFile(null);
    setDocumentType('');
    setClassification('internal');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] ?? null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !selectedFile) return;
    setIsSaving(true);
    setError(null);
    try {
      await uploadDocument(planId, selectedFile, classification, documentType || undefined);
      setIsCreateOpen(false);
      resetCreateForm();
      await loadDocuments();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : detail?.message || 'アップロードに失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (doc: TravelDocument) => {
    if (!planId) return;
    if (!window.confirm(`「${doc.original_filename ?? doc.document_type ?? '文書'}」を削除しますか?`)) return;
    try {
      await deleteDocument(planId, doc.id, doc.revision);
      await loadDocuments();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '文書の削除に失敗しました');
    }
  };

  const handleDownload = async (doc: TravelDocument) => {
    if (!planId) return;
    setDownloadingId(doc.id);
    setError(null);
    try {
      const { url } = await getDocumentDownloadUrl(planId, doc.id);
      window.open(resolveDownloadUrl(url), '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : detail?.message || 'ダウンロードURLの取得に失敗しました');
    } finally {
      setDownloadingId(null);
    }
  };

  if (!planId) {
    return (
      <div className="p-8 text-center text-gray-500">
        プランが選択されていません。
        <div className="mt-4">
          <Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">
            ← プランへ戻る
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">文書ウォレット</h1>
          <p className="text-sm text-gray-500 mt-1">
            領収書・確認書等のファイルをアップロード・管理できます(暗号化して保存されます)。
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setIsCreateOpen(true)}>
          新規アップロード
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : documents.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-500">
          文書がまだ登録されていません。「新規アップロード」から追加できます。
        </Card>
      ) : (
        <div className="space-y-3">
          {documents.map((d) => (
            <Card key={d.id} padding="md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText size={20} className="text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {d.original_filename ?? '(ファイル名不明)'}
                    </div>
                    <div className="text-sm text-gray-500">
                      {CLASSIFICATION_LABEL[d.classification] ?? d.classification}
                      {d.document_type && ` ・ ${d.document_type}`}
                      {' ・ '}{formatSize(d.size)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownload(d)}
                    disabled={downloadingId === d.id}
                    className="text-gray-400 hover:text-blue-600 p-1 disabled:opacity-50"
                    aria-label="ダウンロード"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(d)}
                    className="text-gray-400 hover:text-red-600 p-1"
                    aria-label="削除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新規アップロード */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); resetCreateForm(); }}
        title="文書のアップロード"
        size="md"
      >
        <form onSubmit={handleCreate}>
          <Modal.Body>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ファイル</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="w-full text-sm"
                />
                <div className="text-xs text-gray-400 mt-1">
                  PDF・画像(jpg/png/gif/webp/bmp)・Office文書に対応。サーバー側で暗号化して保存されます。
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">分類</label>
                <select
                  value={classification}
                  onChange={(e) => setClassification(e.target.value as DocumentClassification)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {CLASSIFICATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <Input
                label="種類(任意。例: receipt/ticket/passport)"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" type="button" onClick={() => { setIsCreateOpen(false); resetCreateForm(); }}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              type="submit"
              icon={<Upload size={16} />}
              loading={isSaving}
              disabled={!selectedFile}
            >
              アップロード
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
};

export default DocumentsPage;
