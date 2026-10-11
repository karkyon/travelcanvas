/**
 * DiscussionPage - 相談・投票(SC-19 合意形成 / SC-20 コメント)。
 *
 * [Gate P3] backend/app/api/v1/discussion.py の画面。2つのタブで構成する:
 *   - 投票(FR-022): 候補の比較。Love/OK/懸念/不可/棄権、合意状態、未回答者、懸念の解決、決定
 *   - コメント(FR-024): プラン全体へのコメント・返信・メンション(相手に通知)
 * 投票の作成・締切・決定は編集者以上。回答・コメントは閲覧者も行える(権限はbackendが判定する)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  createComment, createPoll, deleteComment, deletePoll, extractApiErrorDetailMessage, getComments, getPlanMembers,
  getPolls, putVotes, resolveVote, updateComment, updatePoll,
} from '@/services/api';
import type { CommentCreateData, PlanComment, PlanMember, Poll, VetoPolicy, VoteInput } from '@/services/api';
import PollCard from './discussion/PollCard';
import CommentsPanel from './discussion/CommentsPanel';
import { VETO_POLICY_OPTIONS } from './discussion/discussionModel';
import { localToIso } from './preparation/preparationModel';

type Tab = 'polls' | 'comments';

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? fallback;
}

const inputClass = 'w-full border rounded-lg px-3 py-2';

interface PollForm {
  title: string;
  description: string;
  deadline_local: string;
  veto_policy: VetoPolicy;
  is_anonymous: boolean;
  options: string[];
}

const emptyPollForm = (): PollForm => ({
  title: '', description: '', deadline_local: '', veto_policy: 'block', is_anonymous: false, options: ['', ''],
});

const DiscussionPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('polls');
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollForm, setPollForm] = useState<PollForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const me = useMemo(() => members.find((m) => m.is_me) ?? null, [members]);
  const canEdit = me?.role === 'owner' || me?.role === 'editor';

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [m, p, c] = await Promise.all([getPlanMembers(planId), getPolls(planId), getComments(planId, { type: 'plan' })]);
      setMembers(m);
      setPolls(p);
      setComments(c);
    } catch (e) {
      setError(errorMessage(e, '相談・投票の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

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
    if (options.length === 0) return setFormError('選択肢を1つ以上入力してください');
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
        title, options: options.map((label) => ({ label })), veto_policy: pollForm.veto_policy,
        is_anonymous: pollForm.is_anonymous,
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

  const createCommentFor = (data: CommentCreateData) =>
    planId ? run(() => createComment(planId, data), 'コメントの投稿に失敗しました') : Promise.resolve(false);

  if (!planId) {
    return (
      <div className="p-8 text-center text-gray-700">
        プランが選択されていません。
        <div className="mt-4"><Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
        <h1 className="text-2xl font-bold text-gray-900">相談・投票</h1>
        <p className="text-sm text-gray-700 mt-1">候補を投票で決め、気になることはコメントで相談します。</p>
      </div>

      <div role="tablist" aria-label="相談・投票の表示切替" className="flex gap-2 mb-4 border-b">
        {(['polls', 'comments'] as const).map((t) => (
          <button key={t} id={`disc-tab-${t}`} type="button" role="tab" aria-selected={tab === t}
            aria-controls={`disc-panel-${t}`} onClick={() => setTab(t)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${tab === t ? 'border-blue-600 text-blue-800' : 'border-transparent text-gray-700'}`}>
            {t === 'polls' ? `投票(${polls.length})` : `コメント(${comments.filter((c) => !c.is_deleted).length})`}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <div role="tabpanel" id={`disc-panel-${tab}`} aria-labelledby={`disc-tab-${tab}`}>
          {tab === 'polls' && (
            <div className="space-y-4">
              {canEdit && (
                <Button variant="primary" size="sm" icon={<Plus size={16} />}
                  onClick={() => { setFormError(null); setPollForm(emptyPollForm()); }}>
                  投票を作成
                </Button>
              )}
              {polls.length === 0 ? (
                <Card padding="lg" className="text-center text-gray-700">投票はまだありません。</Card>
              ) : polls.map((p) => (
                <PollCard key={p.id} poll={p} onSubmitVotes={submitVotes}
                  onResolve={(poll, voteId, resolved) => void run(() => resolveVote(planId, poll.id, voteId, resolved), '懸念の更新に失敗しました')}
                  onDecide={decide}
                  onToggleClosed={(poll) => void run(() => updatePoll(planId, poll.id, { status: poll.status === 'closed' ? 'open' : 'closed' }, poll.revision), '投票の更新に失敗しました')}
                  onDelete={(poll) => { if (window.confirm(`投票「${poll.title}」を削除しますか?`)) void run(() => deletePoll(planId, poll.id, poll.revision), '投票の削除に失敗しました'); }}
                />
              ))}
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

      <Modal isOpen={pollForm !== null} onClose={() => setPollForm(null)} title="投票の作成" size="md">
        {pollForm && (
          <form onSubmit={submitPoll} noValidate>
            <Modal.Body>
              <div className="space-y-4">
                {formError && <div className="p-2 rounded bg-red-50 text-red-800 text-sm" role="alert">{formError}</div>}
                <div>
                  <label htmlFor="poll-title" className="block text-sm font-medium text-gray-800 mb-1">題名</label>
                  <input id="poll-title" className={inputClass} maxLength={200} value={pollForm.title}
                    onChange={(e) => setPollForm({ ...pollForm, title: e.target.value })} placeholder="例: 2日目の夕食" />
                </div>
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-800 mb-1">選択肢</legend>
                  <div className="space-y-2">
                    {pollForm.options.map((o, i) => (
                      <input key={i} aria-label={`選択肢${i + 1}`} className={inputClass} maxLength={200} value={o}
                        onChange={(e) => setPollForm({ ...pollForm, options: pollForm.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                    ))}
                  </div>
                  {pollForm.options.length < 10 && (
                    <Button variant="ghost" size="sm" type="button" className="mt-1"
                      onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })}>選択肢を追加</Button>
                  )}
                </fieldset>
                <div>
                  <label htmlFor="poll-deadline" className="block text-sm font-medium text-gray-800 mb-1">締切(任意)</label>
                  <input id="poll-deadline" type="datetime-local" className={inputClass} value={pollForm.deadline_local}
                    onChange={(e) => setPollForm({ ...pollForm, deadline_local: e.target.value })} />
                </div>
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-800 mb-1">「不可」の扱い</legend>
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
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={pollForm.is_anonymous}
                    onChange={(e) => setPollForm({ ...pollForm, is_anonymous: e.target.checked })} />
                  匿名にする(誰がどう回答したかを本人以外に表示しない)
                </label>
                <div>
                  <label htmlFor="poll-description" className="block text-sm font-medium text-gray-800 mb-1">説明(任意)</label>
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
