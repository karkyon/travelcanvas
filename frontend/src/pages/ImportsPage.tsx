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
import PageHead from '@/components/shell/PageHead';
import TripKitNav from '@/components/shell/TripKitNav';
import { KitActiveConditions, KitChips, KitNoMatch } from '@/components/shell/TripKitNav';
import { useQueryState } from '@/components/shell/tripKitModel';
import toast from 'react-hot-toast';
import { Plus, Check, X, FileCheck, FileX, Trash2 } from 'lucide-react';
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
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import BookingExtractCard from './imports/BookingExtractCard';
import InboundMailCard from './imports/InboundMailCard';
import GmailCard from './imports/GmailCard';
import BookingReviewForm from './imports/BookingReviewForm';
import { deleteImportJob } from '@/services/api/photoFeatures';

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

// [Gate TripKit] 次に必要な操作(状態ごと)
const NEXT_STEP: Record<string, string> = {
  review_required: '次: 読み取った内容を確認して登録', uploaded: '次: 読み取りを待つ', scanning: '次: 安全確認を待つ',
  extracting: '次: 読み取りを待つ', retry_wait: '次: 再試行を待つ(手入力もできます)', failed: '次: 原本を見て手入力で登録できます',
  quarantined: '次: このファイルは使えません。原本を確認してください', confirmed: '予約として登録済み', rejected: '却下済み',
};

const STATUS_COLOR: Record<string, string> = {
  review_required: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-ink-700',
};

const TYPE_LABEL: Record<string, string> = {
  accommodation: '宿泊', flight: '航空', train: '鉄道', bus: 'バス', ferry: '船', rental_car: 'レンタカー',
  restaurant: '飲食', activity: '体験', admission: '入場', other: 'その他',
};

