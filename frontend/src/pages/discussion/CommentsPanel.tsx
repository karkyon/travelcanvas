/**
 * [Gate P3] コメントのスレッド(FR-024)。返信・メンション・解決済み・編集・削除。
 *
 * - 予約番号・PINなどらしき文字列は送信前に注意を出し(EX-011)、保存後もコメントに注意を表示する。
 * - メンションした相手には通知が届く(通知にはコメント本文を含めない)。
 * - 削除されたコメントは、返信があればスレッドの形を保つため「削除されました」と表示する。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { CommentCreateData, PlanComment, PlanMember } from '@/services/api';
import { buildThreads, looksSensitive } from './discussionModel';

interface Props {
  comments: PlanComment[];
  members: PlanMember[];
  onCreate: (data: CommentCreateData) => Promise<boolean>;
  onToggleResolved: (c: PlanComment) => void;
  onEdit: (c: PlanComment, body: string) => Promise<boolean>;
  onDelete: (c: PlanComment) => void;
}

const SENSITIVE_NOTE = '予約番号・PIN・旅券番号などの機密情報が含まれている可能性があります。予約や文書の専用の欄への記入を検討してください。';

const Composer: React.FC<{
  idPrefix: string; members: PlanMember[]; submitLabel: string; onSubmit: (body: string, mentions: string[]) => Promise<boolean>;
}> = ({ idPrefix, members, submitLabel, onSubmit }) => {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const others = members.filter((m) => !m.is_me);
  const submit = async () => {
    if (!body.trim()) return;
    setSaving(true);
    const ok = await onSubmit(body.trim(), mentions);
    setSaving(false);
    if (ok) {
      setBody('');
      setMentions([]);
    }
  };
  return (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-body`} className="block text-sm font-medium text-ink-900">{submitLabel}の内容</label>
      <textarea id={`${idPrefix}-body`} className="w-full border rounded-lg px-3 py-2" rows={2} maxLength={2000}
        value={body} onChange={(e) => setBody(e.target.value)} />
      {looksSensitive(body) && <p className="text-xs text-amber-900" role="note">{SENSITIVE_NOTE}</p>}
      {others.length > 0 && (
        <fieldset>
          <legend className="text-xs text-ink-900">メンション(通知する人)</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {others.map((m) => (
              <label key={m.user_id} className="flex items-center gap-1">
                <input type="checkbox" checked={mentions.includes(m.user_id)}
                  onChange={(e) => setMentions((prev) => e.target.checked ? [...prev, m.user_id] : prev.filter((x) => x !== m.user_id))} />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Button variant="primary" size="sm" onClick={submit} loading={saving} disabled={!body.trim()}>{submitLabel}</Button>
    </div>
  );
};

const CommentItem: React.FC<{
  c: PlanComment; onToggleResolved: Props['onToggleResolved']; onEdit: Props['onEdit']; onDelete: Props['onDelete'];
}> = ({ c, onToggleResolved, onEdit, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body ?? '');
  if (c.is_deleted) return <p className="text-sm text-ink-700 italic">このコメントは削除されました</p>;
  return (
    <div>
      <p className="text-xs text-ink-700">
        {c.author_name}{c.is_mine ? '(自分)' : ''}{c.edited_at ? '・編集済み' : ''}
        {c.status === 'resolved' && <span className="ml-1 px-1.5 rounded-sm bg-green-100 text-green-900">解決済み</span>}
      </p>
      {editing ? (
        <div className="space-y-1">
          <label htmlFor={`edit-${c.id}`} className="sr-only">コメントの編集</label>
          <textarea id={`edit-${c.id}`} className="w-full border rounded-sm px-2 py-1" rows={2} maxLength={2000}
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-1">
            <Button variant="primary" size="sm" onClick={async () => { if (await onEdit(c, text.trim())) setEditing(false); }}>保存</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>キャンセル</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-900 whitespace-pre-wrap">{c.body}</p>
      )}
      {c.mentions.length > 0 && <p className="text-xs text-ink-700">メンション: {c.mentions.map((m) => `@${m.name}`).join(' ')}</p>}
      {c.sensitive_warning && <p className="text-xs text-amber-900">{SENSITIVE_NOTE}</p>}
      <div className="flex gap-1 mt-1">
        {c.can_moderate && (
          <Button variant="ghost" size="sm" onClick={() => onToggleResolved(c)}>
            {c.status === 'resolved' ? '未解決に戻す' : '解決済みにする'}
          </Button>
        )}
        {c.can_edit && !editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>編集</Button>}
        {c.can_moderate && <Button variant="ghost" size="sm" onClick={() => onDelete(c)}>削除</Button>}
      </div>
    </div>
  );
};

const CommentsPanel: React.FC<Props> = ({ comments, members, onCreate, onToggleResolved, onEdit, onDelete }) => {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const threads = buildThreads(comments);
  return (
    <div className="space-y-4">
      <Card padding="md">
        <Composer idPrefix="new-comment" members={members} submitLabel="コメントする"
          onSubmit={(body, mentions) => onCreate({ body, mentions })} />
      </Card>
      {threads.length === 0 ? (
        <p className="text-sm text-ink-700">まだコメントはありません。</p>
      ) : (
        <ul className="space-y-3" aria-label="コメント">
          {threads.map(({ root, replies }) => (
            <li key={root.id}>
              <Card padding="md">
                <CommentItem c={root} onToggleResolved={onToggleResolved} onEdit={onEdit} onDelete={onDelete} />
                {replies.length > 0 && (
                  <ul className="mt-3 ml-4 pl-3 border-l space-y-2" aria-label="返信">
                    {replies.map((r) => (
                      <li key={r.id}><CommentItem c={r} onToggleResolved={onToggleResolved} onEdit={onEdit} onDelete={onDelete} /></li>
                    ))}
                  </ul>
                )}
                {!root.is_deleted && (replyTo === root.id ? (
                  <div className="mt-3 ml-4">
                    <Composer idPrefix={`reply-${root.id}`} members={members} submitLabel="返信する"
                      onSubmit={async (body, mentions) => {
                        const ok = await onCreate({ body, mentions, parent_id: root.id });
                        if (ok) setReplyTo(null);
                        return ok;
                      }} />
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setReplyTo(root.id)}>返信</Button>
                ))}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default CommentsPanel;
