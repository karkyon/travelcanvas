/**
 * [Gate P3] 投票カード(FR-022)。選択肢ごとの合意状態・件数・懸念と、自分の回答の入力。
 *
 * - 合意状態は色だけでなく文字(合意/懸念あり/不可あり/回答待ち)で示す。
 * - 懸念・不可は理由(と代替案)を表示し、本人か編集者が「解決済み」にできる(FC-066)。
 * - 匿名の投票は回答者が3人未満の間は件数を出さない(FC-067)。未回答者は表示する。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { Poll } from '@/services/api';
import { formatDue } from '../preparation/preparationModel';
import {
  OPTION_STATE_LABEL, POLL_STATE_LABEL, VETO_POLICY_LABEL, VOTE_LABEL, VOTE_OPTIONS, answersToPayload, describeCounts,
  draftsFromPoll, type AnswerDraft,
} from './discussionModel';
import type { VoteInput } from '@/services/api';

const STATE_CLASS: Record<string, string> = {
  agreed: 'bg-green-100 text-green-900',
  has_concerns: 'bg-amber-100 text-amber-900',
  blocked: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-800',
};

interface Props {
  poll: Poll;
  onSubmitVotes: (poll: Poll, votes: VoteInput[]) => Promise<void>;
  onResolve: (poll: Poll, voteId: string, resolved: boolean) => void;
  onDecide: (poll: Poll, optionId: string) => void;
  onToggleClosed: (poll: Poll) => void;
  onDelete: (poll: Poll) => void;
}

const PollCard: React.FC<Props> = ({ poll, onSubmitVotes, onResolve, onDecide, onToggleClosed, onDelete }) => {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>(() => draftsFromPoll(poll));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 再取得で投票の内容が変わったら下書きを作り直す(描画中に比較する。effectだと初回表示直後の入力を上書きしてしまう)
  const [source, setSource] = useState(poll);
  if (source !== poll) {
    setSource(poll);
    setDrafts(draftsFromPoll(poll));
  }

  const update = (optionId: string, patch: Partial<AnswerDraft>) =>
    setDrafts((prev) => ({ ...prev, [optionId]: { ...prev[optionId]!, ...patch } }));

  const submit = async () => {
    const result = answersToPayload(poll, drafts);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmitVotes(poll, result.data);
    } finally {
      setSaving(false);
    }
  };

  const headingId = `poll-${poll.id}-title`;
  return (
    <Card padding="md">
      <section aria-labelledby={headingId}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id={headingId} className="font-semibold text-gray-900">{poll.title}</h3>
            <p className="text-xs text-gray-700 mt-0.5">
              {POLL_STATE_LABEL[poll.state]}
              {poll.deadline_at && ` ・ 締切: ${formatDue(poll.deadline_at)}`}
              {poll.is_closed && ' ・ 締め切りました'}
              {` ・ ${VETO_POLICY_LABEL[poll.veto_policy]}`}
              {poll.is_anonymous && ' ・ 匿名'}
            </p>
            {poll.description && <p className="text-sm text-gray-800 mt-1">{poll.description}</p>}
            {poll.unanswered.length > 0 && (
              <p className="text-xs text-gray-700 mt-1" data-testid={`poll-unanswered-${poll.id}`}>
                未回答: {poll.unanswered.map((u) => u.name).join('、')}
              </p>
            )}
          </div>
          {poll.can_manage && (
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => onToggleClosed(poll)}>
                {poll.status === 'closed' ? '再開する' : '締め切る'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(poll)}>削除</Button>
            </div>
          )}
        </div>

        {error && <div className="mt-2 p-2 rounded bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

        <ul className="mt-3 space-y-3" aria-label={`${poll.title}の選択肢`}>
          {poll.options.map((o) => {
            const d = drafts[o.id] ?? { value: '', reason: '', alternative: '' };
            const needsReason = d.value === 'concern' || d.value === 'veto';
            return (
              <li key={o.id} className="border rounded p-3" data-testid={`poll-option-${o.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{o.label}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATE_CLASS[o.state]}`}>{OPTION_STATE_LABEL[o.state]}</span>
                  {o.is_leading && !o.is_decided && <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-900">最有力</span>}
                  {o.is_decided && <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white">決定</span>}
                  {o.event_missing && <span className="text-xs text-gray-700">(元の予定は削除されています)</span>}
                </div>
                <p className="text-xs text-gray-700 mt-1">{describeCounts(o)}</p>
                {o.votes.filter((v) => v.value === 'concern' || v.value === 'veto').map((v) => (
                  <div key={v.id} className="mt-2 text-sm bg-amber-50 border border-amber-200 rounded p-2">
                    <p>
                      <span className="font-medium">{VOTE_LABEL[v.value]}</span>
                      {v.name ? `(${v.name}${v.is_mine ? '・自分' : ''})` : v.is_mine ? '(自分)' : '(匿名)'}: {v.reason}
                      {v.alternative && ` ／ 代替案: ${v.alternative}`}
                    </p>
                    {v.is_resolved && (
                      <p className="text-xs text-green-900">解決済み{v.resolution_note ? `: ${v.resolution_note}` : ''}</p>
                    )}
                    {v.can_resolve && (
                      <Button variant="ghost" size="sm" onClick={() => onResolve(poll, v.id, !v.is_resolved)}>
                        {v.is_resolved ? '未解決に戻す' : '解決済みにする'}
                      </Button>
                    )}
                  </div>
                ))}
                {!poll.is_closed && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`vote-${o.id}`} className="block text-xs font-medium text-gray-800">{`${o.label}へのあなたの回答`}</label>
                      <select id={`vote-${o.id}`} className="w-full border rounded px-2 py-1 text-sm" value={d.value}
                        onChange={(e) => update(o.id, { value: e.target.value as AnswerDraft['value'] })}>
                        <option value="">未回答</option>
                        {VOTE_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                      </select>
                    </div>
                    {needsReason && (
                      <div>
                        <label htmlFor={`reason-${o.id}`} className="block text-xs font-medium text-gray-800">{`${o.label}の理由`}</label>
                        <input id={`reason-${o.id}`} className="w-full border rounded px-2 py-1 text-sm" maxLength={500}
                          value={d.reason} onChange={(e) => update(o.id, { reason: e.target.value })} />
                      </div>
                    )}
                    {d.value === 'veto' && (
                      <div>
                        <label htmlFor={`alt-${o.id}`} className="block text-xs font-medium text-gray-800">{`${o.label}の代替案`}</label>
                        <input id={`alt-${o.id}`} className="w-full border rounded px-2 py-1 text-sm" maxLength={200}
                          value={d.alternative} onChange={(e) => update(o.id, { alternative: e.target.value })} />
                      </div>
                    )}
                  </div>
                )}
                {poll.can_manage && !o.is_decided && o.state !== 'blocked' && o.responders > 0 && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => onDecide(poll, o.id)}>
                    これに決定
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {!poll.is_closed && (
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={submit} loading={saving}>回答を送信</Button>
          </div>
        )}
      </section>
    </Card>
  );
};

export default PollCard;
