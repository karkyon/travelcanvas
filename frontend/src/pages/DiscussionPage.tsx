/**
 * DiscussionPage - 相談・投票(SC-19 合意形成 / SC-20 コメント)。
 *
 * [Gate P3] backend/app/api/v1/discussion.py の画面。2つのタブで構成する:
 *   - 投票(FR-022): 候補の比較。Love/OK/懸念/不可/棄権、合意状態、未回答者、懸念の解決、決定
 *   - コメント(FR-024): プラン全体へのコメント・返信・メンション(相手に通知)
 * 投票の作成・締切・決定は編集者以上。回答・コメントは閲覧者も行える(権限はbackendが判定する)。
 * [Gate G4] COL-02 定足数・候補箱の候補を選択肢にする・決定を旅程に反映(確認の後)・反映を元に戻す。
 * [Gate G4] COL-03 ?target=event|reservation|expense&id= で、その予定・予約・費用へのコメントを開く(通知・各画面から)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  api, createComment, createPoll, deleteComment, deletePoll, extractApiErrorDetailMessage, getCandidates, getComments,
  getPlanMembers, getPolls, putVotes, resolveVote, updateComment, updatePoll,
} from '@/services/api';
import type {
  CommentCreateData, CommentTargetType, NormalizedDay, PlanCandidateItem, PlanComment, PlanMember, Poll, VetoPolicy, VoteInput,
} from '@/services/api';
import { adoptionPreview, adoptPoll, undoAdoptPoll } from '@/services/api/g4';
import AdoptDialog from './discussion/AdoptDialog';
import PlanNotificationLevel from '@/components/notifications/PlanNotificationLevel';
import PollCard from './discussion/PollCard';
import CommentsPanel from './discussion/CommentsPanel';
import { VETO_POLICY_OPTIONS } from './discussion/discussionModel';
import { localToIso } from './preparation/preparationModel';

type Tab = 'polls' | 'comments';

const TARGET_LABEL: Record<CommentTargetType, string> = {
  plan: '旅行全体', event: 'この予定', reservation: 'この予約', expense: 'この費用', poll: 'この投票',
};

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  // [Gate G2] {code, message}(所有者が見せない設定にした項目の 403 等)は message を出す
  const message = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as { message?: unknown }).message : null;
  return extractApiErrorDetailMessage(detail) ?? (typeof message === 'string' && message ? message : fallback);
}

const inputClass = 'w-full border rounded-lg px-3 py-2';

interface PollForm {
  title: string;
  description: string;
  deadline_local: string;
  veto_policy: VetoPolicy;
  is_anonymous: boolean;
  options: string[];
  /** [Gate G4] COL-02 候補箱から選んだ選択肢 */
  candidate_ids: string[];
  quorum: string;
}

const emptyPollForm = (): PollForm => ({
  title: '', description: '', deadline_local: '', veto_policy: 'block', is_anonymous: false, options: ['', ''],
  candidate_ids: [], quorum: '',
});

const DiscussionPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // [Gate G4] COL-03 対象ごとのコメント(予定・予約・費用)。不明な値は旅行全体のコメントとして扱う
  const rawTarget = params.get('target');
  const targetId = params.get('id');
  const target: { type: CommentTargetType; id?: string } =
    (rawTarget === 'event' || rawTarget === 'reservation' || rawTarget === 'expense') && targetId
      ? { type: rawTarget, id: targetId } : { type: 'plan' };
  const targetLabel = TARGET_LABEL[target.type];
  const [tab, setTab] = useState<Tab>(target.type === 'plan' ? 'polls' : 'comments');
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollForm, setPollForm] = useState<PollForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [candidates, setCandidates] = useState<PlanCandidateItem[]>([]);
  const [adopting, setAdopting] = useState<Poll | null>(null);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const me = useMemo(() => members.find((m) => m.is_me) ?? null, [members]);
  const canEdit = me?.role === 'owner' || me?.role === 'editor';

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [m, p, c] = await Promise.all([getPlanMembers(planId), getPolls(planId), getComments(planId, target)]);
      setMembers(m);
      setPolls(p);
      setComments(c);
    } catch (e) {
      setError(errorMessage(e, '相談・投票の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId, target.type, target.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setError(null);
    let ok = true;
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e, fallback));
      ok = false;
    }
    await load();
    return ok;
  };

  const submitPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !pollForm) return;
    const title = pollForm.title.trim();
    const options = pollForm.options.map((o) => o.trim()).filter(Boolean);
    if (!title) return setFormError('題名を入力してください');
    if (options.length + pollForm.candidate_ids.length === 0) return setFormError('選択肢を1つ以上入力してください');
    let quorum: number | undefined;
    if (pollForm.quorum.trim()) {
      quorum = Number(pollForm.quorum);
      if (!Number.isInteger(quorum) || quorum < 1 || quorum > 100) return setFormError('定足数は1〜100の整数で入力してください');
    }
    if (new Set(options).size !== options.length) return setFormError('同じ名前の選択肢があります');
    let deadline: string | undefined;
    if (pollForm.deadline_local) {
      const iso = localToIso(pollForm.deadline_local);
      if (!iso) return setFormError('締切の日時が正しくありません');
      deadline = iso;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await createPoll(planId, {
        title, options: [...options.map((label) => ({ label })), ...pollForm.candidate_ids.map((candidate_id) => ({ candidate_id }))],
        veto_policy: pollForm.veto_policy, is_anonymous: pollForm.is_anonymous,
        ...(quorum ? { quorum } : {}),
        ...(pollForm.description.trim() ? { description: pollForm.description.trim() } : {}),
        ...(deadline ? { deadline_at: deadline } : {}),
      });
      setPollForm(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err, '投票の作成に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const submitVotes = async (p: Poll, votes: VoteInput[]) => {
    if (!planId) return;
    await run(() => putVotes(planId, p.id, votes), '回答の送信に失敗しました');
  };

  const decide = (p: Poll, optionId: string) => {
    if (!planId) return;
    const label = p.options.find((o) => o.id === optionId)?.label ?? '';
    if (!window.confirm(`「${label}」に決定して投票を締め切りますか?`)) return;
    void run(() => updatePoll(planId, p.id, { decided_option_id: optionId }, p.revision), '決定に失敗しました');
  };

  const openPollForm = () => {
    setFormError(null);
    setPollForm(emptyPollForm());
    if (planId) {
      // 候補箱の候補(見送り・まとめた物を除く)を選択肢にできる
      getCandidates(planId).then((l) => setCandidates(l.items.filter((c) => c.status !== 'dismissed' && !c.merged_into_id)))
        .catch(() => setCandidates([]));
    }
  };

  const openAdopt = async (p: Poll) => {
    if (!planId) return;
    setError(null);
    try {
      const detail = await api.getPlanDetail(planId);
      setDays(detail.data?.days ?? []);
    } catch {
      setDays([]);
    }
    setAdopting(p);
  };

  const previewAdopt = async (p: Poll, input: { day_id: string | null; local_start_time: string | null; remove_others: boolean }) => {
    if (!planId) return null;
    try {
      return await adoptionPreview(planId, p.id, input);
    } catch (e) {
      setError(errorMessage(e, '反映の内容を確かめられませんでした'));
      return null;
    }
  };

  const doAdopt = async (p: Poll, input: { day_id: string | null; local_start_time: string | null; remove_others: boolean },
    revision: number) => {
    if (!planId) return false;
    const ok = await run(() => adoptPoll(planId, p.id, input, revision), '旅程に反映できませんでした');
    if (ok) setNotice(`「${p.title}」の決定を旅程に反映しました`);
    return ok;
  };

  const undoAdopt = async (p: Poll) => {
    if (!planId || !window.confirm(`「${p.title}」の反映を元に戻しますか?`)) return;
    const detail = await api.getPlanDetail(planId).catch(() => null);
    const revision = detail?.data?.revision;
    if (revision === undefined) {
      setError('旅行の最新の状態を読めませんでした');
      return;
    }
    const ok = await run(() => undoAdoptPoll(planId, p.id, revision), '反映を元に戻せませんでした');
    if (ok) setNotice(`「${p.title}」の反映を元に戻しました`);
  };

  const createCommentFor = (data: CommentCreateData) =>
    planId ? run(() => createComment(planId, target.type === 'plan' ? data
      : { ...data, target_type: target.type, target_id: target.id }), 'コメントの投稿に失敗しました') : Promise.resolve(false);

  if (!planId) {
    return (
      <div className="p-8 text-center text-ink-700">
        プランが選択されていません。
        <div className="mt-4"><Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
        <h1 className="text-2xl font-bold text-ink-900">相談・投票</h1>
        <p className="text-sm text-ink-700 mt-1">候補を投票で決め、気になることはコメントで相談します。</p>
        <div className="mt-2"><PlanNotificationLevel planId={planId} /></div>
      </div>

      <div role="tablist" aria-label="相談・投票の表示切替" className="flex gap-2 mb-4 border-b">
        {(['polls', 'comments'] as const).map((t) => (
          <button key={t} id={`disc-tab-${t}`} type="button" role="tab" aria-selected={tab === t}
            aria-controls={`disc-panel-${t}`} onClick={() => setTab(t)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${tab === t ? 'border-blue-600 text-blue-800' : 'border-transparent text-ink-700'}`}>
            {t === 'polls' ? `投票(${polls.length})` : `コメント(${comments.filter((c) => !c.is_deleted).length})`}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {notice && <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{notice}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <div role="tabpanel" id={`disc-panel-${tab}`} aria-labelledby={`disc-tab-${tab}`}>
          {tab === 'polls' && (
            <div className="space-y-4">
              {canEdit && (
                <Button variant="primary" size="sm" icon={<Plus size={16} />}
                  onClick={openPollForm}>
                  投票を作成
                </Button>
              )}
              {polls.length === 0 ? (
                <Card padding="lg" className="text-center text-ink-700">投票はまだありません。</Card>
              ) : polls.map((p) => (
                <PollCard key={p.id} poll={p} onSubmitVotes={submitVotes}
                  onResolve={(poll, voteId, resolved) => void run(() => resolveVote(planId, poll.id, voteId, resolved), '懸念の更新に失敗しました')}
                  onDecide={decide}
                  onToggleClosed={(poll) => void run(() => updatePoll(planId, poll.id, { status: poll.status === 'closed' ? 'open' : 'closed' }, poll.revision), '投票の更新に失敗しました')}
                  onDelete={(poll) => { if (window.confirm(`投票「${poll.title}」を削除しますか?`)) void run(() => deletePoll(planId, poll.id, poll.revision), '投票の削除に失敗しました'); }}
                  onAdopt={(poll) => void openAdopt(poll)}
                  onUndoAdopt={(poll) => void undoAdopt(poll)}
                />
              ))}
            </div>
          )}
          {tab === 'comments' && target.type !== 'plan' && (
            <div className="mb-3 p-3 rounded-lg bg-indigo-50 text-indigo-900 text-sm flex flex-wrap items-center gap-2" role="note">
              <span>{targetLabel}へのコメントを表示しています。</span>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/discussion`)}>旅行全体のコメントへ</Button>
            </div>
          )}
          {tab === 'comments' && (
            <CommentsPanel comments={comments} members={members} onCreate={createCommentFor}
              onToggleResolved={(c) => void run(() => updateComment(planId, c.id, { status: c.status === 'resolved' ? 'open' : 'resolved' }, c.revision), 'コメントの更新に失敗しました')}
              onEdit={(c, body) => run(() => updateComment(planId, c.id, { body }, c.revision), 'コメントの更新に失敗しました')}
              onDelete={(c) => { if (window.confirm('このコメントを削除しますか?')) void run(() => deleteComment(planId, c.id, c.revision), 'コメントの削除に失敗しました'); }}
            />
          )}
        </div>
      )}

      {adopting && (
        <AdoptDialog poll={adopting} days={days} onClose={() => setAdopting(null)}
          onPreview={(input) => previewAdopt(adopting, input)}
          onAdopt={(input, revision) => doAdopt(adopting, input, revision)} />
      )}

      <Modal isOpen={pollForm !== null} onClose={() => setPollForm(null)} title="投票の作成" size="md">
        {pollForm && (
          <form onSubmit={submitPoll} noValidate>
            <Modal.Body>
              <div className="space-y-4">
                {formError && <div className="p-2 rounded-sm bg-red-50 text-red-800 text-sm" role="alert">{formError}</div>}
                <div>
                  <label htmlFor="poll-title" className="block text-sm font-medium text-ink-900 mb-1">題名</label>
                  <input id="poll-title" className={inputClass} maxLength={200} value={pollForm.title}
                    onChange={(e) => setPollForm({ ...pollForm, title: e.target.value })} placeholder="例: 2日目の夕食" />
                </div>
                <fieldset>
                  <legend className="block text-sm font-medium text-ink-900 mb-1">選択肢</legend>
                  <div className="space-y-2">
                    {pollForm.options.map((o, i) => (
                      <input key={i} aria-label={`選択肢${i + 1}`} className={inputClass} maxLength={200} value={o}
                        onChange={(e) => setPollForm({ ...pollForm, options: pollForm.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                    ))}
                  </div>
                  {candidates.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm text-ink-900">候補箱から選ぶ</p>
                      <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                        {candidates.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={pollForm.candidate_ids.includes(c.id)}
                              onChange={(e) => setPollForm({ ...pollForm, candidate_ids: e.target.checked
                                ? [...pollForm.candidate_ids, c.id] : pollForm.candidate_ids.filter((x) => x !== c.id) })} />
                            {c.title}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {pollForm.options.length < 10 && (
                    <Button variant="ghost" size="sm" type="button" className="mt-1"
                      onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })}>選択肢を追加</Button>
                  )}
                </fieldset>
                <div>
                  <label htmlFor="poll-deadline" className="block text-sm font-medium text-ink-900 mb-1">締切(任意)</label>
                  <input id="poll-deadline" type="datetime-local" className={inputClass} value={pollForm.deadline_local}
                    onChange={(e) => setPollForm({ ...pollForm, deadline_local: e.target.value })} />
                </div>
                <fieldset>
                  <legend className="block text-sm font-medium text-ink-900 mb-1">「不可」の扱い</legend>
                  <div className="space-y-1 text-sm">
                    {VETO_POLICY_OPTIONS.map((o) => (
                      <label key={o.value} className="flex items-center gap-1">
                        <input type="radio" name="veto-policy" checked={pollForm.veto_policy === o.value}
                          onChange={() => setPollForm({ ...pollForm, veto_policy: o.value })} />
                        {o.label}({o.help})
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label htmlFor="poll-quorum" className="block text-sm font-medium text-ink-900 mb-1">定足数(任意。決定に要る回答者の人数)</label>
                  <input id="poll-quorum" inputMode="numeric" className={inputClass} value={pollForm.quorum}
                    onChange={(e) => setPollForm({ ...pollForm, quorum: e.target.value })} placeholder="例: 3" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={pollForm.is_anonymous}
                    onChange={(e) => setPollForm({ ...pollForm, is_anonymous: e.target.checked })} />
                  匿名にする(誰がどう回答したかを本人以外に表示しない)
                </label>
                <div>
                  <label htmlFor="poll-description" className="block text-sm font-medium text-ink-900 mb-1">説明(任意)</label>
                  <textarea id="poll-description" className={inputClass} rows={2} maxLength={1000} value={pollForm.description}
                    onChange={(e) => setPollForm({ ...pollForm, description: e.target.value })} />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" type="button" onClick={() => setPollForm(null)}>キャンセル</Button>
              <Button variant="primary" type="submit" loading={isSaving}>作成</Button>
            </Modal.Footer>
          </form>
        )}
      </Modal>
    </div>
  );
};

export default DiscussionPage;
