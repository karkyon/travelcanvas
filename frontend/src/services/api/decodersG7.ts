/**
 * [Gate G7] 移動・滞在の既定・目的の内訳と部分の採用・分岐の比較・影響のプレビュー・思い出からの提案(v2)・猶予つきの削除
 * の応答の decoder(使う画面が g7.ts 経由で読む。最初に読む JS に入れない)。
 */
import type {
  BranchComparison, CompareBranch, CompareColumn, DayMetric, DeletionScheduleResult, G7Candidate, G7Candidates,
  G7Insight, G7MemoryReplan, G7Proposal, ImpactIssue, ImpactPreview, Money, MovementEffective, MovementSettings,
  MovementSettingsValue, Objective, ObjectiveTerm, PartialPreview, RunMovement,
} from './types/g7';
import {
  arrayOf, bool, decodeResponse, int, nonNegativeInt, nullable, num, object, oneOf, optional, record, str, type Decoder,
} from './decode';

const pace = oneOf('relaxed', 'normal', 'active');
const eventType = oneOf('sightseeing', 'activity', 'dining', 'shopping', 'accommodation', 'transportation', 'other');
const stays = record as Decoder<MovementSettingsValue['stay_minutes']>;
const severity = oneOf('ERROR', 'WARNING', 'INFO');

const settingsValue: Decoder<MovementSettingsValue> = object<MovementSettingsValue>({
  enabled: bool, pace, stay_minutes: stays, break_minutes: nonNegativeInt,
  max_continuous_minutes: nullable(nonNegativeInt), max_day_minutes: nullable(nonNegativeInt), short_stay_ratio: num,
  last_transport_margin_minutes: nonNegativeInt,
  party: object({ with_children: bool, with_seniors: bool, size: nullable(nonNegativeInt) }),
});

const effective: Decoder<MovementEffective> = object<MovementEffective>({
  stay_minutes: stays, break_minutes: nonNegativeInt, max_continuous_minutes: nonNegativeInt,
  max_day_minutes: nonNegativeInt, short_stay_ratio: num, last_transport_margin_minutes: nonNegativeInt, pace,
  with_children: bool, with_seniors: bool, notes: arrayOf(str),
});

const movementSettings: Decoder<MovementSettings> = object<MovementSettings>({
  plan_id: str, algorithm_version: str, settings: settingsValue, revision: nonNegativeInt, is_default: bool,
  effective: nullable(effective),
  event_types: arrayOf(object({ key: eventType, label: str, default_minutes: nullable(nonNegativeInt), estimated: bool })),
  paces: arrayOf(object({ key: pace, label: str, stay_factor: num, max_continuous: num, max_day: num })),
  can_edit: bool,
});

const dayMetric: Decoder<DayMetric> = object<DayMetric>({
  day_id: str, local_date: str, events: nonNegativeInt, active_minutes: nonNegativeInt,
  walking_minutes: nonNegativeInt, ride_minutes: nonNegativeInt, longest_continuous_minutes: nonNegativeInt,
  span_minutes: nonNegativeInt, fatigue_percent: nonNegativeInt, level: oneOf('light', 'normal', 'heavy'),
  estimated: bool, incomplete: bool,
});

const runMovement: Decoder<RunMovement> = object<RunMovement>({
  day_metrics: (v, path) => (v === undefined ? [] : arrayOf(dayMetric)(v, path)),
  movement: (v, path) => (v === undefined ? null : nullable(effective)(v, path)),
});

const counts = object({ error: nonNegativeInt, warning: nonNegativeInt, info: nonNegativeInt, unverified: nonNegativeInt });

const impactIssue: Decoder<ImpactIssue> = object<ImpactIssue>({
  code: str, severity, message: str, entity_label: nullable(str), estimated: bool, is_private_constraint: bool,
});

const impactPreview: Decoder<ImpactPreview> = object<ImpactPreview>({
  event_id: str, plan_revision: int, algorithm_version: str, before: counts, after: counts,
  new_issues: arrayOf(impactIssue), resolved_issues: arrayOf(impactIssue),
  related: object({ segments: nonNegativeInt, reservations: nonNegativeInt }),
  end_day_offset: nullable(nonNegativeInt), summary: arrayOf(str),
});