const PROVIDER_LABEL: Record<string, string> = {
  manual: '手入力', rules: 'メールから読み取り', 'rules+openai': 'メールから読み取り(AI で補完)',
  ocr: '画像から読み取り', 'ocr+openai': '画像から読み取り(AI で補完)', none: '読み取り',
};
// [Gate TripKit] 取込トレイの状態のまとまり(実際の status から数える)
const JOB_GROUPS: { value: string; label: string; statuses: string[]; attention?: boolean }[] = [
  { value: 'review', label: '確認が必要', statuses: ['review_required'], attention: true },
  { value: 'working', label: '処理中', statuses: ['uploaded', 'scanning', 'extracting', 'retry_wait'] },
  { value: 'failed', label: '失敗・隔離', statuses: ['failed', 'quarantined'], attention: true },
  { value: 'done', label: '登録済み', statuses: ['confirmed'] },
  { value: 'rejected', label: '却下', statuses: ['rejected'] },
];
const isExtracted = (job: ImportJobDetail) => job.status === 'review_required' && job.provider !== 'manual';

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
  const [q, setQ] = useQueryState({ st: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [selected, setSelected] = useState<ImportJobDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<string[]>([]);

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
    } catch (e) {
      setError(errorDetailMessage(e, '取込ジョブ一覧の取得に失敗しました'));
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
    } catch (e) {
      setError(errorDetailMessage(e, 'ジョブ詳細の取得に失敗しました'));
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
    } catch (e) {
      setError(errorDetailMessage(e, 'ジョブの作成に失敗しました'));
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
    } catch (e) {
      setError(errorDetailMessage(e, '候補の追加に失敗しました'));
    } finally {
      setIsAddingCandidate(false);
    }
  };

  const handleAccept = async (candidateId: string) => {
    if (!planId || !selected) return;
    try {
      await acceptExtractionCandidate(planId, selected.id, candidateId);
      await refreshDetail();
    } catch (e) {
      setError(errorDetailMessage(e, '候補の承認に失敗しました'));
    }
  };

  // [Gate BookingImport] 読み取った候補を確かめた後にまとめて採用する
  const handleAcceptAll = async () => {
    if (!planId || !selected) return;
    try {
      for (const c of selected.candidates.filter((x) => x.review_status === 'pending')) {
        await acceptExtractionCandidate(planId, selected.id, c.id);
      }
      await refreshDetail();
    } catch (e) {
      setError(errorDetailMessage(e, '候補の承認に失敗しました'));
    }
  };

  const handleReject = async (candidateId: string) => {
    if (!planId || !selected) return;
    try {
      await rejectExtractionCandidate(planId, selected.id, candidateId);
      await refreshDetail();
    } catch (e) {
      setError(errorDetailMessage(e, '候補の却下に失敗しました'));
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
        // [Gate TripKit] 登録した予約の詳細へ直接移る(一覧ではなく)
        navigate(`/planner/${planId}/reservations?open=${encodeURIComponent(updated.result_reservation_id)}`);
      }
    } catch (e) {
      setError(errorDetailMessage(e, 'ジョブの確定に失敗しました(acceptされた候補にtypeが必要です)'));
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
    } catch (e) {
      setError(errorDetailMessage(e, 'ジョブの却下に失敗しました'));
    }
  };

  // [Gate BookingImportYahoo] 一覧から消す(読み取った候補も消える。登録済みの予約は残る)
  const handleDeleteJob = async (job: ImportJob) => {
    if (!planId) return;
    const tail = job.status === 'confirmed' ? '\n登録した予約は消えません。' : '';
    if (!window.confirm(`取込ジョブ(${formatDateTime(job.created_at)})を一覧から削除しますか？${tail}`)) return;
    try {
      await deleteImportJob(planId, job.id);
      setJobs((list) => list.filter((x) => x.id !== job.id));
      toast.success('取込ジョブを削除しました');
    } catch (e) {
      setError(errorDetailMessage(e, '取込ジョブを削除できませんでした'));
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
    <div className="tc-page">
      <PageHead
        eyebrow="TRIP KIT · 旅行箱"
        title="予約の取込"
        sub="予約メールや画像から読み取った内容を確認して、予約として登録します。確認する前の内容は予約の一覧に入りません。"
        actions={(
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setIsCreateOpen(true)}>
            手入力で取り込む
          </Button>
        )}
      />
      {planId && <TripKitNav planId={planId} />}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm" role="alert">{error}</div>
      )}

      {planId && <InboundMailCard planId={planId} />}
      {/* [Gate Remaining-7] FR-011 Gmail の連携 */}
      {planId && <GmailCard planId={planId} onImported={() => void loadJobs()} />}

      {planId && (
        <BookingExtractCard planId={planId} onExtracted={(job) => {
          setReviewNotes([job.ai_message, ...job.warnings].filter((n): n is string => !!n));
          setSelected(job);
          void loadJobs();
        }} />
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : jobs.length === 0 ? (
        <Card padding="lg" className="text-center text-ink-700">
          取込ジョブがまだありません。上の「予約メール・画像から読み取る」か「手入力で取り込む」から追加できます。
        </Card>
      ) : (
        <section aria-labelledby="imports-tray-title">
        <h2 id="imports-tray-title" className="tc-section-title">取込トレイ</h2>
        <KitChips label="取込の状態で絞り込む" value={q.st} onChange={(v) => setQ({ st: v })} allCount={jobs.length}
          options={JOB_GROUPS.map((g) => ({ value: g.value, label: g.label, attention: g.attention,
            count: jobs.filter((j) => g.statuses.includes(j.status)).length }))} />
        {(() => {
          const grp = JOB_GROUPS.find((g) => g.value === q.st);
          const shown = grp ? jobs.filter((j) => grp.statuses.includes(j.status)) : jobs;
          return (
            <>
              <KitActiveConditions shown={shown.length} total={jobs.length} onClearAll={() => setQ({ st: '' })}
                conditions={grp ? [{ key: 'st', label: grp.label, clear: () => setQ({ st: '' }) }] : []} />
              {shown.length === 0 ? <KitNoMatch onClearAll={() => setQ({ st: '' })} /> : (
        <ul className="space-y-3" aria-label="取込ジョブ">
          {shown.map((j) => (
            <li key={j.id}>
              {/* [Gate E1] キーボードで開けるようにボタンにする(以前は <div onClick>) */}
              <Card padding="none" hover className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => openDetail(j)}
                  aria-haspopup="dialog"
                  className="min-w-0 flex-1 text-left p-4 rounded-xl focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-ink-900">取込ジョブ({formatDateTime(j.created_at)})</div>
                      <div className="text-sm text-ink-700">{PROVIDER_LABEL[j.provider ?? ''] ?? j.provider}</div>
                      <div className="text-xs text-ink-700">{NEXT_STEP[j.status] ?? ''}{j.error_message ? ` ・ ${j.error_message}` : ''}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[j.status] ?? 'bg-gray-100 text-ink-700'}`}>
                      {STATUS_LABEL[j.status] ?? j.status}
                    </span>
                  </div>
                </button>
                {j.result_reservation_id && (
                  <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm m-2 shrink-0 self-center"
                    onClick={() => navigate(`/planner/${planId}/reservations?open=${encodeURIComponent(j.result_reservation_id!)}`)}>
                    予約を開く
                  </button>
                )}
                <button type="button" onClick={() => void handleDeleteJob(j)} data-testid={`import-job-delete-${j.id}`}
                  aria-label={`${formatDateTime(j.created_at)} の取込ジョブを削除`} title="一覧から削除"
                  className="tc-focus-ring m-2 shrink-0 self-center rounded-lg p-2 text-ink-700 hover:bg-cloud-100 hover:text-danger">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </Card>
            </li>
          ))}
        </ul>
              )}
            </>
          );
        })()}
        </section>
      )}

      {/* 新規取込ジョブ作成 */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="新規取込ジョブ" size="sm">
        <form onSubmit={handleCreate}>
          <Modal.Body>
            <p className="text-sm text-ink-700 mb-4">
              メールや確認書の内容を、次の画面で1項目ずつ手動登録できます。
              自動で読み取るには、画面の「予約メール・画像から読み取る」を使ってください。
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
      <Modal isOpen={!!selected} onClose={closeDetail} title={selected && isExtracted(selected) ? '読み取った予約の確認' : '取込ジョブ詳細'} size="lg">
        {isDetailLoading && (
          <Modal.Body><div className="flex justify-center py-8"><LoadingSpinner size="md" /></div></Modal.Body>
        )}
        {selected && !isDetailLoading && isExtracted(selected) && (
          <Modal.Body>
            <BookingReviewForm
              key={selected.id}
              planId={planId as string}
              jobId={selected.id}
              candidates={selected.candidates}
              notes={reviewNotes}
              onDone={(result) => {
                closeDetail();
                void loadJobs();
                toast.success(result.itinerary_note ? `予約を登録しました。${result.itinerary_note}` : (result.event_id ? '予約を登録し、旅程にも追加しました' : '予約を登録しました'));
                // [Gate TripKit] 登録した予約の詳細へ直接移る
                navigate(`/planner/${planId}/reservations?open=${encodeURIComponent(result.reservation_id)}`);
              }}
              onDiscard={() => void handleRejectJob()}
            />
          </Modal.Body>
        )}
        {selected && !isDetailLoading && !isExtracted(selected) && (
          <>
            <Modal.Body>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[selected.status] ?? 'bg-gray-100 text-ink-700'}`}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                  {selected.result_reservation_id && (
                    <span className="text-xs text-green-700">予約作成済み</span>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-ink-700">抽出候補</div>
                    {selected.status === 'review_required' && selected.candidates.some((x) => x.review_status === 'pending') && (
                      <Button variant="ghost" size="sm" onClick={() => void handleAcceptAll()}>確認待ちをすべて採用</Button>
                    )}
                  </div>
                  <div className="space-y-2 mb-3">
                    {selected.candidates.length === 0 && (
                      <div className="text-sm text-ink-700">候補がまだ登録されていません</div>
                    )}
                    {selected.candidates.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-sm px-3 py-2">
                        <div className="min-w-0">
                          <span className="font-medium">{FIELD_PATH_OPTIONS.find((o) => o.value === c.field_path)?.label.replace(/[(].*$/, '') ?? c.field_path}</span>
                          <span className="text-ink-700"> = </span>
                          <span className="truncate">{c.field_path === 'type' ? (TYPE_LABEL[c.value ?? ''] ?? c.value) : c.value}</span>
                          {c.evidence_locator && <span className="block text-xs text-ink-700">{`根拠: ${c.evidence_locator}`}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={
                            c.review_status === 'accepted' ? 'text-xs text-green-700'
                            : c.review_status === 'rejected' ? 'text-xs text-ink-700' : 'text-xs text-amber-800'
                          }>
                            {c.review_status === 'accepted' ? '承認済み' : c.review_status === 'rejected' ? '却下済み' : '未レビュー'}
                          </span>
                          {selected.status === 'review_required' && c.review_status === 'pending' && (
                            <>
                              <button type="button" onClick={() => handleAccept(c.id)} className="text-green-700 hover:text-green-900" aria-label={`候補「${c.field_path}」を承認`}>
                                <Check size={16} />
                              </button>
                              <button type="button" onClick={() => handleReject(c.id)} className="text-red-600 hover:text-red-800" aria-label={`候補「${c.field_path}」を却下`}>
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
                        <label htmlFor="import-candidate-field" className="block text-xs text-ink-700 mb-1">項目</label>
                        <select
                          id="import-candidate-field"
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
                        aria-label="候補の値"
                        placeholder="値"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        containerClassName="flex-1 min-w-[160px]"
                      />
                      <Button type="submit" variant="outline" size="sm" loading={isAddingCandidate} disabled={!newValue.trim()}>
                        候補を追加
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
