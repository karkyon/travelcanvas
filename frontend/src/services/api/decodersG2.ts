/**
 * [Gate G2] FR-040 サポート閲覧・運用の要約 / FR-045 同行者向けの項目の規則 の応答の decoder。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、decoders.ts から分けて、使う時に読み込む
 * (endpoints の該当メソッドが動的 import する)。
 */
import type {
  AdminOperations, AdminShareLink, AdminSupportGrant, MemberFieldCategory, MemberFieldKey, MemberPolicy,
  MemberPolicyCatalog, MemberPolicyMember, SupportGrant, SupportGrantList, SupportView, SupportViewAccount,
  SupportViewEvent, SupportViewPlan,
} from './types/support';
import {
  arrayOf, bool, decodeResponse, int, nonNegativeInt, nullable, object, oneOf, optional, record, str, trueOnly, type Decoder,
} from './decode';

// ===== [Gate G2] FR-040 サポート閲覧・運用の要約 / FR-045 同行者向けの項目の規則 =====

const supportGrantState = oneOf('active', 'expired', 'revoked');
const supportScope = oneOf('plan', 'account');
const countMap: Decoder<Record<string, number>> = (v, path) => {
  const r = record(v, path);
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(r)) out[k] = nonNegativeInt(x, `${path}.${k}`);
  return out;
};

export const supportGrant: Decoder<SupportGrant> = object<SupportGrant>({
  id: str, plan_id: nullable(str), plan_title: nullable(str), scope: supportScope, purpose: str,
  ticket_ref: nullable(str), created_at: nullable(str), expires_at: nullable(str), revoked_at: nullable(str),
  state: supportGrantState, access_count: nonNegativeInt, last_accessed_at: nullable(str),
});

export const supportGrantList: Decoder<SupportGrantList> = object<SupportGrantList>({
  grants: arrayOf(supportGrant),
  limits: object<SupportGrantList['limits']>({
    min_hours: int, max_hours: int, default_hours: int, max_active: int, purpose_max: int,
  }),
  requires_password: bool,
});

export const adminSupportGrant: Decoder<AdminSupportGrant> = object<AdminSupportGrant>({
  id: str, plan_title: nullable(str), scope: supportScope, purpose: str,
  ticket_ref: nullable(str), created_at: nullable(str), expires_at: nullable(str), revoked_at: nullable(str),
  state: supportGrantState, access_count: nonNegativeInt, last_accessed_at: nullable(str),
  user_label: str, user_id: str, own: optional(bool),
});

const supportViewEvent = object<SupportViewEvent>({
  id: str, title: str, event_type: str, local_start_time: nullable(str), is_all_day: bool, locked: bool,
  has_address: bool, has_notes: bool, has_location: bool,
});

const supportViewPlan = object<SupportViewPlan>({
  id: str, title: str, destination: nullable(str), status: nullable(str), start_date: nullable(str),
  end_date: nullable(str), revision: int, deleted: bool,
  days: arrayOf(object<SupportViewPlan['days'][number]>({
    id: str, local_date: nullable(str), title: nullable(str), timezone_id: str, events: arrayOf(supportViewEvent),
  })),
  reservations: arrayOf(object<SupportViewPlan['reservations'][number]>({
    id: str, type: str, status: str, provider_name: nullable(str), start_at: nullable(str), end_at: nullable(str),
    confirmation_number: nullable(str),
  })),
  documents_by_classification: countMap,
  collaborators: nonNegativeInt,
});

const supportViewAccount = object<SupportViewAccount>({
  username: nullable(str), user_type: str, is_active: bool, created_at: nullable(str),
  plans: arrayOf(object<SupportViewAccount['plans'][number]>({
    id: str, title: str, status: nullable(str), start_date: nullable(str), end_date: nullable(str), deleted: bool,
    days: nonNegativeInt, events: nonNegativeInt,
  })),
});

export const supportView: Decoder<SupportView> = object<SupportView>({
  grant: adminSupportGrant,
  read_only: trueOnly,
  plan: optional(supportViewPlan),
  account: optional(supportViewAccount),
});