// ===== MOVE-04
const weights = object({ distance: nonNegativeInt, constraints: nonNegativeInt, fatigue: nonNegativeInt,
  fairness: nonNegativeInt });
const term: Decoder<ObjectiveTerm> = object<ObjectiveTerm>({
  key: oneOf('distance', 'constraints', 'fatigue', 'fairness'), label: str, value: nullable(num), unit: str,
  score: num, rule: str, weight: nonNegativeInt, weighted: num,
});
const objective: Decoder<Objective> = object<Objective>({ terms: arrayOf(term), total: num, weights });
const metricsShape = {
  distance_km: num, duration_minutes: num, unknown_legs: nonNegativeInt,
  error: nonNegativeInt, warning: nonNegativeInt, info: nonNegativeInt, unverified: nonNegativeInt,
  constraints_satisfied: nonNegativeInt, constraints_violated: nonNegativeInt,
  fatigue_percent: nullable(nonNegativeInt), longest_continuous_minutes: nullable(nonNegativeInt),
  fairness_spread_percent: nullable(nonNegativeInt),
};
const optIssue = object({ code: str, severity, message: str, entity_label: nullable(str), is_private_constraint: bool });
const changes = arrayOf(object({
  event_id: str, title: str, before_index: int, after_index: int, before_time: nullable(str), after_time: nullable(str),
}));
const candidateMetrics = object<G7Candidate['metrics']>({
  ...metricsShape, saved_distance_km: num, saved_duration_minutes: num,
});
const candidate: Decoder<G7Candidate> = object<G7Candidate>({
  id: str, kinds: arrayOf(oneOf('shortest', 'constraints', 'balanced')), label: str, order: arrayOf(str), changes,
  metrics: candidateMetrics, new_issues: arrayOf(optIssue), resolved_issues: arrayOf(optIssue),
  explanations: arrayOf(str), objective,
});
const candidates: Decoder<G7Candidates> = object<G7Candidates>({
  plan_id: str, day_id: str, local_date: str, algorithm_version: str, validation_algorithm_version: str,
  travel_mode: oneOf('walking', 'driving', 'train', 'bus', 'bicycle', 'taxi'), base_revision: int,
  input_fingerprint: str,
  current: object({ order: arrayOf(str), metrics: object<G7Candidates['current']['metrics']>(metricsShape), objective }),
  fixed: arrayOf(object({ event_id: str, title: str, reason: str })), movable_count: nonNegativeInt,
  candidates: arrayOf(candidate), warnings: arrayOf(str), can_apply: bool,
  weights, weights_given: bool,
  weight_labels: object({ distance: str, constraints: str, fatigue: str, fairness: str }),
  movement_applied: bool,
});
const partialPreview: Decoder<PartialPreview> = object<PartialPreview>({
  candidate_id: str, event_ids: arrayOf(str), order: arrayOf(str), changes, metrics: candidateMetrics, objective,
  new_issues: arrayOf(optIssue), resolved_issues: arrayOf(optIssue), explanations: arrayOf(str), can_apply: bool,
});
const applyResult = object({ plan_revision: int, changed: nonNegativeInt, change_set_id: nullable(str),
  algorithm_version: str });

// ===== FR-019
const money: Decoder<Money> = object<Money>({ currency: str, amount: str });
const columnShape = {
  counts, constraints_violated: nonNegativeInt, constraints_satisfied: nonNegativeInt,
  travel: object({ minutes: nonNegativeInt, km: num, legs: nonNegativeInt, unknown_legs: nonNegativeInt, is_estimate: bool }),
  max_fatigue_percent: nullable(nonNegativeInt), heavy_days: nonNegativeInt,
  costs: nullable(object({ total: arrayOf(money), removed: arrayOf(money) })),
};
const compareBranch: Decoder<CompareBranch> = object<CompareBranch>({
  ...columnShape, id: str, title: str, scenario_type: str, state: str,
  summary: object({ added: nonNegativeInt, removed: nonNegativeInt, updated: nonNegativeInt, time_changed: nonNegativeInt }),
  conflicts: nonNegativeInt, new_issues: arrayOf(impactIssue), resolved_issues: arrayOf(impactIssue),
  affected_reservations: nullable(arrayOf(object({ id: str, label: str, status: str }))),
  budget_target: nullable(arrayOf(object({ currency: str, target: str, branch: str, met: bool }))),
});
const comparison: Decoder<BranchComparison> = object<BranchComparison>({
  plan_id: str, plan_revision: int, algorithm_version: str, validation_algorithm_version: str, movement_applied: bool,
  plan: object<CompareColumn & { title: string }>({ ...columnShape, title: str }), branches: arrayOf(compareBranch),
  costs_hidden: bool, reservations_hidden: bool, can_adopt: bool,
});

