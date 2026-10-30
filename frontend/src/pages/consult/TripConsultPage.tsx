/**
 * [Gate G11] 行き先が未定の旅行相談(G11 の段階5 Intake。docs/ux/G11_UIUX全範囲_実装仕様.md §3.5、
 * 2026-10-29 の統合ハンドオフ §3「旅程相談 UI/UX v2」)。
 *
 * 希望を伝える → 内容を確認 → 方面を比較 → 旅程案へ(方面の詳細 → 未確定の下書き)。
 * - 各段で「今どこか・戻る先・主な操作・押すと何が起きるか」を示す。旅行・予約は下書きを作るまで作らない
 * - 文章からの読み取りは決まった規則だけ(AI は未接続)。利用者が確かめた行だけを条件に使う
 * - 運転時間・宿・混み具合・営業時間は値を作らず「未照会」「日付待ち」「提供元が未接続」と文字で示す
 * - 行き先が決まっている人は「旅行を作る」(Quick Plan)へ進める
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import PlanningClassSummary from '@/components/planning/PlanningClassSummary';
import { compareAreas, createTripDraft, extractIntent } from '@/services/api/tripIntent';
import AreasStep from './AreasStep';
import AreaDetailStep from './AreaDetailStep';
import {
  BRIEF_PREFS, EXAMPLE_TEXT, INITIAL_STATE, PREFERENCE_LABEL, REVIEW_KEYS, SOURCE_LABEL, STEPS, STRENGTH_LABEL,
  clearState, draftInputOf, extractInputOf, initReview, loadState, openQuestions, saveState,
  type BriefForm, type ConsultState, type ConsultStep, type ReviewKey, type ReviewState,
} from './consultModel';
import UiIcon from '@/components/common/UiIcon';
import { IcLock } from '@/components/common/uiIcons';

const field = 'tc-focus-ring w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-ink-900 min-h-11';
const help = 'mt-1 text-xs text-ink-700';

// ------------------------------------------------------------------ 進み具合

const Stepper: React.FC<{ step: ConsultStep }> = ({ step }) => {
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <ol aria-label="旅行相談の進み具合" className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-cloud-200 bg-surface p-2 sm:grid-cols-4">
      {STEPS.map((s, i) => (
        <li key={s.id} aria-current={i === current ? 'step' : undefined}
          className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 ${i === current ? 'bg-accent-soft' : ''}`}>
          <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${
            i < current ? 'border-success bg-success-soft text-success' : i === current
              ? 'border-accent bg-accent text-on-accent' : 'border-cloud-200 text-ink-700'}`}>
            {i < current ? '✓' : `0${i + 1}`}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-ink-900">{s.title}</span>
            <span className="block text-[11px] text-ink-700">
              {i < current ? '済み' : i === current ? `いまここ · ${s.sub}` : s.sub}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
};

// ------------------------------------------------------------------ 1. 希望を伝える

const BriefStep: React.FC<{
  brief: BriefForm; onChange: (b: BriefForm) => void; onSubmit: () => void; busy: boolean; error: string | null;
}> = ({ brief, onChange, onSubmit, busy, error }) => {
  const id = useId();
  const optRef = useRef<HTMLDetailsElement>(null);
  const set = <K extends keyof BriefForm>(k: K, v: BriefForm[K]) => onChange({ ...brief, [k]: v });
  const summary: Array<{ label: string; value: string; state: '入力' | '要確認' | '未入力' }> = [
    { label: '出発地', value: brief.origin || '未入力', state: brief.origin ? '入力' : '未入力' },
    { label: '時期・日数', value: `${brief.travelWindow === 'undecided' ? '日付未定' : brief.windowText || '時期を入力'} · ${
      brief.nights === '' ? '日数未入力' : brief.nights === '0' ? '日帰り' : `${brief.nights}泊${Number(brief.nights) + 1}日`}`,
    state: brief.nights === '' ? '未入力' : '入力' },
    { label: '同行者', value: brief.partySize ? `大人${brief.partySize}人` : '未入力', state: brief.partySize ? '入力' : '未入力' },
    { label: '移動・宿', value: [brief.transport === 'car' ? `車${brief.highway ? '・高速' : ''}` : brief.transport === 'public'
      ? '公共交通' : '移動は未指定', brief.room === 'same_room' ? '全員で同じ部屋' : brief.room === 'multiple_rooms'
      ? '複数の部屋も可' : '部屋は未指定'].join(' · '),
    state: brief.transport === 'undecided' && brief.room === 'undecided' ? '未入力' : '要確認' },
  ];
  const openOptional = () => {
    if (optRef.current) {
      optRef.current.open = true;
      optRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      optRef.current.querySelector<HTMLElement>('select, input')?.focus();
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.72fr)]">
      <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-cloud-200 bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cloud-200 pb-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-accent">STEP 1 · TRIP BRIEF</p>
            <h2 id={`${id}-h`} className="mt-1 text-xl font-bold text-ink-900">今回の旅行について</h2>
            <p className="text-sm text-ink-700">文章でまとめても、下の項目だけ入力しても構いません。</p>
          </div>
          <span className="rounded-full border border-cloud-200 px-2 py-1 text-xs text-ink-700">保存前の相談</span>
        </div>
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} aria-label="旅行の希望">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${id}-text`} className="text-sm font-semibold text-ink-900">希望・事情</label>
              <button type="button" className="tc-focus-ring text-xs font-medium text-accent underline min-h-11"
                onClick={() => set('text', EXAMPLE_TEXT)}>例文を入れる</button>
            </div>
            <textarea id={`${id}-text`} value={brief.text} onChange={(e) => set('text', e.target.value)} rows={6} maxLength={4000}
              aria-describedby={`${id}-text-help`} className={`${field} leading-relaxed`}
              placeholder="例: 家族4人で1泊2日。枚方から車で片道3時間くらいまで。人が多すぎない所。伊勢、福井、滋賀などが候補。" />
            <p id={`${id}-text-help`} className={help}>
              箇条書きでも大丈夫です。未定のことは「未定」と書いてください。次の画面で、読み取った内容を自分で確かめ・直せます。
            </p>
          </div>
          <p className="flex items-center gap-2 text-xs font-semibold text-ink-700">候補を探すのに使う基本の情報</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-origin`} className="text-sm font-semibold text-ink-900">出発地</label>
              <input id={`${id}-origin`} value={brief.origin} maxLength={100} onChange={(e) => set('origin', e.target.value)}
                aria-describedby={`${id}-origin-help`} className={field} placeholder="例: 大阪府枚方市" autoComplete="address-level2" />
              <p id={`${id}-origin-help`} className={help}>市区町村まで。番地は不要です。方面との位置関係に使います。</p>
            </div>
            <div>
              <label htmlFor={`${id}-window`} className="text-sm font-semibold text-ink-900">旅行の時期</label>
              <select id={`${id}-window`} value={brief.travelWindow} className={field} aria-describedby={`${id}-window-help`}
                onChange={(e) => set('travelWindow', e.target.value as BriefForm['travelWindow'])}>
                <option value="undecided">日付は未定</option>
                <option value="window">おおよその時期を書く</option>
                <option value="fixed">日付が決まっている</option>
              </select>
              {brief.travelWindow !== 'undecided' && (
                <input aria-label="時期・日付" value={brief.windowText} maxLength={60}
                  onChange={(e) => set('windowText', e.target.value)} className={`${field} mt-2`}
                  placeholder={brief.travelWindow === 'fixed' ? '例: 11月28日から' : '例: 約1か月後の週末'} />
              )}
              <p id={`${id}-window-help`} className={help}>日付が決まると、宿の空室・料金と営業日を調べられるようになります。</p>
            </div>
            <div>
              <label htmlFor={`${id}-party`} className="text-sm font-semibold text-ink-900">人数(大人)</label>
              <input id={`${id}-party`} type="number" min={1} max={30} inputMode="numeric" value={brief.partySize}
                onChange={(e) => set('partySize', e.target.value)} className={field} aria-describedby={`${id}-party-help`} />
              <p id={`${id}-party-help`} className={help}>宿を「何人で1部屋か」の条件で探す時に使います。</p>
            </div>
            <div>
              <label htmlFor={`${id}-nights`} className="text-sm font-semibold text-ink-900">旅行の日数</label>
              <select id={`${id}-nights`} value={brief.nights} onChange={(e) => set('nights', e.target.value)} className={field}
                aria-describedby={`${id}-nights-help`}>
                <option value="">文章から読む・未定</option>
                <option value="0">日帰り</option>
                <option value="1">1泊2日</option>
                <option value="2">2泊3日</option>
                <option value="3">3泊4日</option>
              </select>
              <p id={`${id}-nights-help`} className={help}>日数をもとに、無理のない下書きの枠(午前・昼食・午後…)を作ります。</p>
            </div>
          </div>
          <details ref={optRef} className="rounded-xl border border-cloud-200 bg-cloud-0">
            <summary className="tc-focus-ring flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold text-ink-900">
              移動・宿・過ごし方をもう少し指定する<span className="text-xs font-normal text-ink-700">任意 · いつでも変更できます</span>
            </summary>
            <div className="grid gap-4 border-t border-cloud-200 p-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-tr`} className="text-sm text-ink-900">移動手段</label>
                <select id={`${id}-tr`} value={brief.transport} className={field}
                  onChange={(e) => set('transport', e.target.value as BriefForm['transport'])}>
                  <option value="undecided">まだ決めていない</option>
                  <option value="car">自家用車</option>
                  <option value="public">公共交通</option>
                </select>
                {brief.transport === 'car' && (
                  <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-ink-900">
                    <input type="checkbox" checked={brief.highway} onChange={(e) => set('highway', e.target.checked)} />
                    高速道路を使う
                  </label>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-ow`} className="text-sm text-ink-900">片道の移動時間の扱い</label>
                <select id={`${id}-ow`} value={brief.oneWayStrength} className={field}
                  onChange={(e) => set('oneWayStrength', e.target.value as BriefForm['oneWayStrength'])}>
                  <option value="undecided">文章に書いた時間を、次の画面で確かめる</option>
                  <option value="preferred">希望(少し超えても比べる)</option>
                  <option value="required">絶対条件(超える方面に印を付ける)</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-room`} className="text-sm text-ink-900">宿の部屋</label>
                <select id={`${id}-room`} value={brief.room} className={field}
                  onChange={(e) => set('room', e.target.value as BriefForm['room'])}>
                  <option value="undecided">未指定</option>
                  <option value="same_room">全員で同じ部屋</option>
                  <option value="multiple_rooms">複数の部屋でもよい</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-bs`} className="text-sm text-ink-900">宿泊費の目安の意味</label>
                <select id={`${id}-bs`} value={brief.budgetScope} className={field}
                  onChange={(e) => set('budgetScope', e.target.value as BriefForm['budgetScope'])}>
                  <option value="undecided">文章の金額を、次の画面で確かめる</option>
                  <option value="total">全員の合計(1部屋・1泊)</option>
                  <option value="per_person">1人あたり</option>
                </select>
              </div>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm text-ink-900">旅の過ごし方</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {BRIEF_PREFS.map((p) => {
                    const on = brief.preferences.includes(p);
                    return (
                      <button key={p} type="button" aria-pressed={on}
                        onClick={() => set('preferences', on ? brief.preferences.filter((x) => x !== p) : [...brief.preferences, p])}
                        className={`tc-focus-ring min-h-11 rounded-full border px-3 text-sm ${on
                          ? 'border-accent bg-accent-soft text-ink-900' : 'border-cloud-200 bg-cloud-0 text-ink-700'}`}>
                        {on ? '✓ ' : ''}{PREFERENCE_LABEL[p]}
                      </button>
                    );
                  })}
                </div>
                <p className={help}>選ぶと、方面の比較で「希望に合う点」を見る時の手がかりになります。</p>
              </fieldset>
            </div>
          </details>
          <div className="rounded-xl border border-dashed border-cloud-200 p-3 text-sm text-ink-700">
            <p className="font-semibold text-ink-900">写真・記事・SNS は、方面を選んだ後に「参考の出典」として足せます</p>
            <p className="text-xs">URL を足しても、それだけで旅程には入りません(出典として残し、場所は確かめてから使います)。</p>
          </div>
          {error && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
          <div className="flex flex-col gap-3 border-t border-cloud-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-700" id={`${id}-next`}>
              <span className="block font-semibold text-ink-900">次に行うこと</span>
              入力内容を整理し、あなたが確かめる条件の一覧を作ります。まだ旅行も予約も作りません。
            </p>
            <Button type="submit" loading={busy} disabled={busy} aria-describedby={`${id}-next`} className="w-full sm:w-auto"
              data-testid="consult-extract">
              入力内容を整理する →
            </Button>
          </div>
        </form>
      </section>
      <aside aria-label="いま決まっていること" className="space-y-3">
        <div className="rounded-2xl border border-cloud-200 bg-surface p-4">
          <p className="text-xs font-semibold tracking-widest text-accent">YOUR TRIP BRIEF</p>
          <h3 className="mt-1 font-semibold text-ink-900">いま決まっていること</h3>
          <dl className="mt-3 divide-y divide-cloud-200">
            {summary.map((s) => (
              <div key={s.label} className="py-2">
                <dt className="text-xs text-ink-700">{s.label}</dt>
                <dd className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm text-ink-900 break-words" data-testid={`brief-summary-${s.label}`}>{s.value}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${s.state === '入力'
                    ? 'bg-success-soft text-success' : s.state === '要確認' ? 'bg-warning-soft text-warning' : 'bg-cloud-100 text-ink-700'}`}>
                    {s.state}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={openOptional} className="tc-focus-ring mt-2 min-h-11 text-sm font-medium text-accent underline">
            条件を指定する →
          </button>
        </div>
        <div className="rounded-2xl border border-cloud-200 bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink-900">入力したら、こう進みます</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-700">
            <li><b className="text-ink-900">条件を確認</b> · 読み取りを自分で直す</li>
            <li><b className="text-ink-900">方面を比較</b> · 地図で位置と照会の状態を見る</li>
            <li><b className="text-ink-900">選んで旅程案へ</b> · 選んだ方面だけを未確定の下書きに</li>
          </ol>
        </div>
        <p className="rounded-xl border border-cloud-200 bg-cloud-0 p-3 text-xs text-ink-700">
          ⓘ 宿の料金・空室、営業時間、道路の運転時間は、日付と照会の提供元がそろってから調べます。調べていない値は「未照会」と表示します。
        </p>
      </aside>
    </div>
  );
};

// ------------------------------------------------------------------ 2. 内容を確認

const ROW_LABEL: Record<ReviewKey, string> = {
  origin: '出発地', party_size: '人数', nights: '旅行の日数', transport: '移動手段', one_way: '片道の移動時間', room: '部屋',
  budget: '宿泊費の目安', dates: '日程', preferences: '過ごし方',
};

const ReviewStep: React.FC<{
  review: ReviewState; onChange: (r: ReviewState) => void; onBack: () => void; onNext: () => void; busy: boolean;
  error: string | null; aiConnected: boolean;
}> = ({ review, onChange, onBack, onNext, busy, error, aiConnected }) => {
  const id = useId();
  const v = review.values;
  const update = (key: ReviewKey, patch: Partial<ReviewState['values']>) =>
    onChange({ ...review, values: { ...v, ...patch }, confirmed: { ...review.confirmed, [key]: true } });
  const setStrength = (key: ReviewKey, s: ReviewState['strength'][ReviewKey]) =>
    onChange({ ...review, strength: { ...review.strength, [key]: s } });
  const confirm = (key: ReviewKey, on: boolean) => onChange({ ...review, confirmed: { ...review.confirmed, [key]: on } });
  const open = openQuestions(review);
  const missingNights = v.nights === null;

  const status = (key: ReviewKey) => {
    const src = review.sources[key];
    if (src === 'user_input') return <span className="rounded-full bg-cloud-100 px-2 py-0.5 text-[11px] text-ink-900">{SOURCE_LABEL.user_input}</span>;
    if (src === 'unspecified' && !review.confirmed[key]) return <span className="rounded-full bg-cloud-100 px-2 py-0.5 text-[11px] text-ink-700">{SOURCE_LABEL.unspecified}</span>;
    return (
      <label className="flex min-h-11 items-center gap-2 text-xs text-ink-900">
        <input type="checkbox" checked={review.confirmed[key]} onChange={(e) => confirm(key, e.target.checked)}
          data-testid={`review-confirm-${key}`} />
        {review.confirmed[key] ? SOURCE_LABEL.confirmed : `${SOURCE_LABEL.text} · 合っていれば印`}
      </label>
    );
  };
  const strengthSelect = (key: ReviewKey) => (
    <select aria-label={`${ROW_LABEL[key]}の扱い`} value={review.strength[key]}
      onChange={(e) => setStrength(key, e.target.value as ReviewState['strength'][ReviewKey])}
      className="tc-focus-ring min-h-11 rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-sm text-ink-900">
      {(['required', 'preferred', 'undecided'] as const).map((s) => <option key={s} value={s}>{STRENGTH_LABEL[s]}</option>)}
    </select>
  );
  const choice = (name: string, value: string, options: Array<[string, string]>, onPick: (v: string) => void) => (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1">
      {options.map(([val, label]) => (
        <button key={val} type="button" role="radio" aria-checked={value === val} onClick={() => onPick(val)}
          className={`tc-focus-ring min-h-11 rounded-lg border px-3 text-sm ${value === val
            ? 'border-accent bg-accent-soft font-semibold text-ink-900' : 'border-cloud-200 bg-cloud-0 text-ink-700'}`}>
          {value === val ? '● ' : '○ '}{label}
        </button>
      ))}
    </div>
  );

  const editor: Record<ReviewKey, React.ReactNode> = {
    origin: <input aria-label="出発地" value={v.origin} maxLength={100} className={field}
      onChange={(e) => update('origin', { origin: e.target.value })} />,
    party_size: <input aria-label="人数" type="number" min={1} max={30} value={v.party_size ?? ''} className={field}
      onChange={(e) => update('party_size', { party_size: e.target.value ? Number(e.target.value) : null })} />,
    nights: (
      <select aria-label="旅行の日数" value={v.nights ?? ''} className={field}
        onChange={(e) => update('nights', { nights: e.target.value === '' ? null : Number(e.target.value) })}>
        <option value="">選んでください</option>
        {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 0 ? '日帰り' : `${n}泊${n + 1}日`}</option>)}
      </select>
    ),
    transport: (
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="移動手段" value={v.transport} className={field}
          onChange={(e) => update('transport', { transport: e.target.value as ReviewState['values']['transport'] })}>
          <option value="undecided">未定</option><option value="car">自家用車</option><option value="public">公共交通</option>
        </select>
        {v.transport === 'car' && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-900">
            <input type="checkbox" checked={v.highway} onChange={(e) => update('transport', { highway: e.target.checked })} />高速道路
          </label>
        )}
      </div>
    ),
    one_way: v.one_way_hours ? (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-900">{`${v.one_way_hours}時間くらいまで`}</p>
        <p className="text-xs text-ink-700">疲れを避けたいという書き方でした。希望ですか、絶対条件ですか。</p>
        {choice('片道の時間の扱い', v.one_way_strength, [['preferred', '希望'], ['required', '絶対条件']], (val) =>
          onChange({ ...review, values: { ...v, one_way_strength: val as 'preferred' | 'required' },
            strength: { ...review.strength, one_way: val as 'preferred' | 'required' },
            confirmed: { ...review.confirmed, one_way: true } }))}
      </div>
    ) : <p className="text-sm text-ink-700">条件なし(文章に片道の時間がありません)</p>,
    room: (
      <select aria-label="部屋" value={v.room} className={field}
        onChange={(e) => update('room', { room: e.target.value as ReviewState['values']['room'] })}>
        <option value="undecided">未定</option><option value="same_room">全員で同じ部屋</option>
        <option value="multiple_rooms">複数の部屋でもよい</option>
      </select>
    ),
    budget: v.budget_min_man !== null ? (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-900">
          {v.budget_min_man === v.budget_max_man ? `${v.budget_min_man}万円` : `${v.budget_min_man}〜${v.budget_max_man}万円`}
        </p>
        <p className="text-xs text-ink-700">「全員の合計(1部屋・1泊)」か「1人あたり」かで、探す宿が変わります。</p>
        {choice('宿泊費の範囲', v.budget_scope, [['total', '全員の合計'], ['per_person', '1人あたり']], (val) =>
          onChange({ ...review, values: { ...v, budget_scope: val as 'total' | 'per_person' },
            confirmed: { ...review.confirmed, budget: true } }))}
      </div>
    ) : <p className="text-sm text-ink-700">未指定</p>,
    dates: (
      <div className="space-y-1">
        <p className="text-sm text-ink-900">{v.travel_window ? `${v.travel_window} · 日付は未確定` : '未定'}</p>
        <p className="text-xs text-ink-700">宿の空室・料金と営業日は、日付が決まってから照会します。比べるのは日付が無くても続けられます。</p>
      </div>
    ),
    preferences: (
      <div className="flex flex-wrap gap-1">
        {Object.entries(PREFERENCE_LABEL).map(([k, label]) => {
          const on = v.preferences.includes(k);
          return (
            <button key={k} type="button" aria-pressed={on}
              onClick={() => update('preferences', { preferences: on ? v.preferences.filter((x) => x !== k) : [...v.preferences, k] })}
              className={`tc-focus-ring min-h-11 rounded-full border px-3 text-xs ${on ? 'border-accent bg-accent-soft text-ink-900'
                : 'border-cloud-200 bg-cloud-0 text-ink-700'}`}>
              {on ? '✓ ' : ''}{label}
            </button>
          );
        })}
      </div>
    ),
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-cloud-200 bg-surface p-4 sm:p-5">
        <div className="mb-4 rounded-xl bg-cloud-100 p-3">
          <h2 id={`${id}-h`} className="font-semibold text-ink-900">希望を条件に整理しました</h2>
          <p className="text-xs text-ink-700">
            {aiConnected ? 'AI の読み取りです。' : '文章の書き方から決まった規則で拾った候補です(AI の読み取りは未接続)。'}
            「文章から読み取り · 未確認」の行は、印を付けるか値を直すまで条件に使いません。
          </p>
        </div>
        {review.personal && (
          <p className="mb-3 rounded-lg border border-cloud-200 p-3 text-xs text-ink-700" data-testid="review-personal">
            <UiIcon icon={IcLock} size={14} className="mr-1 align-[-3px]" />文章に個人的な旅の理由がありました。確認のためだけに示し、旅行・共有の予定には書きません。
          </p>
        )}
        <div role="table" aria-label="読み取った条件" className="overflow-hidden rounded-xl border border-cloud-200">
          <div role="row" className="hidden grid-cols-[7rem_minmax(0,1fr)_7rem_12rem] gap-2 bg-cloud-100 px-3 py-2 text-xs font-semibold text-ink-700 md:grid">
            <span role="columnheader">旅行の条件</span><span role="columnheader">読み取った内容</span>
            <span role="columnheader">扱い</span><span role="columnheader">確認</span>
          </div>
          {REVIEW_KEYS.map((key) => {
            const pending = (key === 'one_way' && open.includes('one_way')) || (key === 'budget' && open.includes('budget'))
              || (key === 'nights' && missingNights);
            return (
              <div role="row" key={key} data-testid={`review-row-${key}`}
                className={`grid gap-2 border-t border-cloud-200 px-3 py-3 md:grid-cols-[7rem_minmax(0,1fr)_7rem_12rem] ${pending ? 'bg-warning-soft' : ''}`}>
                <span role="rowheader" className="text-sm font-semibold text-ink-900">
                  {ROW_LABEL[key]}{pending && <span className="block text-[11px] font-normal text-warning">要回答</span>}
                </span>
                <span role="cell" className="min-w-0">
                  {editor[key]}
                  {review.evidence[key] && review.sources[key] === 'text' && (
                    <span className="mt-1 block text-[11px] text-ink-700 break-words">{`文章の該当: 「${review.evidence[key]}」`}</span>
                  )}
                </span>
                <span role="cell">{strengthSelect(key)}</span>
                <span role="cell">{status(key)}</span>
              </div>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
        {(open.length > 0 || missingNights) && (
          <p role="status" className="mt-3 text-sm text-warning">
            {missingNights ? '旅行の日数を選んでください。' : ''}
            {open.includes('one_way') ? '片道の時間が「希望」か「絶対条件」かを選んでください。' : ''}
            {open.includes('budget') ? '宿泊費が「全員の合計」か「1人あたり」かを選んでください。' : ''}
          </p>
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={onBack}>← 入力へ戻る</Button>
          <div className="flex flex-col gap-1 sm:items-end">
            <span className="text-xs text-ink-700" id={`${id}-next`}>書いた方面の位置を照会して並べます。旅行・予約はまだ作りません。</span>
            <Button type="button" onClick={onNext} loading={busy} disabled={busy || missingNights} aria-describedby={`${id}-next`}
              data-testid="consult-compare">
              この条件で方面を比較する →
            </Button>
          </div>
        </div>
      </section>
      <aside className="space-y-3 text-sm">
        <div className="rounded-2xl border border-cloud-200 bg-surface p-4">
          <h3 className="font-semibold text-ink-900">比較で見るポイント</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-700">
            <li>出発地からの位置と直線距離(計算値)</li>
            <li>運転時間・高速料金(道路の提供元が未接続 · 未照会)</li>
            <li>何人で1部屋の宿と料金(宿の提供元が未接続 · 未照会)</li>
            <li>静かに過ごせるか(混み具合のデータ未接続 · 未確認)</li>
          </ul>
        </div>
      </aside>
    </div>
  );
};

// ------------------------------------------------------------------ 画面の全体

const TripConsultPage: React.FC = () => {
  const navigate = useNavigate();
  const [state, setState] = useState<ConsultState>(() => loadState());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { saveState(state); }, [state]);
  const go = useCallback((step: ConsultStep) => {
    setError(null);
    setState((s) => ({ ...s, step }));
    window.scrollTo?.({ top: 0 });
    requestAnimationFrame?.(() => headingRef.current?.focus());
  }, []);

  const extract = async () => {
    if (!state.brief.text.trim() && !state.brief.origin.trim()) {
      setError('希望の文章か、出発地を入力してください');
      return;
    }
    setBusy('extract');
    setError(null);
    try {
      const ex = await extractIntent(extractInputOf(state.brief));
      setState((s) => ({ ...s, extraction: ex, review: initReview(ex), areaNames: ex.areas.map((a) => a.name),
        areas: null, step: 'review' }));
      requestAnimationFrame?.(() => headingRef.current?.focus());
    } catch {
      setError('入力内容を整理できませんでした。文章は消えていません。時間をおいてもう一度お試しください');
    } finally {
      setBusy(null);
    }
  };

  const compare = async (names?: string[]) => {
    const review = state.review;
    if (!review) return;
    const list = (names ?? state.areaNames).slice(0, 10);
    setState((s) => ({ ...s, step: 'areas', areaNames: list }));
    if (list.length === 0) {
      setState((s) => ({ ...s, areas: null }));
      return;
    }
    setBusy('areas');
    setError(null);
    try {
      const r = await compareAreas({ origin: review.values.origin, areas: list,
        one_way_hours: review.confirmed.one_way ? review.values.one_way_hours : null,
        one_way_strength: review.confirmed.one_way ? review.values.one_way_strength : null });
      setState((s) => ({ ...s, areas: r, selectedArea: s.selectedArea && list.includes(s.selectedArea) ? s.selectedArea : list[0] ?? null }));
    } catch {
      setError('方面の位置を照会できませんでした。条件はそのままです。もう一度お試しください');
    } finally {
      setBusy(null);
    }
  };

  const createDraft = async () => {
    const input = draftInputOf(state);
    if (!input) return;
    setBusy('draft');
    setError(null);
    try {
      const r = await createTripDraft(input);
      clearState();
      navigate(`/planner/${encodeURIComponent(r.plan_id)}/draft`);
    } catch {
      setError('旅程案を作れませんでした。選んだ内容はこの画面に残っています。もう一度お試しください');
      setBusy(null);
    }
  };

  const reset = () => {
    clearState();
    setState(INITIAL_STATE);
    setError(null);
  };

  const step = state.step;
  const titles: Record<ConsultStep, [string, string]> = {
    brief: ['行き先が決まっていなくても、相談から始められます', 'まずは決まっている条件を教えてください。入力後に条件を確認し、それから方面の候補を比べます。'],
    review: ['読み取った内容を確認してください', '方面を比べる前の確認です。違う所は直接直し、「必須」「希望」「未定」を選べます。'],
    areas: ['候補の方面を、同じ条件で比べます', '地図で位置関係を確かめ、気になる方面を選ぶと詳しく見られます。選んだだけでは旅程にしません。'],
    detail: [`${state.selectedArea ?? '方面'}で、旅程案の材料を集める`, '行きたい場所を選び、参考の出典を足してから、未確定の下書きを作ります。'],
  };
  const stepNo = STEPS.findIndex((s) => s.id === step) + 1;

  const reviewReady = useMemo(() => Boolean(state.review), [state.review]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6" data-testid="trip-consult">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-accent">{`TRIP DESIGN · 0${stepNo} / 04`}</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-bold text-ink-900 outline-none">{titles[step][0]}</h1>
          <p className="mt-1 text-sm text-ink-700">{titles[step][1]}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/planner" className="tc-focus-ring inline-flex min-h-11 items-center rounded-lg border border-cloud-200 bg-cloud-0 px-3 text-sm text-ink-900">
            行き先が決まっている方(旅行を作る)
          </Link>
          {step !== 'brief' && (
            <button type="button" onClick={reset} className="tc-focus-ring min-h-11 rounded-lg px-3 text-sm text-ink-700 underline">
              最初からやり直す
            </button>
          )}
        </div>
      </div>
      <Stepper step={step} />
      {/* [FR059-B] 自分のクラスと今月の旅程相談の枠(旅行ごとの枠は下書き・旅程で出す) */}
      <PlanningClassSummary className="mt-2" />
      {step === 'brief' && (
        <BriefStep brief={state.brief} onChange={(b) => setState((s) => ({ ...s, brief: b }))} onSubmit={() => void extract()}
          busy={busy === 'extract'} error={error} />
      )}
      {step === 'review' && reviewReady && state.review && (
        <ReviewStep review={state.review} onChange={(r) => setState((s) => ({ ...s, review: r }))} onBack={() => go('brief')}
          onNext={() => void compare()} busy={busy === 'areas'} error={error}
          aiConnected={Boolean(state.extraction?.ai_connected)} />
      )}
      {step === 'areas' && state.review && (
        <AreasStep state={state} busy={busy === 'areas'} error={error}
          onEdit={() => go('review')} onRetry={() => void compare()}
          onAddArea={(name) => void compare([...state.areaNames.filter((n) => n !== name), name])}
          onRemoveArea={(name) => setState((s) => ({ ...s, areaNames: s.areaNames.filter((n) => n !== name),
            areas: s.areas ? { ...s.areas, areas: s.areas.areas.filter((a) => a.name !== name) } : null,
            selectedArea: s.selectedArea === name ? null : s.selectedArea }))}
          onSelect={(name) => setState((s) => ({ ...s, selectedArea: name }))}
          onToggleSave={(name) => setState((s) => ({ ...s, savedAreas: s.savedAreas.includes(name)
            ? s.savedAreas.filter((n) => n !== name) : [...s.savedAreas, name] }))}
          onOpen={(name) => { setState((s) => ({ ...s, selectedArea: name })); go('detail'); }} />
      )}
      {step === 'detail' && state.review && (
        <AreaDetailStep state={state} busy={busy === 'draft'} error={error} onBack={() => go('areas')}
          onPick={(r, on) => setState((s) => {
            const picked = { ...s.picked };
            if (on) picked[r.id] = r; else delete picked[r.id];
            return { ...s, picked };
          })}
          onUrls={(urls) => setState((s) => ({ ...s, urls }))}
          onCreate={() => void createDraft()} />
      )}
    </div>
  );
};

export default TripConsultPage;
