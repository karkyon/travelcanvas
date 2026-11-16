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
import PasteImageButton from '@/components/media/PasteImageButton';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, FileText, Trash2, Upload, Download, Inbox, Lock, ScanText } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getDocuments, uploadDocument, deleteDocument, getDocumentDownloadUrl, resolveDownloadUrl, getDocumentLinks } from '@/services/api';
import type { TravelDocument, DocumentClassification, DocumentLink } from '@/services/api';
import { KitHead, KitTile, KitTiles } from '@/components/shell/KitParts';
import TripKitNav from '@/components/shell/TripKitNav';
import { KitActiveConditions, KitChips, KitNoMatch } from '@/components/shell/TripKitNav';
import { documentTypeLabel, useQueryState } from '@/components/shell/tripKitModel';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl, safeInternalPath } from '@/utils/safeNavigation';

const CLASSIFICATION_OPTIONS: { value: DocumentClassification; label: string }[] = [
  { value: 'public', label: '公開' },
  { value: 'internal', label: '内部(共同編集者に通常表示)' },
  { value: 'confidential', label: '機密' },
  { value: 'restricted', label: '厳重管理' },
];

const CLASSIFICATION_LABEL: Record<string, string> = Object.fromEntries(
  CLASSIFICATION_OPTIONS.map((o) => [o.value, o.label])
);

// [Gate TripKit] 処理の状態(読み取り・安全確認)。色だけでなく文字で出す
const OCR_LABEL: Record<string, string> = { pending: '読み取り待ち', processing: '読み取り中', done: '読み取り済み', completed: '読み取り済み',
  failed: '読み取り失敗', skipped: '読み取りなし', not_applicable: '読み取りなし' };
const MALWARE_LABEL: Record<string, string> = { pending: '安全確認中', scanning: '安全確認中', clean: '', infected: '危険なファイル(使えません)',
  failed: '安全確認に失敗', skipped: '' };
const LINK_ENTITY: Record<string, string> = { reservation: '予約', event: '予定', expense: '費用', ticket: 'チケット', place: '場所' };

function addedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} 追加`;
}

/** [Gate TripKit] 文書の関連先(予約・予定・費用)。押した時だけ読む(一覧で全件の関連先を読まない) */
const DocLinks: React.FC<{ planId: string; doc: TravelDocument }> = ({ planId, doc }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<DocumentLink[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && links == null) {
      try { setLinks(await getDocumentLinks(planId, doc.id)); } catch (e) { setFailed(errorDetailMessage(e, '関連先を読めませんでした')); }
    }
  };
  const go = (l: DocumentLink) => {
    if (l.entity_type === 'reservation') navigate(`/planner/${planId}/reservations?open=${encodeURIComponent(l.entity_id)}`);
    else if (l.entity_type === 'expense') navigate(`/planner/${planId}/expenses?tab=expenses`);
    else navigate(`/planner/${planId}`);
  };
  return (
    <div className="tc-doc-links">
      <button type="button" className="tc-focus-ring tc-mini-link" aria-expanded={open} onClick={() => void toggle()}>関連先</button>
      {open && (
        failed ? <p className="text-xs text-red-700" role="alert">{failed}</p>
          : links == null ? <p className="text-xs text-ink-700">読み込み中…</p>
            : links.length === 0 ? <p className="text-xs text-ink-700">まだどこにもつながっていません(予約の詳細から添付できます)</p>
              : (
                <ul className="tc-doc-links__list" aria-label={`${doc.original_filename ?? '文書'}の関連先`}>
                  {links.map((l) => (
                    <li key={l.id}><button type="button" className="tc-focus-ring tc-mini-link" onClick={() => go(l)}>
                      {`${LINK_ENTITY[l.entity_type] ?? l.entity_type}を開く`}</button></li>
                  ))}
                </ul>
              )
      )}
    </div>
  );
};

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
  const [cond, setCond] = useQueryState({ q: '', cls: '', type: '', sort: 'new' });
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
    } catch (e) {
      setError(errorDetailMessage(e, '文書一覧の取得に失敗しました'));
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
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : (detail as { message?: string })?.message || 'アップロードに失敗しました');
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
    } catch (e) {
      setError(errorDetailMessage(e, '文書の削除に失敗しました'));
    }
  };

  const handleDownload = async (doc: TravelDocument) => {
    if (!planId) return;
    setDownloadingId(doc.id);
    setError(null);
    try {
      const { url } = await getDocumentDownloadUrl(planId, doc.id);
      // [Gate G3] DEP-02 http(s) かアプリ内のパスだけ(javascript: 等は開かない)
      const target = safeExternalUrl(resolveDownloadUrl(url)) ?? safeInternalPath(resolveDownloadUrl(url));
      if (!target) throw new Error('unsafe download url');
      // [Gate M10 v23] window.open(url, '_blank', 'noopener,noreferrer')で
      // 新規タブを開く方式は、クリックというユーザー操作からURL取得の
      // await完了までの非同期な間隔により、Chromiumがユーザー操作起因の
      // ポップアップと認識できず遷移をサイレントにブロックする現象が
      // 実機(omega-dev2)で確認された(タブ自体は生成されるが
      // about:blankのまま固まり、エラーも例外も発生しないため検出が
      // 困難だった。v22で「クリック直後に同期的に空タブを開き後から
      // locationを書き換える」方式に修正したが、それでも同一の症状が
      // 再現したため、ポップアップ/新規タブを一切使わない方式に変更する)。
      // backend側は既にContent-Disposition: attachmentを付与している
      // (Gate M7)ため、非表示の<a>要素をクリックするだけで現在のタブの
      // まま直接ダウンロードがトリガーされ、実際のページ遷移は発生しない
      // (Content-Dispositionによりブラウザがナビゲーションをダウンロード
      // へ差し替えるため)。ポップアップブロッカーの対象にもならない。
      const link = document.createElement('a');
      link.href = target;
      link.rel = 'noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : (detail as { message?: string })?.message || 'ダウンロードURLの取得に失敗しました');
    } finally {
      setDownloadingId(null);
    }
  };

  if (!planId) {
    return (
      <div className="p-8 text-center text-ink-500">
        プランが選択されていません。
        <div className="mt-4">
          <Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tc-page tc-kit-page">
      <KitHead
        icon={<FileText size={14} />}
        title="文書ライブラリ"
        sub="予約確認書・チケット・領収書などを暗号化して保管し、予約・予定・費用から同じ文書を開けます(ファイルは複製しません)。"
        actions={(
          <>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => navigate(`/planner/${planId}/imports`)}><Inbox size={16} aria-hidden="true" />予約メールを取り込む</button>
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setIsCreateOpen(true)}>文書を追加</Button>
          </>
        )}
      />
      {planId && <TripKitNav planId={planId} />}

      {!isLoading && documents.length > 0 && (
        <KitTiles>
          <KitTile label="文書" icon={<FileText size={14} />} value={`${documents.length}件`} sub="この旅行に保管" />
          <KitTile label="機密・厳重管理" icon={<Lock size={14} />}
            value={`${documents.filter((d) => d.classification === 'confidential' || d.classification === 'restricted').length}件`} sub="見られる人を限っています" />
          <KitTile label="読み取り" icon={<ScanText size={14} />}
            tone={documents.some((d) => d.ocr_status === 'failed' || d.malware_status === 'infected') ? 'warn' : 'plain'}
            value={`${documents.filter((d) => d.ocr_status === 'done' || d.ocr_status === 'completed').length}件済み`}
            sub={documents.some((d) => d.ocr_status === 'failed' || d.malware_status === 'infected') ? '失敗・使えない文書があります' : '文字を読み取って検索できます'} />
        </KitTiles>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm" role="alert">{error}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : documents.length === 0 ? (
        <Card padding="lg" className="text-center text-ink-500">
          文書がまだありません。「文書を追加」でファイルを保管するか、予約メールを取り込むと原本がここに残ります。
        </Card>
      ) : (() => {
        const words = cond.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const types = Array.from(new Set(documents.map((d) => d.document_type).filter((t): t is string => !!t)));
        let shown = documents.filter((d) => (!cond.cls || d.classification === cond.cls) && (!cond.type || d.document_type === cond.type)
          && words.every((w) => [d.original_filename, d.document_type, CLASSIFICATION_LABEL[d.classification]].some((v) => (v ?? '').toLowerCase().includes(w))));
        shown = [...shown].sort((a, b) => (cond.sort === 'name'
          ? (a.original_filename ?? '').localeCompare(b.original_filename ?? '', 'ja')
          : cond.sort === 'old' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
        const clearAll = () => setCond({ q: '', cls: '', type: '' });
        const conds = [
          ...(cond.q ? [{ key: 'q', label: `「${cond.q}」`, clear: () => setCond({ q: '' }) }] : []),
          ...(cond.cls ? [{ key: 'cls', label: CLASSIFICATION_LABEL[cond.cls] ?? cond.cls, clear: () => setCond({ cls: '' }) }] : []),
          ...(cond.type ? [{ key: 'type', label: `種類: ${documentTypeLabel(cond.type) ?? cond.type}`, clear: () => setCond({ type: '' }) }] : []),
        ];
        return (
        <section aria-labelledby="docs-list-title">
          <h2 id="docs-list-title" className="sr-only">文書の一覧</h2>
          <div className="tc-kit-searchrow">
            <label className="tc-kit-searchbox">
              <span className="sr-only">文書を検索</span>
              <input type="search" value={cond.q} onChange={(e) => setCond({ q: e.target.value })} placeholder="ファイル名・種類で検索" />
            </label>
            <label className="tc-kit-select"><span className="sr-only">並べ替え</span>
              <select value={cond.sort} onChange={(e) => setCond({ sort: e.target.value })}>
                <option value="new">追加が新しい順</option><option value="old">追加が古い順</option><option value="name">名前の順</option>
              </select>
            </label>
          </div>
          <KitChips label="分類で絞り込む" value={cond.cls} onChange={(v) => setCond({ cls: v })} allCount={documents.length}
            options={CLASSIFICATION_OPTIONS.map((o) => ({ value: o.value, label: o.label.replace(/\(.*\)/, ''),
              count: documents.filter((d) => d.classification === o.value).length })).filter((o) => o.count > 0)} />
          {types.length > 0 && (
            <KitChips label="種類で絞り込む" allLabel="種類すべて" value={cond.type} onChange={(v) => setCond({ type: v })}
              options={types.map((t) => ({ value: t, label: documentTypeLabel(t) ?? t, count: documents.filter((d) => d.document_type === t).length }))} />
          )}
          <KitActiveConditions conditions={conds} shown={shown.length} total={documents.length} onClearAll={clearAll} />
          {shown.length === 0 ? <KitNoMatch onClearAll={clearAll} /> : (
        <ul className="tc-kit-list tc-kit-cardlist" aria-label="文書">
          {shown.map((d) => (
            <li key={d.id} className="tc-kit-docrow">
            <Card padding="md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="tc-kit-icon" aria-hidden="true"
                    data-tone={d.malware_status === 'infected' || d.ocr_status === 'failed' ? 'warn' : undefined}><FileText size={18} /></span>
                  <div className="min-w-0">
                    <div className="font-medium text-ink-900 truncate">
                      {d.original_filename ?? '(ファイル名不明)'}
                    </div>
                    <div className="text-sm text-ink-500">
                      {CLASSIFICATION_LABEL[d.classification] ?? d.classification}
                      {d.document_type && ` ・ ${documentTypeLabel(d.document_type)}`}
                      {' ・ '}{formatSize(d.size)}
                      {' ・ '}{addedDate(d.created_at)}
                    </div>
                    {(OCR_LABEL[d.ocr_status] || MALWARE_LABEL[d.malware_status]) && (
                      <div className="text-xs text-ink-700">{[MALWARE_LABEL[d.malware_status], OCR_LABEL[d.ocr_status]].filter(Boolean).join(' ・ ')}</div>
                    )}
                    {planId && <DocLinks planId={planId} doc={d} />}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownload(d)}
                    disabled={downloadingId === d.id}
                    className="tc-focus-ring tc-kit-iconbtn"
                    aria-label={`${d.original_filename ?? '文書'}をダウンロード`}
                  >
                    <Download size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(d)}
                    className="tc-focus-ring tc-kit-iconbtn tc-kit-iconbtn--danger"
                    aria-label={`${d.original_filename ?? '文書'}を削除`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </Card>
            </li>
          ))}
        </ul>
          )}
        </section>
        );
      })()}

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
                <label className="block text-sm font-medium text-ink-700 mb-1">ファイル</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="w-full text-sm"
                />
                <div className="text-xs text-ink-700 mt-1">
                  PDF・画像(jpg/png/gif/webp/bmp)・Office文書に対応。サーバー側で暗号化して保存されます。
                </div>
                {/* [Gate PhotoPasteAll] チケット・予約の画面のスクリーンショットはクリップボードから貼れる */}
                <PasteImageButton onImage={(f) => setSelectedFile(f)} testId="document-paste" />
                {selectedFile && <p className="text-xs text-ink-700 mt-1" data-testid="document-file-name">{`入れるファイル: ${selectedFile.name}`}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">分類</label>
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
