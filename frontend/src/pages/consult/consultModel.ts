/**
 * [Gate G11] 行き先が未定の旅行相談の表示の決まりと状態(docs/ux/G11_UIUX全範囲_実装仕様.md §3.5、
 * 2026-10-29 の統合ハンドオフ §3・§4)。
 *
 * - 状態の言葉は画面の全てで同じにする(あなたの入力 / 文章から読み取り · 未確認 / 未指定 / 未照会 / 日付待ち / 提供元が未接続)
 * - 文章から読み取った行は、利用者が「合っている」と確かめるまで条件に使わない
 * - 入力の途中の状態はこのタブの間だけ覚える(sessionStorage。写真・記事を足しに行って戻っても消えない)
 */
import type {
  AreasResult, DraftInput, DraftPart, DraftSlot, ExtractInput, IntentExtraction, IntentItem, IntentPayload, IntentSource,
  IntentStrength,
} from '@/services/api/types/tripIntent';
import type { NearbyResult } from '@/services/api/types/g11discover';

export type ConsultStep = 'brief' | 'review' | 'areas' | 'detail';

export const STEPS: Array<{ id: ConsultStep; title: string; sub: string }> = [
  { id: 'brief', title: '希望を伝える', sub: '条件を入力' },
  { id: 'review', title: '内容を確認', sub: '読み取りを確かめる' },
  { id: 'areas', title: '方面を比較', sub: '候補を選ぶ' },
  { id: 'detail', title: '旅程案へ', sub: 'まだ確定前' },
];

export const SOURCE_LABEL: Record<IntentSource | 'confirmed', string> = {
  user_input: 'あなたの入力',
  text: '文章から読み取り · 未確認',
  unspecified: '未指定',
  confirmed: 'あなたが確認',
};

export const STRENGTH_LABEL: Record<IntentStrength, string> = { required: '必須', preferred: '希望', undecided: '未定' };

export const PREFERENCE_LABEL: Record<string, string> = {
  quiet: '人混みを避けて静かに', calm: '落ち着いた観光', food: '食を楽しむ', scenery: '絶景・自然', culture: '歴史・文化',
  onsen: '温泉', flexible_meals: '食事は宿でも外食でも',
};

export const BRIEF_PREFS = ['quiet', 'calm', 'food', 'scenery', 'culture', 'onsen'] as const;

export const EXAMPLE_TEXT = '家族4人で、下の子が社会人になる記念に1泊2日の旅行を考えています。枚方から車で、高速を使って片道3時間くらいまで。'
  + '人が多すぎない落ち着いた観光地で、4人1部屋の宿が希望です。宿泊費は4人で6〜8万円くらい。伊勢、福井、滋賀などが候補。'
  + '食事は宿でも外食でもよく、焼き肉もいいです。';

export interface BriefForm {
  text: string;
  origin: string;
  travelWindow: 'undecided' | 'window' | 'fixed';
  windowText: string;
  partySize: string;
  nights: string;
  transport: 'car' | 'public' | 'undecided';
  highway: boolean;
  oneWayStrength: 'preferred' | 'required' | 'undecided';
  room: 'same_room' | 'multiple_rooms' | 'undecided';
  budgetScope: 'total' | 'per_person' | 'undecided';
  preferences: string[];
}

export const EMPTY_BRIEF: BriefForm = {
  text: '', origin: '', travelWindow: 'undecided', windowText: '', partySize: '', nights: '', transport: 'undecided',
  highway: false, oneWayStrength: 'undecided', room: 'undecided', budgetScope: 'undecided', preferences: [],
};

/** 確認の画面の値(行ごとに「確かめたか」と「必須・希望・未定」を持つ) */
export interface ReviewValues {
  origin: string;
  party_size: number | null;
  nights: number | null;
  transport: 'car' | 'public' | 'undecided';
  highway: boolean;
  one_way_hours: number | null;
  one_way_strength: 'preferred' | 'required' | 'undecided';
  room: 'same_room' | 'multiple_rooms' | 'undecided';
  budget_min_man: number | null;
  budget_max_man: number | null;
  budget_scope: 'total' | 'per_person' | 'undecided';
  date_status: 'undecided' | 'window' | 'fixed';
  travel_window: string;
  preferences: string[];
}

