/**
 * DocumentsPage - FR-013文書ウォレット(documents)のUI。
 *
 * [Gate R3-10] backend/app/api/v1/documents.py (Gate R3-6)はAPI/DBのみ
 * 実装済みでfrontendから一切到達不能だった(DOC-02 §1.1「画面だけ、APIだけ、
 * DBだけ存在する状態は完成としない」に反する状態)。本画面でPlannerPage
 * から到達可能にする。
 *
 * [スコープ限定] Object Storageが未導入のため、実ファイルはサーバーへ
 * 一切アップロードされない(docs/adr/ADR-documents-minimal.md参照)。
 * ファイル選択時、ブラウザのSubtleCrypto APIでSHA-256をクライアント側
 * 計算し、ファイル名・種類・サイズと共にメタデータとしてのみ登録する。
 * storage_keyは実際のオブジェクトストレージ導入までの暫定的な
 * プレースホルダー("local-pending/...")とする。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, FileText, Trash2, Upload } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getDocuments, createDocument, deleteDocument } from '@/services/api';
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

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
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
  const [computedSha256, setComputedSha256] = useState<string | null>(null);
  const [isHashing, setIsHashing] = useState(false);
  const [classification, setClassification] = useState<DocumentClassification>('internal');
  const [documentType, setDocumentType] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
    setComputedSha256(null);
    setDocumentType('');
    setClassification('internal');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setComputedSha256(null);
    if (!file) return;
    setIsHashing(true);
    try {
      const hash = await computeSha256(file);
      setComputedSha256(hash);
    } catch {
      setComputedSha256(null);
    } finally {
      setIsHashing(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !selectedFile) return;
    setIsSaving(true);
    setError(null);
    try {
      // [スコープ限定] Object Storage未導入のため、storage_keyは実体を
      // 持たないプレースホルダーとする(上部ファイルdocstring参照)。
      const storageKey = `local-pending/${Date.now()}-${selectedFile.name}`;
      await createDocument(planId, {
        classification,
        document_type: documentType || undefined,
        original_filename: selectedFile.name,
        storage_key: storageKey,
        mime_type: selectedFile.type || undefined,
        size: selectedFile.size,
        sha256: computedSha256 || undefined,
      });
      setIsCreateOpen(false);
      resetCreateForm();
      await loadDocuments();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '文書の登録に失敗しました');
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
            領収書・確認書等のメタデータを登録できます(現在は実ファイルの保存には対応していません)。
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setIsCreateOpen(true)}>
          新規登録
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : documents.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-500">
          文書がまだ登録されていません。「新規登録」から追加できます。
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
                <button
                  type="button"
                  onClick={() => handleDelete(d)}
                  className="text-gray-400 hover:text-red-600 shrink-0 p-1"
                  aria-label="削除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新規登録 */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); resetCreateForm(); }}
        title="文書メタデータの登録"
        size="md"
      >
        <form onSubmit={handleCreate}>
          <Modal.Body>
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-amber-50 text-amber-800 text-xs">
                現在はファイルの実体を保存する機能が未実装です。ファイル名・種類・
                サイズ・SHA-256ハッシュ等のメタデータのみ登録されます。
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ファイル</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="w-full text-sm"
                />
                {isHashing && <div className="text-xs text-gray-400 mt-1">SHA-256を計算中...</div>}
                {computedSha256 && (
                  <div className="text-xs text-gray-400 mt-1 truncate">SHA-256: {computedSha256}</div>
                )}
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
              disabled={!selectedFile || isHashing}
            >
              登録
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
};

export default DocumentsPage;
