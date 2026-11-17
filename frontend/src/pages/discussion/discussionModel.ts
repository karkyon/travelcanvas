/**
 * [Gate P3] 相談・投票画面(FR-022 合意形成 / FR-024 コメント)の表示整形と入力検証。
 *
 * backend(app/api/v1/discussion.py)の規則に合わせる:
 *   - 懸念・不可には理由が必須。veto_policy=block_with_alternative では不可に代替案も必須
 *   - 匿名の投票は回答者3人未満の間は件数が返らない(null)
 *   - コメントに予約番号などらしき文字列があると sensitive_warning(保存は止めない)
 * [Gate ChatConsensus] 発言から投票・決定の下書きを作る(draftFromMessage)。下書きは人が直してから作る。
 */
import type {
  PlanComment, Poll, PollOption, PollState, OptionState, VetoPolicy, VoteInput, VoteValue,
} from '@/services/api';

export const VOTE_OPTIONS: { value: VoteValue; label: string }[] = [
  { value: 'love', label: 'ぜひ(Love)' },
  { value: 'ok', label: 'OK' },
  { value: 'concern', label: '懸念あり' },
  { value: 'veto', label: '不可' },
  { value: 'abstain', label: '棄権' },
];
export const VOTE_LABEL = Object.fromEntries(VOTE_OPTIONS.map((o) => [o.value, o.label])) as Record<VoteValue, string>;

export const OPTION_STATE_LABEL: Record<OptionState, string> = {
  pending: '回答待ち', blocked: '不可あり(不成立)', has_concerns: '懸念あり', agreed: '合意',
};
export const POLL_STATE_LABEL: Record<PollState, string> = {
  voting: '投票中', agreed: '合意あり', decided: '決定済み', blocked: '全て不成立', needs_discussion: '要相談',
};
export const VETO_POLICY_OPTIONS: { value: VetoPolicy; label: string; help: string }[] = [
  { value: 'block', label: '不可1票で不成立', help: '不可には理由が必要です' },
  { value: 'block_with_alternative', label: '不可1票で不成立(代替案が必要)', help: '不可には理由と代替案が必要です' },
  { value: 'advisory', label: '不可は参考意見', help: '不可があっても不成立にはしません' },
];
export const VETO_POLICY_LABEL = Object.fromEntries(VETO_POLICY_OPTIONS.map((o) => [o.value, o.label])) as Record<VetoPolicy, string>;

export interface AnswerDraft {
  value: VoteValue | '';
  reason: string;
  alternative: string;
}

export function draftsFromPoll(p: Poll): Record<string, AnswerDraft> {
  return Object.fromEntries(p.options.map((o) => {
    const mine = o.votes.find((v) => v.is_mine);
    return [o.id, { value: o.my_vote ?? '', reason: mine?.reason ?? '', alternative: mine?.alternative ?? '' }];
  }));
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** 回答の下書き → 送信内容。未選択は送らない(以前の回答を取り消す場合は value=null を送る)。 */
export function answersToPayload(p: Poll, drafts: Record<string, AnswerDraft>): Result<VoteInput[]> {
  const out: VoteInput[] = [];
  for (const o of p.options) {
    const d = drafts[o.id];
    if (!d) continue;
    if (!d.value) {
      if (o.my_vote) out.push({ option_id: o.id, value: null });
      continue;
    }
    const reason = d.reason.trim();
    const alternative = d.alternative.trim();
    if ((d.value === 'concern' || d.value === 'veto') && !reason) {
      return { ok: false, error: `「${o.label}」の${VOTE_LABEL[d.value]}には理由を入力してください` };
    }
    if (d.value === 'veto' && p.veto_policy === 'block_with_alternative' && !alternative) {
      return { ok: false, error: `「${o.label}」の不可には代替案を入力してください` };
    }
    out.push({
      option_id: o.id, value: d.value,
      ...(reason ? { reason } : {}),
      ...(alternative ? { alternative } : {}),
    });
  }
  if (out.length === 0) return { ok: false, error: '回答する選択肢を選んでください' };
  return { ok: true, data: out };
}

export function describeCounts(o: PollOption): string {
  if (!o.counts) return '回答が3人以上になると件数を表示します(匿名の投票)';
  return VOTE_OPTIONS.filter((v) => o.counts![v.value] > 0).map((v) => `${v.label} ${o.counts![v.value]}`).join('・') || 'まだ回答はありません';
}

/** 返信をまとめたスレッド(親の作成順、返信も作成順) */
export function buildThreads(comments: PlanComment[]): Array<{ root: PlanComment; replies: PlanComment[] }> {
  const roots = comments.filter((c) => !c.parent_id || !comments.some((x) => x.id === c.parent_id));
  return roots.map((root) => ({ root, replies: comments.filter((c) => c.parent_id === root.id) }));
}

const SENSITIVE = [
  /(予約番号|確認番号|PIN|暗証番号|パスポート|旅券|ビザ番号|カード番号|confirmation)/i,
  /\d{8,}/,
  /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b/,
];

/** 送信前の注意(backendの判定と同じ規則) */
export const looksSensitive = (text: string): boolean => SENSITIVE.some((re) => re.test(text));

// ===== [Gate ChatConsensus] 発言からの下書き

/** 末尾の「〜かな」「〜でいいよね」などを外す */
const TAIL = /(?:で(?:いい|良い|OK|ok)|が(?:いい|良い)|に(?:しよう|する|決定)|で(?:決まり|決定|行こう|いこう)|かな|かね|どう|どっち|どれ|とか|は\?|かも|だね|だよね|ね|よ|よね|か)+[?？!！。…\s]*$/;
/** 選択肢の区切り(「寿司か焼肉」の「か」は漢字・カタカナ・英数の間だけ。ひらがなの語の中の「か」では切らない) */
const SPLIT = /\s*(?:それとも|または|or|、|,|，|・|\/|／|\n|(?<=[^\sぁ-ん])か(?=[^ぁ-ん?？!！。\s]))\s*/;

const cleanPart = (part: string): string => {
  let out = part.trim().replace(/^[「『（(]+|[」』）)]+$/g, '').trim();
  for (let i = 0; i < 3; i += 1) out = out.replace(TAIL, '').trim();
  return out.replace(/[?？!！。…]+$/, '').trim();
};

/**
 * 発言から題名と選択肢の下書きを作る。
 *   「夕食は寿司か焼肉かな」→ 題名「夕食」・選択肢「寿司」「焼肉」
 *   「夕食は寿司でいいよね」→ 題名「夕食」・選択肢「寿司」(これで決まり の下書き)
 */
export function draftFromMessage(text: string): { title: string; options: string[] } {
  const body = text.replace(/[ \t]+/g, ' ').trim();
  const head = body.match(/^([^\n、。]{1,30}?)(?:は|って|なんだけど|だけど)\s*(.+)$/s);
  const title = head ? head[1]!.trim() : '';
  const rest = head ? head[2]! : body;
  const options: string[] = [];
  for (const part of rest.split(SPLIT)) {
    const label = cleanPart(part);
    if (label && label.length <= 40 && !options.includes(label)) options.push(label);
    if (options.length >= 10) break;
  }
  return { title, options };
}

/** 発言の短い引用(元の発言の表示) */
export const quoteOf = (text: string | null | undefined, limit = 40): string => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > limit ? `${t.slice(0, limit)}…` : t;
};
