/**
 * [Gate G4] 検索のコマンド・場所の例外の日・合意の決定・対象ごとのコメント・ゲストの閲覧・濫用の検知 の応答の decoder。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、decoders.ts から分けて、使う時に読み込む
 * (endpoints の該当メソッドが動的 import する。decodersG2.ts と同じ形)。
 */
import type { DayHours } from './types/candidates';
import type { CommandList, CommandPreview, CommandResult, CommandUndoResult } from './types/planSearch';
import type {
  AbuseReportList, AdoptionPreview, AdoptResult, GuestShareView, NotificationDigest, NotificationPrefs,
  SharePolicyExplained, ShareCloneResult, ShareInfo,
} from './types/g4';
import { poll, publicSharedPlan } from './decoders';
import { arrayOf, bool, decodeResponse, nullable, num, object, oneOf, record, str, type Decoder } from './decode';

export const dayHours: Decoder<DayHours> = object<DayHours>({
  date: str, source: oneOf('special', 'weekly', 'unknown'), closed: bool, note: nullable(str),
  windows: arrayOf(object({ open: str, close: str, crosses_midnight: bool, last_entry: nullable(str), last_order: nullable(str), source: str })),
  summary: str,
});

const commandKind = oneOf('mutate', 'navigate', 'run');

export const commandList: Decoder<CommandList> = object<CommandList>({
  commands: arrayOf(object({ name: str, label: str, kind: commandKind, usage: str, undoable: bool, allowed: bool,
    aliases: arrayOf(str) })),
  plan_revision: num,
});

export const commandPreview: Decoder<CommandPreview> = object<CommandPreview>({
  command: str, label: str, kind: commandKind, args: record, undoable: bool, allowed: bool, reason: nullable(str),
  needs_confirmation: bool, summary: arrayOf(str), problem: nullable(object({ code: str, message: str })),
  link: nullable(str), plan_revision: num,
});

export const commandResult: Decoder<CommandResult> = (v, path) => {
  const out = object<CommandResult>({
    run_id: str, status: oneOf('executed', 'undone'), command: str, label: str, undoable: bool, message: str,
    link: (x, p) => (x === undefined ? null : nullable(str)(x, p)), plan_revision: num,
  })(v, path);
  return out;
};

export const commandUndo: Decoder<CommandUndoResult> = object<CommandUndoResult>({
  run_id: str, status: oneOf('undone'), plan_revision: num, message: str,
});

const level = oneOf('all', 'mentions', 'none');
const labelled = arrayOf(object({ key: str, label: str }));
const policyExplained: Decoder<SharePolicyExplained> = object<SharePolicyExplained>({
  always: arrayOf(str), shown: labelled, hidden: labelled, never: arrayOf(str),
});

export const adoptionPreview: Decoder<AdoptionPreview> = object<AdoptionPreview>({
  poll_id: str, option_id: str, option_label: str, kind: oneOf('schedule_candidate', 'keep_event', 'record_only'),
  effects: arrayOf(str), problems: arrayOf(object({ code: str, message: str })), can_adopt: bool, undoable: bool,
  plan_revision: num,
});

export const adoptResult: Decoder<AdoptResult> = object<AdoptResult>({ poll, plan_revision: num, message: str });

export const notificationPrefs: Decoder<NotificationPrefs> = object<NotificationPrefs>({
  level, email_digest: oneOf('off', 'daily'), email_available: bool, has_email: bool,
  plans: arrayOf(object({ plan_id: str, plan_title: nullable(str), level })),
});

export const notificationDigest: Decoder<NotificationDigest> = object<NotificationDigest>({
  total: num,
  groups: arrayOf(object({ plan_id: nullable(str), plan_title: nullable(str), total: num, latest_at: nullable(str),
    types: arrayOf(object({ type: str, count: num })) })),
});

export const shareInfo: Decoder<ShareInfo> = object<ShareInfo>({
  needs_passcode: bool, expires_at: nullable(str), remaining_uses: nullable(num), allow_clone: bool,
  policy_explained: policyExplained,
});

export const publicShareView: Decoder<GuestShareView> = (v, path) => {
  const base = publicSharedPlan(v, path);
  const extra = object<{ allow_clone: boolean; policy_explained: SharePolicyExplained }>({
    allow_clone: bool, policy_explained: policyExplained,
  })(v, path);
  return { ...base, ...extra };
};

export const shareClone: Decoder<ShareCloneResult> = object<ShareCloneResult>({ plan_id: str, link: str, message: str });

const reportStatus = oneOf('open', 'dismissed', 'actioned');
export const abuseReports: Decoder<AbuseReportList> = object<AbuseReportList>({
  counts: object({ open: num, dismissed: num, actioned: num }),
  reports: arrayOf(object({
    id: str, source: oneOf('report', 'auto'), reason: oneOf('phishing', 'malware', 'spam', 'scraping', 'privacy', 'other'),
    reason_label: str, note: nullable(str), status: reportStatus, resolution: nullable(str), created_at: nullable(str),
    handled_at: nullable(str),
    plan: nullable(object({ id: str, title: str, owner_user_id: str })),
    share: nullable(object({
      id: str, token_prefix: str, plan_id: str, revoked_at: nullable(str), revoked_reason: nullable(str),
      is_active: bool, use_count: num, has_passcode: bool, accesses_24h: num,
    })),
  })),
});

export interface G4Types {
  dayHours: DayHours;
  commandList: CommandList;
  commandPreview: CommandPreview;
  commandResult: CommandResult;
  commandUndo: CommandUndoResult;
  adoptionPreview: AdoptionPreview;
  adoptResult: AdoptResult;
  notificationSettings: NotificationPrefs;
  notificationDigest: NotificationDigest;
  shareInfo: ShareInfo;
  publicShareView: GuestShareView;
  shareClone: ShareCloneResult;
  abuseReports: AbuseReportList;
}

const G4: { [K in keyof G4Types]: [Decoder<G4Types[K]>, string] } = {
  dayHours: [dayHours, 'GET /places/{place_id}/hours'],
  commandList: [commandList, 'GET /plans/{plan_id}/commands'],
  commandPreview: [commandPreview, 'POST /plans/{plan_id}/commands/preview'],
  commandResult: [commandResult, 'POST /plans/{plan_id}/commands/execute'],
  commandUndo: [commandUndo, 'POST /plans/{plan_id}/commands/{run_id}/undo'],
  adoptionPreview: [adoptionPreview, 'POST /plans/{plan_id}/polls/{poll_id}/adoption-preview'],
  adoptResult: [adoptResult, 'POST /plans/{plan_id}/polls/{poll_id}/adopt'],
  notificationSettings: [notificationPrefs, 'GET /notifications/settings'],
  notificationDigest: [notificationDigest, 'GET /notifications/digest'],
  shareInfo: [shareInfo, 'GET /public/share/{token}/info'],
  publicShareView: [publicShareView, 'GET /public/share/{token}/view'],
  shareClone: [shareClone, 'POST /public/share/{token}/clone'],
  abuseReports: [abuseReports, 'GET /admin/abuse'],
};

export function decodeG4<K extends keyof G4Types>(key: K, data: unknown): G4Types[K] {
  const [decoder, label] = G4[key];
  return decodeResponse(data, decoder, label);
}
