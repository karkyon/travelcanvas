/**
 * [Gate ChatConsensus] かんたん投票のカード(mode=simple。FR-022)。1人1つ選ぶ。選び直すと前の選択は外れる。
 *
 * - 選んだ人の名前と票の数を出す(匿名の投票は回答者が3人未満の間は数を出さない。FC-067)
 * - 編集者は「これに決定」(確認のうえ)・締め切る・再開・削除・旅程に反映・反映を元に戻すができる
 * - 4段階の回答・定足数・「不可」の扱いは「詳しい設定」で作る詳しい投票(PollCard)だけ
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { Poll, PollG4 } from '@/services/api';
import { formatDue } from '../preparation/preparationModel';

interface Props {
  poll: Poll;
  sourceQuote?: string | null;
  onChoose: (poll: Poll, optionId: string, chosen: boolean) => Promise<void>;
  onDecide: (poll: Poll, optionId: string) => void;
  onToggleClosed: (poll: Poll) => void;
  onDelete: (poll: Poll) => void;
  onAdopt?: (poll: Poll) => void;
  onUndoAdopt?: (poll: Poll) => void;
}

const SimplePollCard: React.FC<Props> = ({ poll: p0, sourceQuote, onChoose, onDecide, onToggleClosed, onDelete, onAdopt, onUndoAdopt }) => {
  const poll = p0 as Poll & PollG4;
  const [busy, setBusy] = useState<string | null>(null);
  const headingId = `poll-${poll.id}-title`;
  const adopted = poll.phase === 'adopted';
  const choose = async (optionId: string, chosen: boolean) => {
    setBusy(optionId);
    try {
      await onChoose(poll, optionId, chosen);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card padding="md">
      <section aria-labelledby={headingId}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id={headingId} className="font-semibold text-ink-900">{poll.title}</h3>
            <p className="text-xs text-ink-700 mt-0.5">
              かんたん投票(1人1つ)
              {poll.deadline_at && ` ・ 締切: ${formatDue(poll.deadline_at)}`}
              {poll.is_closed && !poll.decided_option_id && ' ・ 締め切りました'}
              {poll.decided_option_id && (adopted ? ' ・ 旅程に反映済み' : ' ・ 決定')}
              {poll.is_anonymous && ' ・ 匿名'}
            </p>
            {sourceQuote && <p className="text-xs text-ink-700 mt-1">元の発言: 「{sourceQuote}」</p>}
            {poll.description && <p className="text-sm text-ink-900 mt-1">{poll.description}</p>}
            {poll.unanswered.length > 0 && !poll.is_closed && (
              <p className="text-xs text-ink-700 mt-1" data-testid={`poll-unanswered-${poll.id}`}>
                まだ選んでいない人: {poll.unanswered.map((u) => u.name).join('、')}
              </p>
            )}
          </div>
          {poll.can_manage && (
            <div className="flex flex-wrap gap-1 shrink-0">
              {poll.can_adopt && onAdopt && <Button variant="primary" size="sm" onClick={() => onAdopt(poll)}>旅程に反映</Button>}
              {adopted && onUndoAdopt && <Button variant="outline" size="sm" onClick={() => onUndoAdopt(poll)}>反映を元に戻す</Button>}
              {!adopted && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => onToggleClosed(poll)}>
                    {poll.status === 'closed' ? '再開する' : '締め切る'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(poll)}>削除</Button>
                </>
              )}
            </div>
          )}
        </div>
        <ul className="mt-3 space-y-2" aria-label={`${poll.title}の選択肢`}>
          {poll.options.map((o) => {
            const mine = o.my_vote === 'ok';
            const names = o.votes.filter((v) => v.name).map((v) => (v.is_mine ? `${v.name}(自分)` : v.name));
            return (
              <li key={o.id} className="border rounded-sm p-3 flex flex-wrap items-center gap-2" data-testid={`poll-option-${o.id}`}>
                <span className="font-medium text-ink-900">{o.label}</span>
                <span className="text-xs text-ink-700">
                  {o.counts ? `${o.counts.ok}票` : '3人以上が選ぶと数を表示します(匿名)'}
                  {names.length > 0 && !poll.is_anonymous && `(${names.join('、')})`}
                </span>
                {o.is_leading && !o.is_decided && <span className="text-xs px-2 py-0.5 rounded-sm bg-blue-100 text-blue-900">最多</span>}
                {o.is_decided && <span className="text-xs px-2 py-0.5 rounded-sm bg-blue-600 text-white">決定</span>}
                <span className="flex-1" />
                {!poll.is_closed && (
                  <Button variant={mine ? 'primary' : 'outline'} size="sm" aria-pressed={mine} loading={busy === o.id}
                    aria-label={mine ? `${o.label}の選択を取り消す` : `${o.label}を選ぶ`} onClick={() => void choose(o.id, !mine)}>
                    {mine ? '選択中' : 'これにする'}
                  </Button>
                )}
                {poll.can_manage && !poll.decided_option_id && !adopted && (
                  <Button variant="ghost" size="sm" onClick={() => onDecide(poll, o.id)}>これに決定</Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
};

export default SimplePollCard;
