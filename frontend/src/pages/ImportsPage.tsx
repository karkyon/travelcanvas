/**
 * ImportsPage - FR-011予約取込(import_jobs/extraction_candidates)のUI。
 *
 * [Gate R3-9] backend/app/api/v1/imports.py (Gate R3-7)はAPI/DBのみ実装
 * 済みでfrontendから一切到達不能だった(DOC-02 §1.1「画面だけ、APIだけ、
 * DBだけ存在する状態は完成としない」に反する状態)。本画面でPlannerPage
 * から到達可能にし、ジョブ作成・候補登録・accept/reject・confirmまでを
 * 縦に貫通させる。
 *
 * AI/OCR provider未導入のため、ジョブは作成時点でreview_requiredとなり、
 * 候補(抽出予定フィールド)は利用者自身が手動入力する
 * (docs/adr/ADR-import-minimal.md参照)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Check, X, FileCheck, FileX } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  getImportJobs,
  getImportJob,
  createImportJob,
  createExtractionCandidate,
  acceptExtractionCandidate,
  rejectExtractionCandidate,
  confirmImportJob,
  rejectImportJob,
} from '@/services/api';
import type { ImportJob, ImportJobDetail, ImportFieldPath } from '@/services/api';

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'アップロード済み',
  scanning: 'スキャン中',
  extracting: '抽出中',
  review_required: 'レビュー待ち',
  confirmed: '確定済み',
  rejected: '却下',
  quarantined: '隔離中',
  retry_wait: '再試行待ち',
  failed: '失敗',
};

const STATUS_COLOR: Record<string, string> = {
  review_required: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-green-100 text-green-700',
  rejected: 'bg-gray-100 text-gray-500',
};

const FIELD_PATH_OPTIONS: { value: ImportFieldPath; label: string }[] = [
  { value: 'type', label: '種類(必須。flight/accommodation等)' },
  { value: 'provider_name', label: '事業者名' },
  { value: 'confirmation_number', label: '予約番号' },
  { value: 'pin', label: 'PIN' },
  { value: 'holder_name', label: '名義' },
  { value: 'guest_count', label: '人数' },
  { value: 'start_at', label: '開始日時(ISO 8601)' },
  { value: 'end_at', label: '終了日時(ISO 8601)' },
  { value: 'total_amount', label: '金額' },
  { value: 'currency', label: '通貨' },
  { value: 'contact_phone', label: '連絡先電話番号' },
  { value: 'notes', label: 'メモ' },
];

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return value;
  }
}

const ImportsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [selected, setSelected] = useState<ImportJobDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const [newFieldPath, setNewFieldPath] = useState<ImportFieldPath>('type');
  const [newValue, setNewValue] = useState('');
  const [isAddingCandidate, setIsAddingCandidate] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const loadJobs = useCallback(async () => {
    if (!planId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getImportJobs(planId);
      setJobs(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '取込ジョブ一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const openDetail = async (job: ImportJob) => {
    if (!planId) return;
    setIsDetailLoading(true);
    try {
      const detail = await getImportJob(planId, job.id);
      setSelected(detail);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'ジョブ詳細の取得に失敗しました');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!planId || !selected) return;
    const detail = await getImportJob(planId, selected.id);
    setSelected(detail);
  };

  const closeDetail = () => {
    setSelected(null);
    setNewFieldPath('type');
    setNewValue('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId) return;
    setIsCreating(true);
    setError(null);
    try {
      await createImportJob(planId, { consent_given: consentGiven });
      setIsCreateOpen(false);
      setConsentGiven(false);
      await loadJobs();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'ジョブの作成に失敗しました');
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !selected || !newValue.trim()) return;
    setIsAddingCandidate(true);
    try {
      await createExtractionCandidate(planId, selected.id, {
        field_path: newFieldPath,
        value: newValue.trim(),
      });
      setNewValue('');
      await refreshDetail();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '候補の追加に失敗しました');
    } finally {
      setIsAddingCandidate(false);
    }
  };

  const handleAccept = async (candidateId: string) => {
    if (!planId || !selected) return;
    try {
      await acceptExtractionCandidate(planId, selected.id, candidateId);
      await refreshDetail();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '候補の承認に失敗しました');
    }
  };

  const handleReject = async (candidateId: string) => {
    if (!planId || !selected) return;
    try {
      await rejectExtractionCandidate(planId, selected.id, candidateId);
      await refreshDetail();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '候補の却下に失敗しました');
    }
  };

  const handleConfirmJob = async () => {
    if (!planId || !selected) return;
    if (!window.confirm('acceptされた候補をもとに予約を確定します。よろしいですか?')) return;
    setIsConfirming(true);
    try {
      const updated = await confirmImportJob(planId, selected.id);
      await loadJobs();
      closeDetail();
      if (updated.result_reservation_id) {
        navigate(`/planner/${planId}/reservations`);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'ジョブの確定に失敗しました(acceptされた候補にtypeが必要です)');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleRejectJob = async () => {
    if (!planId || !selected) return;
    if (!window.confirm('このジョブを却下しますか?')) return;
    try {
      await rejectImportJob(planId, selected.id);
      await loadJobs();
      closeDetail();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'ジョブの却下に失敗しました');
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
          <h1 className="text-2xl font-bold text-gray-900">予約取込</h1>
          <p className="text-sm text-gray-500 mt-1">
            メール・確認書等の内容を手動で登録し、レビューのうえ予約として確定できます。
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setIsCreateOpen(true)}>
          新規取込
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : jobs.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-500">
          取込ジョブがまだありません。「新規取込」から追加できます。
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <Card key={j.id} padding="md" hover onClick={() => openDetail(j)} className="cursor-pointer">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">取込ジョブ({formatDateTime(j.created_at)})</div>
                  <div className="text-sm text-gray-500">provider: {j.provider}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[j.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABEL[j.status] ?? j.status}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新規取込ジョブ作成 */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="新規取込ジョブ" size="sm">
        <form onSubmit={handleCreate}>
          <Modal.Body>
            <p className="text-sm text-gray-600 mb-4">
              メールや確認書の内容を、次の画面で1項目ずつ手動登録できます
              (自動抽出には対応していません)。
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-1"
              />
              <span>この取込内容を旅行プランへ登録することに同意します。</span>
            </label>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" type="button" onClick={() => setIsCreateOpen(false)}>キャンセル</Button>
            <Button variant="primary" type="submit" loading={isCreating} disabled={!consentGiven}>
              作成
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* ジョブ詳細・候補レビュー */}
      <Modal isOpen={!!selected} onClose={closeDetail} title="取込ジョブ詳細" size="lg">
        {isDetailLoading && (
          <Modal.Body><div className="flex justify-center py-8"><LoadingSpinner size="md" /></div></Modal.Body>
        )}
        {selected && !isDetailLoading && (
          <>
            <Modal.Body>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[selected.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                  {selected.result_reservation_id && (
                    <span className="text-xs text-green-700">予約作成済み</span>
                  )}
                </div>

                <div>
                  <div className="text-sm font-medium text-gray-700 mb-2">抽出候補</div>
                  <div className="space-y-2 mb-3">
                    {selected.candidates.length === 0 && (
                      <div className="text-sm text-gray-400">候補がまだ登録されていません</div>
                    )}
                    {selected.candidates.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2">
                        <div className="min-w-0">
                          <span className="font-medium">{c.field_path}</span>
                          <span className="text-gray-500"> = </span>
                          <span className="truncate">{c.value}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={
                            c.review_status === 'accepted' ? 'text-xs text-green-700'
                            : c.review_status === 'rejected' ? 'text-xs text-gray-400' : 'text-xs text-amber-700'
                          }>
                            {c.review_status === 'accepted' ? '承認済み' : c.review_status === 'rejected' ? '却下済み' : '未レビュー'}
                          </span>
                          {selected.status === 'review_required' && c.review_status === 'pending' && (
                            <>
                              <button type="button" onClick={() => handleAccept(c.id)} className="text-green-600 hover:text-green-800" aria-label="承認">
                                <Check size={16} />
                              </button>
                              <button type="button" onClick={() => handleReject(c.id)} className="text-red-500 hover:text-red-700" aria-label="却下">
                                <X size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selected.status === 'review_required' && (
                    <form onSubmit={handleAddCandidate} className="flex flex-wrap gap-2 items-end">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">項目</label>
                        <select
                          value={newFieldPath}
                          onChange={(e) => setNewFieldPath(e.target.value as ImportFieldPath)}
                          className="border rounded-lg px-2 py-1.5 text-sm"
                        >
                          {FIELD_PATH_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <Input
                        placeholder="値"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        containerClassName="flex-1 min-w-[160px]"
                      />
                      <Button type="submit" variant="outline" size="sm" loading={isAddingCandidate} disabled={!newValue.trim()}>
                        追加
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            </Modal.Body>
            {selected.status === 'review_required' && (
              <Modal.Footer>
                <Button variant="ghost" icon={<FileX size={16} />} onClick={handleRejectJob}>
                  ジョブを却下
                </Button>
                <Button variant="primary" icon={<FileCheck size={16} />} loading={isConfirming} onClick={handleConfirmJob}>
                  確定して予約を作成
                </Button>
              </Modal.Footer>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};

export default ImportsPage;