// ===== MEM-03
const insight: Decoder<G7Insight> = object<G7Insight>({
  kind: oneOf('stay_longer', 'stay_shorter', 'late_arrival', 'often_skipped', 'slow_transport'),
  event_type: nullable(str), minutes: nullable(nonNegativeInt), samples: nonNegativeInt, skipped: optional(nonNegativeInt),
  plans: arrayOf(str), examples: arrayOf(str), applicable: bool, basis: oneOf('same_party', 'all'),
  party_label: optional(str), mode: optional(str), mode_label: optional(str),
});
const proposalChange: Decoder<G7Proposal['changes'][number]> = (v, path) =>
  (v && typeof v === 'object' && 'segment_id' in v
    ? object({ segment_id: str, label: str, from: nonNegativeInt, to: nonNegativeInt })(v, path)
    : object({ event_id: str, title: str, day_id: str, from: str, to: str })(v, path));
const proposal: Decoder<G7Proposal> = object<G7Proposal>({
  id: str, kind: oneOf('stay_longer', 'slow_transport'), event_type: nullable(str), minutes: nonNegativeInt,
  mode: optional(str), target: optional(oneOf('segment')), changes: arrayOf(proposalChange),
  kept: arrayOf(object({ event_id: str, title: str, reason: oneOf('locked', 'has_reservation', 'next_day') })),
});
const memoryReplan: Decoder<G7MemoryReplan> = object<G7MemoryReplan>({
  plan_id: str, plan_revision: int, insights: arrayOf(insight), proposals: arrayOf(proposal), input_fingerprint: str,
  sample_count: nonNegativeInt, transport_sample_count: nonNegativeInt,
  party: object({ with_children: bool, with_seniors: bool, size: nonNegativeInt, group: oneOf('solo', 'group') }),
  party_label: str, algorithm_version: str, can_apply: bool,
});

// ===== FR-039
const schedule = object({ requested_at: nullable(str), due_at: str });
const scheduleResult: Decoder<DeletionScheduleResult> = object<DeletionScheduleResult>({
  scheduled: nullable(schedule), account_delete_grace_days: optional(nonNegativeInt), due_at: optional(str),
});

export interface G7Types {
  movementSettings: MovementSettings;
  runMovement: RunMovement;
  impact: ImpactPreview;
  candidates: G7Candidates;
  partial: PartialPreview;
  apply: { plan_revision: number; changed: number; change_set_id: string | null; algorithm_version: string };
  comparison: BranchComparison;
  memoryReplan: G7MemoryReplan;
  schedule: DeletionScheduleResult;
}

const G7: { [K in keyof G7Types]: [Decoder<G7Types[K]>, string] } = {
  movementSettings: [movementSettings, 'GET /plans/{plan_id}/movement-settings'],
  runMovement: [runMovement, 'POST /plans/{plan_id}/validation-runs'],
  impact: [impactPreview, 'POST /plans/{plan_id}/events/{event_id}/impact-preview'],
  candidates: [candidates, 'POST /plans/{plan_id}/days/{day_id}/optimization-candidates'],
  partial: [partialPreview, 'POST /plans/{plan_id}/days/{day_id}/optimization-candidates/partial-preview'],
  apply: [applyResult, 'POST /plans/{plan_id}/days/{day_id}/optimization-candidates/apply'],
  comparison: [comparison, 'GET /plans/{plan_id}/branches-comparison'],
  memoryReplan: [memoryReplan, 'GET /plans/{plan_id}/memory-replan'],
  schedule: [scheduleResult, 'POST /privacy/account-deletion/schedule'],
};

export function decodeG7<K extends keyof G7Types>(key: K, data: unknown): G7Types[K] {
  const [decoder, label] = G7[key];
  return decodeResponse(data, decoder, label);
}