export const REVIEW_KEYS = ['origin', 'party_size', 'nights', 'transport', 'one_way', 'room', 'budget', 'dates',
  'preferences'] as const;
export type ReviewKey = typeof REVIEW_KEYS[number];

export interface ReviewState {
  values: ReviewValues;
  sources: Record<ReviewKey, IntentSource>;
  confirmed: Record<ReviewKey, boolean>;
  strength: Record<ReviewKey, IntentStrength>;
  evidence: Partial<Record<ReviewKey, string | null>>;
  personal: boolean;
}

export interface ConsultState {
  step: ConsultStep;
  brief: BriefForm;
  extraction: IntentExtraction | null;
  review: ReviewState | null;
  areaNames: string[];
  areas: AreasResult | null;
  selectedArea: string | null;
  savedAreas: string[];
  picked: Record<string, NearbyResult>;
  urls: string[];
}

export const INITIAL_STATE: ConsultState = {
  step: 'brief', brief: EMPTY_BRIEF, extraction: null, review: null, areaNames: [], areas: null, selectedArea: null,
  savedAreas: [], picked: {}, urls: [],
};

export const STORAGE_KEY = 'tc.consult';

export function loadState(): ConsultState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<ConsultState>;
    if (!parsed || typeof parsed !== 'object' || !STEPS.some((s) => s.id === parsed.step)) return INITIAL_STATE;
    return { ...INITIAL_STATE, ...parsed, brief: { ...EMPTY_BRIEF, ...(parsed.brief ?? {}) } };
  } catch {
    return INITIAL_STATE;
  }
}

export function saveState(state: ConsultState): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 保存できない環境では、この画面を開いている間だけ覚える
  }
}

export function clearState(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 何もしない
  }
}

export function extractInputOf(brief: BriefForm): ExtractInput {
  const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return {
    text: brief.text,
    ...(brief.origin.trim() ? { origin: brief.origin.trim() } : {}),
    ...(brief.travelWindow !== 'undecided' && brief.windowText.trim() ? { travel_window: brief.windowText.trim() } : {}),
    ...(n(brief.partySize) ? { party_size: n(brief.partySize) } : {}),
    ...(brief.nights !== '' ? { nights: Number(brief.nights) } : {}),
    ...(brief.transport !== 'undecided' ? { transport: brief.transport, highway: brief.highway } : {}),
    ...(brief.oneWayStrength !== 'undecided' ? { one_way_strength: brief.oneWayStrength } : {}),
    ...(brief.room !== 'undecided' ? { room: brief.room } : {}),
    ...(brief.budgetScope !== 'undecided' ? { budget_scope: brief.budgetScope } : {}),
    ...(brief.preferences.length ? { preferences: brief.preferences } : {}),
  };
}

function item(ex: IntentExtraction, key: string): IntentItem | undefined {
  return ex.items.find((i) => i.key === key);
}

