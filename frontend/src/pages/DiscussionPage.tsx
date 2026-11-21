/**
 * DiscussionPage - 相談(SC-19 合意形成 / SC-20 コメント)。
 *
 * [Gate ChatConsensus] 相談は話し合い(チャット)が中心。投票は必要な時だけ(利用者の決定 2026-11-17。DOC-02 v6.0 FR-022 /
 * DOC-04 v6.0 SC-19)。画面は上から:
 *   1. 決まったこと: 話し合いで決めた記録(これで決まり)と、決定した投票。旅程に反映・反映を元に戻す
 *   2. 投票: 回答中・締め切った投票。かんたん投票(1つ選ぶ。既定)と、詳しい投票(4段階・定足数・不可。「詳しい設定」で作る)
 *   3. 話し合い: 旅行全体への発言・返信・メンション。発言ごとに「これで決まり」「投票にする」(編集者以上)
 * 投票を作るときに「話し合いから選択肢の案を出す(AI)」を使える(任意・同意と枠を確認・何も保存しない)。
 * 投票の作成・決定は編集者以上。回答・発言は閲覧者も行える(権限はbackendが判定する)。
 * [Gate G4] COL-02 定足数・候補箱の候補を選択肢にする・決定を旅程に反映(確認の後)・反映を元に戻す。
 * [Gate G4] COL-03 ?target=event|reservation|expense&id= で、その予定・予約・費用へのコメントだけを開く(通知・各画面から)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  api, createComment, createPoll, deleteComment, deletePoll, extractApiErrorDetailMessage, getCandidates, getComments,
  getPlanMembers, getPolls, putVotes, resolveVote, updateComment, updatePoll,
} from '@/services/api';
import type {
  CommentCreateData, CommentTargetType, DecisionCreateData, NormalizedDay, PlanCandidateItem, PlanComment, PlanMember, Poll,
  PollG4, VetoPolicy, VoteInput,
} from '@/services/api';
import { adoptionPreview, adoptPoll, undoAdoptPoll } from '@/services/api/g4';
import { createDecision, suggestPollOptions } from '@/services/api/chatConsensus';
import AdoptDialog from './discussion/AdoptDialog';
import PlanNotificationLevel from '@/components/notifications/PlanNotificationLevel';
import PollCard from './discussion/PollCard';
import SimplePollCard from './discussion/SimplePollCard';
import DecisionDialog from './discussion/DecisionDialog';
import CommentsPanel from './discussion/CommentsPanel';
import { VETO_POLICY_OPTIONS, draftFromMessage, quoteOf } from './discussion/discussionModel';
import { localToIso } from './preparation/preparationModel';
import ImportantNotices from './discussion/ImportantNotices';

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
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

interface PollForm {
  title: string;
  description: string;
  deadline_local: string;
  /** [Gate ChatConsensus] false=かんたん投票(既定)/ true=詳しい投票(4段階・定足数・不可の扱い) */
  detailed: boolean;
  veto_policy: VetoPolicy;
  is_anonymous: boolean;
  options: string[];
  /** [Gate G4] COL-02 候補箱から選んだ選択肢 */
  candidate_ids: string[];
  quorum: string;
  /** [Gate ChatConsensus] 元の発言 */
  source_comment_id: string | null;
}

const emptyPollForm = (init?: Partial<PollForm>): PollForm => ({
  title: '', description: '', deadline_local: '', detailed: false, veto_policy: 'block', is_anonymous: false,
  options: ['', ''], candidate_ids: [], quorum: '', source_comment_id: null, ...init,
});

const modeOf = (p: Poll): 'simple' | 'detailed' | 'decision' => p.mode ?? 'detailed';
const decidedLabel = (p: Poll) => p.options.find((o) => o.id === p.decided_option_id)?.label ?? '';

const DiscussionPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // [Gate G4] COL-03 対象ごとのコメント(予定・予約・費用)。不明な値は旅行全体の話し合いとして扱う
  const rawTarget = params.get('target');
  const targetId = params.get('id');
  const target: { type: CommentTargetType; id?: string } =
    (rawTarget === 'event' || rawTarget === 'reservation' || rawTarget === 'expense') && targetId
      ? { type: rawTarget, id: targetId } : { type: 'plan' };
  const isPlanChat = target.type === 'plan';
  const targetLabel = TARGET_LABEL[target.type];
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollForm, setPollForm] = useState<PollForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [candidates, setCandidates] = useState<PlanCandidateItem[]>([]);
  const [adopting, setAdopting] = useState<Poll | null>(null);
  const [deciding, setDeciding] = useState<{ title: string; label: string; comment: PlanComment | null } | null>(null);
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
      setError(errorMessage(e, '相談の取得に失敗しました'));
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

  const loadCandidates = () => {
    if (!planId) return;
    // 候補箱の候補(見送り・まとめた物を除く)を選択肢・決定にできる
    getCandidates(planId).then((l) => setCandidates(l.items.filter((c) => c.status !== 'dismissed' && !c.merged_into_id)))
      .catch(() => setCandidates([]));
  };

  const commentById = useMemo(() => new Map(comments.map((c) => [c.id, c])), [comments]);
  const sourceQuote = (p: Poll) => {
    const c = p.source_comment_id ? commentById.get(p.source_comment_id) : undefined;
    return c && !c.is_deleted ? quoteOf(c.body) : null;
  };

  const submitPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !pollForm) return;
    const title = pollForm.title.trim();
    const options = pollForm.options.map((o) => o.trim()).filter(Boolean);
    if (!title) return setFormError('題名を入力してください');
    if (options.length + pollForm.candidate_ids.length === 0) return setFormError('選択肢を1つ以上入力してください');
    let quorum: number | undefined;
    if (pollForm.detailed && pollForm.quorum.trim()) {
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
        mode: pollForm.detailed ? 'detailed' : 'simple',
        ...(pollForm.detailed ? { veto_policy: pollForm.veto_policy } : {}),
        is_anonymous: pollForm.is_anonymous,
        ...(quorum ? { quorum } : {}),
        ...(pollForm.description.trim() ? { description: pollForm.description.trim() } : {}),
        ...(deadline ? { deadline_at: deadline } : {}),
        ...(pollForm.source_comment_id ? { source_comment_id: pollForm.source_comment_id } : {}),
      });
      setPollForm(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err, '投票の作成に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  /** [Gate ChatConsensus] 話し合いから選択肢の案(AI)。空の欄を案で埋めるだけ。作成するまで何も変わらない */
  const suggest = async () => {
    if (!planId || !pollForm) return;
    setIsSuggesting(true);
    setFormError(null);
    setFormNote(null);
    try {
      const r = await suggestPollOptions(planId, pollForm.title.trim() ? { topic: pollForm.title.trim() } : {}, newKey());
      const labels = r.suggestion.options.map((o) => o.label);
      if (labels.length === 0) {
        setFormNote('話し合いから選択肢の案を見つけられませんでした。手で入力してください。');
        return;
      }
      setPollForm((f) => f && ({
        ...f, title: f.title.trim() ? f.title : (r.suggestion.title ?? ''),
        options: labels.length >= 2 ? labels.slice(0, 10) : [...labels, ''],
      }));
      setFormNote(`${r.notice}。直してから作成してください。`);
    } catch (err) {
      setFormError(errorMessage(err, 'AI の案を出せませんでした。手で入力してください'));
    } finally {
      setIsSuggesting(false);
    }
  };

  const submitVotes = async (p: Poll, votes: VoteInput[]) => {
    if (!planId) return;
    await run(() => putVotes(planId, p.id, votes), '回答の送信に失敗しました');
  };

  const choose = (p: Poll, optionId: string, chosen: boolean) =>
    submitVotes(p, [{ option_id: optionId, value: chosen ? 'ok' : null }]);

  const decide = (p: Poll, optionId: string) => {
    if (!planId) return;
    const label = p.options.find((o) => o.id === optionId)?.label ?? '';
    if (!window.confirm(`「${label}」に決定して投票を締め切りますか?`)) return;
    void run(() => updatePoll(planId, p.id, { decided_option_id: optionId }, p.revision), '決定に失敗しました');
  };

  const openPollForm = (init?: Partial<PollForm>) => {
    setFormError(null);
    setFormNote(null);
    setPollForm(emptyPollForm(init));
    loadCandidates();
  };

  /** [Gate ChatConsensus] 発言から「投票にする」(題名と選択肢の下書き) */
  const pollFromComment = (c: PlanComment) => {
    const d = draftFromMessage(c.body ?? '');
    const options = d.options.length >= 2 ? d.options : [...d.options, '', ''].slice(0, Math.max(2, d.options.length + 1));
    openPollForm({ title: d.title, options, source_comment_id: c.id });
  };

  /** [Gate ChatConsensus] 発言から「これで決まり」 */
  const decisionFromComment = (c: PlanComment | null) => {
    const d = draftFromMessage(c?.body ?? '');
    setDeciding({ title: d.title, label: d.options.length === 1 ? d.options[0]! : '', comment: c });
    loadCandidates();
  };

  const submitDecision = async (data: Omit<DecisionCreateData, 'source_comment_id'>, reflect: boolean): Promise<string | null> => {
    if (!planId || !deciding) return null;
    try {
      const created = await createDecision(planId, {
        ...data, ...(deciding.comment ? { source_comment_id: deciding.comment.id } : {}),
      });
      setDeciding(null);
      setNotice(`「${created.title}」を決まったことに記録しました`);
      await load();
      if (reflect) await openAdopt(created);
      return null;
    } catch (e) {
      return errorMessage(e, '記録できませんでした');
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

  const removePoll = (p: Poll) => {
    if (!planId) return;
    const what = modeOf(p) === 'decision' ? '決まったこと' : '投票';
    if (window.confirm(`${what}「${p.title}」を削除しますか?`)) void run(() => deletePoll(planId, p.id, p.revision), `${what}の削除に失敗しました`);
  };

  const createCommentFor = (data: CommentCreateData) =>
    planId ? run(() => createComment(planId, isPlanChat ? data
      : { ...data, target_type: target.type, target_id: target.id }), 'コメントの投稿に失敗しました') : Promise.resolve(false);

  if (!planId) {
    return (
      <div className="p-8 text-center text-ink-700">
        プランが選択されていません。
        <div className="mt-4"><Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button></div>
      </div>
    );
  }

  const decisions = polls.filter((p) => modeOf(p) === 'decision');
  const votePolls = polls.filter((p) => modeOf(p) !== 'decision');
  const decidedVotes = votePolls.filter((p) => p.decided_option_id);
  const pollsByComment = new Map<string, Poll[]>();
  for (const p of polls) if (p.source_comment_id) pollsByComment.set(p.source_comment_id, [...(pollsByComment.get(p.source_comment_id) ?? []), p]);

  const pollCardProps = {
    onDecide: decide,
    onToggleClosed: (poll: Poll) => void run(() => updatePoll(planId, poll.id, { status: poll.status === 'closed' ? 'open' : 'closed' }, poll.revision), '投票の更新に失敗しました'),
    onDelete: removePoll,
    onAdopt: (poll: Poll) => void openAdopt(poll),
    onUndoAdopt: (poll: Poll) => void undoAdopt(poll),
  };

  const commentsPanel = (
    <CommentsPanel comments={comments} members={members} onCreate={createCommentFor}
      composerLabel={isPlanChat ? '発言する' : 'コメントする'}
      emptyText={isPlanChat ? 'まだ発言はありません。気になることを書いてみましょう。決まったら発言の「これで決まり」で記録できます。' : 'まだコメントはありません。'}
      onToggleResolved={(c) => void run(() => updateComment(planId, c.id, { status: c.status === 'resolved' ? 'open' : 'resolved' }, c.revision), 'コメントの更新に失敗しました')}
      onEdit={(c, body) => run(() => updateComment(planId, c.id, { body }, c.revision), 'コメントの更新に失敗しました')}
      onDelete={(c) => { if (window.confirm('このコメントを削除しますか?')) void run(() => deleteComment(planId, c.id, c.revision), 'コメントの削除に失敗しました'); }}
      renderActions={isPlanChat && canEdit ? (c) => (
        <>
          <Button variant="outline" size="sm" onClick={() => decisionFromComment(c)} aria-label={`これで決まり(この発言): ${quoteOf(c.body, 20)}`}>これで決まり</Button>
          <Button variant="ghost" size="sm" onClick={() => pollFromComment(c)} aria-label={`投票にする(この発言): ${quoteOf(c.body, 20)}`}>投票にする</Button>
        </>
      ) : undefined}
      renderLinks={isPlanChat ? (c) => {
        const linked = pollsByComment.get(c.id);
        if (!linked?.length) return null;
        return (
          <p className="text-xs text-indigo-900 mt-1" data-testid={`comment-links-${c.id}`}>
            {linked.map((p) => (modeOf(p) === 'decision' ? `→ 決まったこと「${p.title}: ${decidedLabel(p)}」` : `→ 投票「${p.title}」`)).join(' ')}
          </p>
        );
      } : undefined}
    />
  );

  return (
    <div className="tc-page tc-page--lg">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
        <h1 className="tc-page-title" data-eyebrow="TOGETHER · 相談">相談</h1>
        <p className="text-sm text-ink-700 mt-1">
          話し合って決めます。決まったら発言の「これで決まり」で記録し、迷ったら「投票にする」で選んでもらえます。
        </p>
        <div className="mt-2"><PlanNotificationLevel planId={planId} /></div>
      </div>

      {/* [Gate② FC-064] 重大な変更・集合の変更のお知らせと確認 */}
      {planId && <ImportantNotices planId={planId} />}

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {notice && <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{notice}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : !isPlanChat ? (
        <>
          <div className="mb-3 p-3 rounded-lg bg-indigo-50 text-indigo-900 text-sm flex flex-wrap items-center gap-2" role="note">
            <span>{targetLabel}へのコメントを表示しています。</span>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/discussion`)}>旅行全体の話し合いへ</Button>
          </div>
          {commentsPanel}
        </>
      ) : (
        <div className="space-y-6">
          {(decisions.length > 0 || decidedVotes.length > 0) && (
            <section aria-labelledby="disc-decided" className="space-y-2">
              <h2 id="disc-decided" className="text-lg font-semibold text-ink-900">決まったこと</h2>
              {decidedVotes.length > 0 && (
                <ul className="text-sm text-ink-900 space-y-1" aria-label="投票で決まったこと">
                  {decidedVotes.map((p) => (
                    <li key={p.id}>{p.title}: <span className="font-medium">{decidedLabel(p)}</span>(投票で決定{(p as Poll & PollG4).phase === 'adopted' ? '・旅程に反映済み' : ''})</li>
                  ))}
                </ul>
              )}
              {decisions.map((p) => {
                const g4 = p as Poll & PollG4;
                const quote = sourceQuote(p);
                return (
                  <Card key={p.id} padding="md">
                    <section aria-labelledby={`decision-${p.id}`} data-testid={`decision-${p.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 id={`decision-${p.id}`} className="font-semibold text-ink-900">{p.title}</h3>
                          <p className="text-sm text-ink-900 mt-0.5"><span className="font-medium">{decidedLabel(p)}</span></p>
                          <p className="text-xs text-ink-700 mt-0.5">
                            話し合いで決定{p.created_by_name ? `(${p.created_by_name}さんが記録)` : ''}
                            {g4.phase === 'adopted' && ' ・ 旅程に反映済み'}
                          </p>
                          {quote && <p className="text-xs text-ink-700 mt-1">元の発言: 「{quote}」</p>}
                        </div>
                        {p.can_manage && (
                          <div className="flex flex-wrap gap-1 shrink-0">
                            {g4.can_adopt && <Button variant="primary" size="sm" onClick={() => void openAdopt(p)}>旅程に反映</Button>}
                            {g4.phase === 'adopted' && <Button variant="outline" size="sm" onClick={() => void undoAdopt(p)}>反映を元に戻す</Button>}
                            {g4.phase !== 'adopted' && <Button variant="ghost" size="sm" onClick={() => removePoll(p)}>削除</Button>}
                          </div>
                        )}
                      </div>
                    </section>
                  </Card>
                );
              })}
            </section>
          )}

          {votePolls.length > 0 && (
            <section aria-labelledby="disc-polls" className="space-y-4">
              <h2 id="disc-polls" className="text-lg font-semibold text-ink-900">投票</h2>
              {votePolls.map((p) => (modeOf(p) === 'simple' ? (
                <SimplePollCard key={p.id} {...pollCardProps} poll={p} sourceQuote={sourceQuote(p)} onChoose={choose} />
              ) : (
                <PollCard key={p.id} {...pollCardProps} poll={p} onSubmitVotes={submitVotes}
                  onResolve={(poll, voteId, resolved) => void run(() => resolveVote(planId, poll.id, voteId, resolved), '懸念の更新に失敗しました')} />
              )))}
            </section>
          )}

          <section aria-labelledby="disc-chat" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="disc-chat" className="text-lg font-semibold text-ink-900">話し合い</h2>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => decisionFromComment(null)}>決まったことを記録</Button>
                  <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => openPollForm()}>投票を作成</Button>
                </div>
              )}
            </div>
            {commentsPanel}
          </section>
        </div>
      )}

      {adopting && (
        <AdoptDialog poll={adopting} days={days} onClose={() => setAdopting(null)}
          onPreview={(input) => previewAdopt(adopting, input)}
          onAdopt={(input, revision) => doAdopt(adopting, input, revision)} />
      )}

      {deciding && (
        <DecisionDialog initialTitle={deciding.title} initialLabel={deciding.label}
          sourceQuote={deciding.comment ? quoteOf(deciding.comment.body) : null} candidates={candidates}
          onClose={() => setDeciding(null)} onSubmit={submitDecision} />
      )}

      <Modal isOpen={pollForm !== null} onClose={() => setPollForm(null)} title="投票の作成" size="md">
        {pollForm && (
          <form onSubmit={submitPoll} noValidate>
            <Modal.Body>
              <div className="space-y-4">
                {formError && <div className="p-2 rounded-sm bg-red-50 text-red-800 text-sm" role="alert">{formError}</div>}
                {formNote && <div className="p-2 rounded-sm bg-indigo-50 text-indigo-900 text-sm" role="status">{formNote}</div>}
                {pollForm.source_comment_id && commentById.get(pollForm.source_comment_id) && (
                  <p className="text-xs text-ink-700">元の発言: 「{quoteOf(commentById.get(pollForm.source_comment_id)!.body)}」(選択肢は下書きです。直してください)</p>
                )}
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
                  <div className="mt-1 flex flex-wrap gap-2">
                    {pollForm.options.length < 10 && (
                      <Button variant="ghost" size="sm" type="button"
                        onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })}>選択肢を追加</Button>
                    )}
                    {comments.some((c) => !c.is_deleted) && (
                      <Button variant="outline" size="sm" type="button" icon={<Sparkles size={14} />} loading={isSuggesting}
                        onClick={() => void suggest()}>話し合いから選択肢の案を出す(AI・任意)</Button>
                    )}
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
                </fieldset>
                <p className="text-xs text-ink-700">みんなは選択肢から1つ選びます(かんたん投票)。</p>
                <details className="border rounded-lg p-3">
                  <summary className="text-sm font-medium text-ink-900 cursor-pointer">詳しい設定(締切・匿名・4段階で答える など)</summary>
                  <div className="mt-3 space-y-4">
                    <div>
                      <label htmlFor="poll-deadline" className="block text-sm font-medium text-ink-900 mb-1">締切(任意)</label>
                      <input id="poll-deadline" type="datetime-local" className={inputClass} value={pollForm.deadline_local}
                        onChange={(e) => setPollForm({ ...pollForm, deadline_local: e.target.value })} />
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
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={pollForm.detailed}
                        onChange={(e) => setPollForm({ ...pollForm, detailed: e.target.checked })} />
                      4段階で答える(ぜひ・OK・懸念あり・不可。懸念には理由。定足数と「不可」の扱いを使う)
                    </label>
                    {pollForm.detailed && (
                      <>
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
                      </>
                    )}
                  </div>
                </details>
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
