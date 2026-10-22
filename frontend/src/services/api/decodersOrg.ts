/**
 * [Gate B1] 組織・B2B(FR-041)・外部連携の管理(FR-042)の応答の decoder。
 * [Gate G2] 最初に読む JS を小さく保つため decoders.ts から分け、endpoints/organizations.ts が使う時に読み込む。
 */
import type {
  AckStatus, DistributionAckList, DistributionSnapshot, ForkResult, Organization, OrgApiClient, OrgApiClientList,
  OrgDistribution, OrgMember, OrgWebhook, OrgWebhookDelivery, OrgWebhookList,
} from './types/organizations';
import { arrayOf, bool, int, matching, nonNegativeInt, nullable, object, oneOf, optional, record, str, type Decoder } from './decode';


const orgRole = oneOf('owner', 'admin', 'member');
// 説明の一覧(スコープ・できごと → 日本語の説明)
const stringMap: Decoder<Record<string, string>> = (v, path) =>
  Object.fromEntries(Object.entries(record(v, path)).map(([k, x]) => [k, str(x, `${path}.${k}`)]));
const brandColor = nullable(matching(/^#[0-9a-f]{6}$/i, '#RRGGBB'));

export const organization: Decoder<Organization> = object<Organization>({
  id: str, name: str, brand_color: brandColor, role: orgRole, member_count: nonNegativeInt, created_at: nullable(str),
});

export const orgMember: Decoder<OrgMember> = object<OrgMember>({
  id: str, user_id: str, username: nullable(str), email: nullable(str), role: orgRole, created_at: nullable(str),
});

const distributionSnapshot: Decoder<DistributionSnapshot> = object<DistributionSnapshot>({
  title: str, description: nullable(str), destination: nullable(str), start_date: nullable(str), end_date: nullable(str),
  days: arrayOf(object<DistributionSnapshot['days'][number]>({
    date: str, timezone_id: str, title: nullable(str),
    events: arrayOf(object<DistributionSnapshot['days'][number]['events'][number]>({
      title: str, event_type: str, local_start_time: nullable(str), is_all_day: bool,
    })),
  })),
});

const ackStatus: Decoder<AckStatus> = object<AckStatus>({
  members: nonNegativeInt, acknowledged_latest: nonNegativeInt, pending: nonNegativeInt,
});

export const orgDistribution: Decoder<OrgDistribution> = object<OrgDistribution>({
  id: str, organization_id: str, title: str, version: int, change_note: nullable(str), published_at: nullable(str),
  revoked_at: nullable(str), my_ack_version: nullable(int), acknowledged: bool, ack_status: nullable(ackStatus),
  snapshot: optional(distributionSnapshot),
  changes: optional(object<NonNullable<OrgDistribution['changes']>>({
    events_added: nonNegativeInt, events_removed: nonNegativeInt, events_changed: nonNegativeInt,
    days_before: nonNegativeInt, days_after: nonNegativeInt,
  })),
});

export const distributionAckList: Decoder<DistributionAckList> = object<DistributionAckList>({
  version: int,
  members: arrayOf(object<DistributionAckList['members'][number]>({
    member_id: str, username: nullable(str), role: orgRole, acked_version: nullable(int), acked_at: nullable(str),
  })),
  acknowledged_latest: nonNegativeInt, pending: nonNegativeInt,
});

export const forkResult: Decoder<ForkResult> = object<ForkResult>({ plan_id: str, title: str, version: int });

const orgApiScope = oneOf('distributions:read', 'distributions:write', 'acknowledgements:read');
export const orgApiClient: Decoder<OrgApiClient> = object<OrgApiClient>({
  id: str, name: str, client_id: str, client_secret: nullable(str), scopes: arrayOf(orgApiScope),
  created_at: nullable(str), last_used_at: nullable(str), revoked_at: nullable(str),
  secret_version: nonNegativeInt, secret_rotated_at: nullable(str), previous_secret_valid_until: nullable(str),
  tokens_revoked: optional(nonNegativeInt),
});
export const orgApiClientList: Decoder<OrgApiClientList> = object<OrgApiClientList>({
  clients: arrayOf(orgApiClient), scopes: stringMap,
});

const orgWebhookEvent = oneOf('distribution.published', 'distribution.revised', 'distribution.revoked', 'distribution.acknowledged');
export const orgWebhook: Decoder<OrgWebhook> = object<OrgWebhook>({
  id: str, url: str, events: arrayOf(orgWebhookEvent), secret: nullable(str), created_at: nullable(str),
  revoked_at: nullable(str), secret_version: nonNegativeInt, previous_secret_valid_until: nullable(str),
  disabled_reason: nullable(str),
});
export const orgWebhookList: Decoder<OrgWebhookList> = object<OrgWebhookList>({
  webhooks: arrayOf(orgWebhook), events: stringMap,
});
export const orgWebhookDelivery: Decoder<OrgWebhookDelivery> = object<OrgWebhookDelivery>({
  id: str, event_id: str, event_type: str, status: oneOf('pending', 'delivered', 'failed', 'dead'),
  attempts: nonNegativeInt, last_status_code: nullable(int), last_error: nullable(str), created_at: nullable(str),
  delivered_at: nullable(str), next_attempt_at: nullable(str), max_attempts: nonNegativeInt,
});