/** 読み取りの結果から確認の画面の初めの値を作る(あなたの入力は確かめ済み、文章からの行は未確認) */
export function initReview(ex: IntentExtraction): ReviewState {
  const get = (k: string) => item(ex, k);
  const tr = get('transport')?.value as { mode?: string; highway?: boolean } | null | undefined;
  const budget = get('budget')?.value as { min?: number; max?: number; scope?: string | null } | null | undefined;
  const dates = get('dates')?.value as { status?: string; text?: string } | null | undefined;
  const sources = {} as Record<ReviewKey, IntentSource>;
  const confirmed = {} as Record<ReviewKey, boolean>;
  const strength = {} as Record<ReviewKey, IntentStrength>;
  const evidence: Partial<Record<ReviewKey, string | null>> = {};
  for (const k of REVIEW_KEYS) {
    const it = get(k);
    sources[k] = it?.source ?? 'unspecified';
    confirmed[k] = it?.source === 'user_input';
    strength[k] = it?.strength ?? 'undecided';
    evidence[k] = it?.evidence ?? null;
  }
  const oneWay = get('one_way');
  return {
    values: {
      origin: typeof get('origin')?.value === 'string' ? (get('origin')!.value as string) : '',
      party_size: typeof get('party_size')?.value === 'number' ? (get('party_size')!.value as number) : null,
      nights: typeof get('nights')?.value === 'number' ? (get('nights')!.value as number) : null,
      transport: tr?.mode === 'car' || tr?.mode === 'public' ? tr.mode : 'undecided',
      highway: Boolean(tr?.highway),
      one_way_hours: typeof oneWay?.value === 'number' ? (oneWay.value as number) : null,
      one_way_strength: oneWay?.strength === 'preferred' || oneWay?.strength === 'required' ? oneWay.strength : 'undecided',
      room: get('room')?.value === 'same_room' || get('room')?.value === 'multiple_rooms'
        ? (get('room')!.value as 'same_room' | 'multiple_rooms') : 'undecided',
      budget_min_man: typeof budget?.min === 'number' ? budget.min / 10000 : null,
      budget_max_man: typeof budget?.max === 'number' ? budget.max / 10000 : null,
      budget_scope: budget?.scope === 'total' || budget?.scope === 'per_person' ? budget.scope : 'undecided',
      date_status: dates?.status === 'window' || dates?.status === 'fixed' ? dates.status : 'undecided',
      travel_window: dates?.text ?? '',
      preferences: Array.isArray(get('preferences')?.value) ? (get('preferences')!.value as string[]) : [],
    },
    sources, confirmed, strength, evidence,
    personal: ex.items.some((i) => i.sensitive),
  };
}

/** 未確定の問い(片道の時間・宿泊費の範囲)が残っているか */
export function openQuestions(r: ReviewState): Array<'one_way' | 'budget'> {
  const out: Array<'one_way' | 'budget'> = [];
  if (r.values.one_way_hours && r.values.one_way_strength === 'undecided') out.push('one_way');
  if (r.values.budget_min_man !== null && r.values.budget_scope === 'undecided') out.push('budget');
  return out;
}

/** 下書きに渡す条件。確かめた行だけを使う(文章から読み取っただけの行は使わない) */
export function intentOf(r: ReviewState): IntentPayload {
  const ok = (k: ReviewKey) => r.confirmed[k];
  const v = r.values;
  return {
    origin: ok('origin') && v.origin.trim() ? v.origin.trim() : null,
    party_size: ok('party_size') ? v.party_size : null,
    nights: v.nights ?? 1,
    transport: ok('transport') ? v.transport : 'undecided',
    highway: ok('transport') ? v.highway : false,
    one_way_hours: ok('one_way') ? v.one_way_hours : null,
    one_way_strength: ok('one_way') ? v.one_way_strength : 'undecided',
    room: ok('room') ? v.room : 'undecided',
    budget_min: ok('budget') && v.budget_min_man !== null ? Math.round(v.budget_min_man * 10000) : null,
    budget_max: ok('budget') && v.budget_max_man !== null ? Math.round(v.budget_max_man * 10000) : null,
    budget_scope: ok('budget') ? v.budget_scope : 'undecided',
    date_status: ok('dates') ? v.date_status : 'undecided',
    travel_window: ok('dates') && v.travel_window.trim() ? v.travel_window.trim().slice(0, 60) : null,
    preferences: ok('preferences') ? v.preferences.filter((p) => p in PREFERENCE_LABEL) : [],
  };
}

export function draftInputOf(state: ConsultState): DraftInput | null {
  if (!state.review || !state.selectedArea) return null;
  const a = state.areas?.areas.find((x) => x.name === state.selectedArea);
  const ok = a?.geocode.status === 'ok' && a.geocode.latitude !== null && a.geocode.longitude !== null;
  return {
    area: {
      name: state.selectedArea,
      latitude: ok ? a!.geocode.latitude : null,
      longitude: ok ? a!.geocode.longitude : null,
      provider: ok ? 'nominatim' : null,
      retrieved_at: ok ? a!.geocode.retrieved_at : null,
    },
    intent: intentOf(state.review),
    search_candidate_ids: Object.keys(state.picked).slice(0, 30),
    source_urls: state.urls.slice(0, 10),
  };
}

