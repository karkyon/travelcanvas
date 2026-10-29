/**
 * [Gate G11 段階8] 候補箱で家族・グループが候補に投票する(FR-007 の gaps「候補への投票」)。
 *
 * 新しい表は作らず、合意形成(FR-022)の投票を使う: 選択肢を候補箱の候補(candidate_id)にした投票を「候補箱の投票」とし、
 * 候補の画面で 行きたい・行ってもいい・気になる・行きたくない を付け、件数を見る。締切・定足数・決定・旅程への反映は
 * 話し合いの画面(既存)で行う。
 *
 * - 投票を始められるのは編集できる人(投票の作成は editor 以上)。回答はメンバー全員(閲覧の人も。ゲスト・共有の閲覧は不可)
 * - 匿名の投票は、回答が3人に届くまで件数を出さない(誰が付けたか推測できるため。サーバーが null を返す)
 * - 投票の後に足した候補はこの投票に入らない(そう示す。新しい投票で入る)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/common/Button';
import { createPoll, getPolls, putVotes } from '@/services/api';
import type { Poll, PollOption, VoteValue } from '@/services/api/types/discussion';
import { CHOICES, MAX_OPTIONS, candidatePoll, countsText } from './candidateVotingModel';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

export interface VotingCandidate {
  id: string;
  title: string;
}

interface Props {
  planId: string;
  candidates: VotingCandidate[];
  canEdit: boolean;
}

const CandidateVoting: React.FC<Props> = ({ planId, candidates, canEdit }) => {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ optionId: string; value: VoteValue; reason: string; alternative: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setPolls(await getPolls(planId));
    } catch (e) {
      setError(errorDetailMessage(e, '投票を読めませんでした'));
      setPolls([]);
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load]);

  const poll = useMemo(() => (polls ? candidatePoll(polls) : null), [polls]);
  const inPoll = useMemo(() => new Set((poll?.options ?? []).map((o) => o.candidate_id).filter(Boolean)), [poll]);
  const missing = candidates.filter((c) => !inPoll.has(c.id));

  const start = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createPoll(planId, {
        title: '候補箱の投票',
        options: candidates.slice(0, MAX_OPTIONS).map((c) => ({ candidate_id: c.id })),
      });
      await load();
      setNotice('候補で投票を始めました。メンバーが候補ごとに付けられます');
    } catch (e) {
      setError(errorDetailMessage(e, '投票を始められませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const vote = async (option: PollOption, value: VoteValue | null, reason?: string, alternative?: string) => {
    if (!poll) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await putVotes(planId, poll.id, [{ option_id: option.id, value,
        ...(reason ? { reason } : {}), ...(alternative ? { alternative } : {}) }]);
      setAsking(null);
      await load();
      setNotice(value ? `「${option.label}」に「${CHOICES.find((c) => c.value === value)!.label}」を付けました`
        : `「${option.label}」の回答を取り消しました`);
    } catch (e) {
      setError(errorDetailMessage(e, '回答を保存できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  if (polls === null) return null;
  return (
    <section aria-labelledby="candidate-voting-title" data-testid="candidate-voting"
      className="mt-4 rounded-xl border border-cloud-200 bg-surface p-4 text-sm text-ink-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="candidate-voting-title" className="text-lg font-semibold">家族・グループで投票</h2>
        <Link to={`/planner/${planId}/discussion`} className="tc-focus-ring inline-flex min-h-11 items-center text-accent underline">
          締切・決定・旅程への反映は話し合いの画面へ
        </Link>
      </div>
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft p-2 text-danger">{error}</p>}
      {notice && <p role="status" className="mt-2 rounded-lg bg-success-soft p-2 text-success">{notice}</p>}
      {!poll && (
        <div className="mt-2">
          <p className="text-ink-700">候補への投票はまだありません。</p>
          {canEdit && candidates.length >= 2 && (
            <Button className="mt-2 min-h-11" onClick={() => void start()} disabled={busy} data-testid="candidate-voting-start">
              {`候補 ${Math.min(candidates.length, MAX_OPTIONS)}件で投票を始める`}
            </Button>
          )}
          {canEdit && candidates.length < 2 && <p className="mt-1 text-ink-700">候補が2件以上になると投票を始められます。</p>}
        </div>
      )}
      {poll && (
        <>
          <p className="mt-1 text-ink-700" data-testid="candidate-voting-summary">
            {`「${poll.title}」· ${poll.is_anonymous ? '匿名' : '名前つき'}の投票 · 未回答 ${poll.unanswered.length}人`}
          </p>
          <ul className="mt-3 space-y-3">
            {poll.options.filter((o) => o.candidate_id).map((o) => (
              <li key={o.id} className="rounded-lg border border-cloud-200 p-3" data-testid={`candidate-vote-${o.candidate_id}`}>
                <p className="font-semibold">{o.label}{o.is_decided ? '(決定)' : ''}</p>
                <p className="text-xs text-ink-700" data-testid="candidate-vote-counts">{countsText(o)}</p>
                <div role="radiogroup" aria-label={`「${o.label}」への回答`} className="mt-2 flex flex-wrap gap-2">
                  {CHOICES.map((c) => (
                    <button key={c.value} type="button" role="radio" aria-checked={o.my_vote === c.value} disabled={busy}
                      onClick={() => {
                        if (o.my_vote === c.value) { void vote(o, null); return; }
                        if (c.value === 'concern' || c.value === 'veto') {
                          setAsking({ optionId: o.id, value: c.value, reason: '', alternative: '' });
                          return;
                        }
                        void vote(o, c.value);
                      }}
                      className={`tc-focus-ring min-h-11 rounded-lg border px-3 text-sm ${o.my_vote === c.value
                        ? 'border-accent bg-accent-soft text-ink-900 font-semibold' : 'border-cloud-200 text-ink-900'}`}>
                      <span aria-hidden="true">{c.symbol} </span>{c.label}
                    </button>
                  ))}
                </div>
                {asking && asking.optionId === o.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]" data-testid="candidate-vote-reason">
                    <label className="text-xs text-ink-900">
                      {`「${CHOICES.find((c) => c.value === asking.value)!.label}」の理由(必須・メンバーに見えます)`}
                      <input className="mt-1 w-full rounded-lg border border-cloud-200 bg-surface px-2 py-2 text-sm text-ink-900"
                        maxLength={500} value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} />
                    </label>
                    {asking.value === 'veto' && poll.veto_policy === 'block_with_alternative' && (
                      <label className="text-xs text-ink-900">代わりの案(必須)
                        <input className="mt-1 w-full rounded-lg border border-cloud-200 bg-surface px-2 py-2 text-sm text-ink-900"
                          maxLength={200} value={asking.alternative}
                          onChange={(e) => setAsking({ ...asking, alternative: e.target.value })} />
                      </label>
                    )}
                    <div className="flex items-end gap-2">
                      <Button className="min-h-11" disabled={busy || !asking.reason.trim()
                        || (asking.value === 'veto' && poll.veto_policy === 'block_with_alternative' && !asking.alternative.trim())}
                        onClick={() => void vote(o, asking.value, asking.reason.trim(), asking.alternative.trim() || undefined)}>
                        付ける
                      </Button>
                      <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setAsking(null)}>やめる</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="mt-2 text-xs text-ink-700" data-testid="candidate-voting-missing">
              {`投票の後に足した候補 ${missing.length}件(${missing.map((c) => `「${c.title}」`).join('')})は、この投票に入っていません。`
                + '話し合いの画面で投票を締め切り、新しく始めると入ります'}
            </p>
          )}
        </>
      )}
    </section>
  );
};

export default CandidateVoting;