export const adminOperations: Decoder<AdminOperations> = object<AdminOperations>({
  share_links: object<AdminOperations['share_links']>({
    active: nonNegativeInt, active_edit: nonNegativeInt, without_expiry: nonNegativeInt,
  }),
  webhooks: object<AdminOperations['webhooks']>({
    pending: nonNegativeInt, failed: nonNegativeInt, dead: nonNegativeInt, delivered: nonNegativeInt,
  }),
  storage: object<AdminOperations['storage']>({
    database_bytes: nullable(nonNegativeInt), documents: nonNegativeInt, document_bytes: nonNegativeInt,
  }),
  purge: object<AdminOperations['purge']>({
    plans_pending: nonNegativeInt, plans_due: nonNegativeInt, documents_pending: nonNegativeInt,
  }),
  support_grants: object<AdminOperations['support_grants']>({ active: nonNegativeInt }),
  timestamp: str,
});

export const adminShareLink: Decoder<AdminShareLink> = object<AdminShareLink>({
  id: str, plan_id: str, token_prefix: str, permission: str, has_passcode: bool, use_count: nonNegativeInt,
  max_uses: nullable(int), expires_at: nullable(str), created_at: nullable(str),
});

const memberFieldKey = oneOf<MemberFieldKey>(
  'event_notes', 'event_address', 'reservations', 'reservation_secrets', 'tickets', 'documents', 'costs');

export const memberPolicy: Decoder<MemberPolicy> = object<MemberPolicy>({
  plan_id: str,
  role: oneOf('owner', 'editor', 'viewer'),
  catalog: object<MemberPolicyCatalog>({
    version: int,
    categories: arrayOf(object<MemberFieldCategory>({
      key: memberFieldKey, label: str, description: str, implies: arrayOf(memberFieldKey),
    })),
    presets: (v, path) => {
      const r = record(v, path);
      const out: Record<string, MemberFieldKey[]> = {};
      for (const [k, x] of Object.entries(r)) out[k] = arrayOf(memberFieldKey)(x, `${path}.${k}`);
      return out;
    },
  }),
  my_hidden: arrayOf(memberFieldKey),
  roles: optional(object<NonNullable<MemberPolicy['roles']>>({
    editor: arrayOf(memberFieldKey), viewer: arrayOf(memberFieldKey),
  })),
  configured: optional(bool),
  members: optional(arrayOf(object<MemberPolicyMember>({
    id: str, email: str, role: str, status: str, hidden: nullable(arrayOf(memberFieldKey)),
    effective_hidden: arrayOf(memberFieldKey),
  }))),
});

/** 名前 → (decoder, 失敗時に示す API)。endpoints は decodeG2(名前, 応答) だけを呼ぶ */
export interface G2Types {
  supportGrant: SupportGrant;
  supportGrantList: SupportGrantList;
  adminSupportGrants: { grants: AdminSupportGrant[] };
  supportView: SupportView;
  adminOperations: AdminOperations;
  adminShareLinks: { share_links: AdminShareLink[] };
  memberPolicy: MemberPolicy;
}

const G2: { [K in keyof G2Types]: [Decoder<G2Types[K]>, string] } = {
  supportGrant: [supportGrant, '/privacy/support-grants'],
  supportGrantList: [supportGrantList, 'GET /privacy/support-grants'],
  adminSupportGrants: [object<{ grants: AdminSupportGrant[] }>({ grants: arrayOf(adminSupportGrant) }), 'GET /admin/support-grants'],
  supportView: [supportView, 'GET /admin/support-grants/{grant_id}/view'],
  adminOperations: [adminOperations, 'GET /admin/operations'],
  adminShareLinks: [object<{ share_links: AdminShareLink[] }>({ share_links: arrayOf(adminShareLink) }),
    'GET /admin/operations/share-links'],
  memberPolicy: [memberPolicy, '/plans/{plan_id}/member-policy'],
};

export function decodeG2<K extends keyof G2Types>(key: K, data: unknown): G2Types[K] {
  const [decoder, label] = G2[key];
  return decodeResponse(data, decoder, label);
}