// ----------------------------------------------------------------- 方面の比較の言葉

export const GEOCODE_LABEL: Record<string, string> = {
  ok: '位置を照会済み', not_found: '位置が見つかりません', unavailable: '位置を照会できませんでした(未照会)',
  disabled: '位置の照会は止めてあります(未照会)',
};

export const LIMIT_LABEL: Record<string, string> = {
  exceeds: '条件を超えます', likely_exceeds: '希望を超えそう', unknown: '合うかは未確認', no_limit: '条件なし',
};

export function straightLabel(km: number | null, origin: string): string {
  if (km === null) return '直線距離 · 未計算(位置が未照会)';
  return `${origin || '出発地'}から直線 ${km < 10 ? km.toFixed(1) : Math.round(km)}km(計算値 · 道路の距離ではない)`;
}

export function retrievedLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `取得 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 方面の詳細のカテゴリ(観光・食べ物・市場・買い物・絶景・静かに過ごす) */
export const CONSULT_CATEGORIES = [
  { id: 'sightseeing', label: '観光' }, { id: 'food', label: '食べ物' }, { id: 'market', label: '市場' },
  { id: 'shopping', label: '買い物' }, { id: 'viewpoint', label: '絶景' }, { id: 'quiet', label: '静かに過ごす' },
] as const;
export type ConsultCategory = typeof CONSULT_CATEGORIES[number]['id'];

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------- 下書きの並び

export const PART_ORDER: DraftPart[] = ['morning', 'lunch', 'afternoon', 'evening', 'stay'];

export function partsOfDay(day: number, totalDays: number): DraftPart[] {
  return PART_ORDER.filter((p) => p !== 'stay' || day < totalDays);
}

export function sortSlots(slots: DraftSlot[]): DraftSlot[] {
  return slots.map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.day - b.s.day || PART_ORDER.indexOf(a.s.part) - PART_ORDER.indexOf(b.s.part) || a.i - b.i)
    .map((x) => x.s);
}

/**
 * 同じ日の中で1つ上・下へ動かす。隣が別の時間帯なら、その時間帯へ移る(午前の先頭を上へは動かせない)。
 * 動かせない時は null。
 */
export function moveSlot(slots: DraftSlot[], candidateId: string, delta: -1 | 1, totalDays: number): DraftSlot[] | null {
  const sorted = sortSlots(slots);
  const idx = sorted.findIndex((s) => s.candidate_id === candidateId);
  if (idx < 0) return null;
  const me = sorted[idx]!;
  const sameDay = sorted.filter((s) => s.day === me.day);
  const pos = sameDay.indexOf(me);
  const neighbor = sameDay[pos + delta];
  const parts = partsOfDay(me.day, totalDays);
  if (neighbor && neighbor.part === me.part) {
    const next = [...sorted];
    const j = next.indexOf(neighbor);
    next[idx] = neighbor;
    next[j] = me;
    return next;
  }
  const pi = parts.indexOf(me.part) + delta;
  if (pi < 0 || pi >= parts.length) return null;
  const moved: DraftSlot = { ...me, part: parts[pi]! };
  const rest = sorted.filter((s) => s !== me);
  // 新しい時間帯の、近い側の端へ入れる
  const target = rest.filter((s) => s.day === me.day && s.part === moved.part);
  const anchor = delta < 0 ? target[target.length - 1] : target[0];
  const at = anchor ? rest.indexOf(anchor) + (delta < 0 ? 1 : 0) : rest.length;
  rest.splice(at, 0, moved);
  return sortSlots(rest);
}

export function placeSlot(slots: DraftSlot[], candidateId: string, day: number, part: DraftPart): DraftSlot[] {
  return sortSlots([...slots.filter((s) => s.candidate_id !== candidateId), { day, part, candidate_id: candidateId }]);
}

export function removeSlot(slots: DraftSlot[], candidateId: string): DraftSlot[] {
  return slots.filter((s) => s.candidate_id !== candidateId);
}

export function dayCounts(slots: DraftSlot[], totalDays: number): number[] {
  return Array.from({ length: totalDays }, (_, i) => slots.filter((s) => s.day === i + 1).length);
}
