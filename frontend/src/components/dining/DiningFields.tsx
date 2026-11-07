/**
 * [Gate SpotInfo] 食事の場所の情報の入力(行きたい場所・旅程のスポットの編集で、種類が食事の時に出す)。
 * よく使う項目(ジャンル・名物・予算・予約・駐車場)を上に、細かい項目は「もっと詳しく」の中に置く。全て任意。
 */
import React, { useId } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import {
  BUDGETS, FEATURES, GENRES, MAX_GENRES, MOODS, PARKING, PAYMENT, RESERVATION, SMOKING, type DiningInfo,
} from './diningModel';

interface Props {
  value: DiningInfo | null;
  onChange: (v: DiningInfo) => void;
}

const field = 'tc-focus-ring mt-1 block w-full min-h-10 rounded-lg border border-cloud-200 bg-cloud-0 px-3 text-sm text-ink-900';
const labelCls = 'block text-sm font-medium text-ink-700';

const Chips: React.FC<{ legend: string; options: Array<[string, string]>; selected: string[]; max?: number;
  onToggle: (k: string) => void; name: string }> = ({ legend, options, selected, max, onToggle, name }) => (
  <fieldset className="tc-dining-chips">
    <legend className={labelCls}>{legend}{max ? `(${max} つまで)` : ''}</legend>
    <div className="mt-1 flex flex-wrap gap-1.5">
      {options.map(([k, l]) => {
        const on = selected.includes(k);
        const full = !!max && !on && selected.length >= max;
        return (
          <button key={k} type="button" aria-pressed={on} disabled={full} className="tc-focus-ring tc-chip-toggle"
            data-testid={`${name}-${k}`} onClick={() => onToggle(k)}>{l}</button>
        );
      })}
    </div>
  </fieldset>
);

const DiningFields: React.FC<Props> = ({ value, onChange }) => {
  const id = useId();
  const d = value ?? {};
  const set = (patch: Partial<DiningInfo>) => onChange({ ...d, ...patch });
  const toggle = (key: 'genres' | 'features' | 'moods' | 'payment', k: string, max?: number) => {
    const list = (d[key] as string[] | undefined) ?? [];
    const next = list.includes(k) ? list.filter((x) => x !== k) : (max && list.length >= max ? list : [...list, k]);
    set({ [key]: next } as Partial<DiningInfo>);
  };
  const select = <T extends string>(v: string) => (v ? (v as T) : null);
  return (
    <section className="tc-dining-fields space-y-3" aria-labelledby={`${id}-h`} data-testid="dining-fields">
      <h3 id={`${id}-h`} className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
        <UtensilsCrossed size={15} aria-hidden="true" />食事の情報(任意)
      </h3>
      <Chips legend="ジャンル" name="dining-genre" options={GENRES} selected={d.genres ?? []} max={MAX_GENRES}
        onToggle={(k) => toggle('genres', k, MAX_GENRES)} />
      <label className={labelCls}>名物・おすすめの料理
        <input className={field} maxLength={200} value={d.signature ?? ''} placeholder="例: 地魚の海鮮丼、焼きカレー"
          onChange={(e) => set({ signature: e.target.value })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>予算(昼・1 人)
          <select className={field} value={d.budget_lunch ?? ''} onChange={(e) => set({ budget_lunch: e.target.value || null })}>
            <option value="">未入力</option>{BUDGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={labelCls}>予算(夜・1 人)
          <select className={field} value={d.budget_dinner ?? ''} onChange={(e) => set({ budget_dinner: e.target.value || null })}>
            <option value="">未入力</option>{BUDGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={labelCls}>予約
          <select className={field} value={d.reservation ?? ''} onChange={(e) => set({ reservation: select<NonNullable<DiningInfo['reservation']>>(e.target.value) })}>
            <option value="">未入力</option>{Object.entries(RESERVATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={labelCls}>駐車場
          <select className={field} value={d.parking ?? ''} onChange={(e) => set({ parking: select<NonNullable<DiningInfo['parking']>>(e.target.value) })}>
            <option value="">未入力</option>{Object.entries(PARKING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      {d.parking && d.parking !== 'none' && (
        <label className={labelCls}>駐車場のメモ
          <input className={field} maxLength={100} value={d.parking_note ?? ''} placeholder="例: 店の裏に 5 台・提携あり"
            onChange={(e) => set({ parking_note: e.target.value })} />
        </label>
      )}
      <details className="tc-dining-more">
        <summary className="tc-focus-ring cursor-pointer text-sm font-semibold text-accent">もっと詳しく(営業時間・支払い・席・雰囲気など)</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>営業時間
              <input className={field} maxLength={300} value={d.hours ?? ''} placeholder="例: 11:00〜15:00 / 17:00〜22:00"
                onChange={(e) => set({ hours: e.target.value })} />
            </label>
            <label className={labelCls}>定休日
              <input className={field} maxLength={100} value={d.closed ?? ''} placeholder="例: 水曜"
                onChange={(e) => set({ closed: e.target.value })} />
            </label>
            <label className={labelCls}>席の数
              <input type="number" min={1} max={5000} inputMode="numeric" className={field} value={d.seats ?? ''}
                onChange={(e) => set({ seats: e.target.value ? Math.max(1, Math.min(5000, Number(e.target.value))) : null })} />
            </label>
            <label className={labelCls}>たばこ
              <select className={field} value={d.smoking ?? ''} onChange={(e) => set({ smoking: select<NonNullable<DiningInfo['smoking']>>(e.target.value) })}>
                <option value="">未入力</option>{Object.entries(SMOKING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input type="checkbox" checked={!!d.private_room} onChange={(e) => set({ private_room: e.target.checked || null })} />個室がある
          </label>
          <Chips legend="支払い" name="dining-pay" options={PAYMENT} selected={d.payment ?? []} onToggle={(k) => toggle('payment', k)} />
          <Chips legend="特徴" name="dining-feature" options={FEATURES} selected={d.features ?? []} onToggle={(k) => toggle('features', k)} />
          <Chips legend="こんな時に" name="dining-mood" options={MOODS} selected={d.moods ?? []} onToggle={(k) => toggle('moods', k)} />
          <label className={labelCls}>最寄り駅・行き方
            <input className={field} maxLength={200} value={d.access ?? ''} placeholder="例: 門司港駅から徒歩 5 分"
              onChange={(e) => set({ access: e.target.value })} />
          </label>
          <label className={labelCls}>混み具合・待ち時間の目安
            <input className={field} maxLength={100} value={d.wait_note ?? ''} placeholder="例: 土日の昼は 30 分ほど並ぶ"
              onChange={(e) => set({ wait_note: e.target.value })} />
          </label>
        </div>
      </details>
    </section>
  );
};

export default DiningFields;
