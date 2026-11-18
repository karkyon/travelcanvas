/**
 * SpotAreasPage - 自由に歩くエリアの準備(SC-50。DOC-02 v6.0 FR-060)。
 *
 * - 候補箱で近く(400m)にまとまっている候補を「エリアの案」として出し、まとめてエリアにする
 * - エリアの名前・日・時間枠・集合(場所は候補の位置から選ぶ・時刻)・近づいたら勧めるか
 * - 候補ごとに 行きたい / 気分で・ジャンル・滞在の目安・並び(上へ・下へのボタン。ドラッグに頼らない)
 * - 「行きたい」だけで回った時の目安の時間(直線の歩き + 滞在)
 * 作る・直すは編集者以上(閲覧者は見るだけ)。直す時は If-Match(ほかの人が先に直したら読み直す)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Map as MapIcon, Plus, Sparkles, Trash2 } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { api, extractApiErrorDetailMessage, getCandidates } from '@/services/api';
import type { NormalizedDay, PlanCandidateItem } from '@/services/api';
import {
  createSpotArea, deleteSpotArea, listSpotAreas, suggestSpotAreas, updateSpotArea,
} from '@/services/api/spotAreas';
import type { SpotArea, SpotAreaInput, SpotGenre, SpotPriority, SpotSuggestion } from '@/services/api/types/spotAreas';
import { GENRE_META, GENRE_ORDER, minutesOf, wantMinutes, type LatLng } from './spot/spotModel';

interface FormItem { candidate_id: string; title: string; genre: SpotGenre; priority: SpotPriority; stay_minutes: number;
  point: LatLng | null; }
interface Form {
  id: string | null; revision: number; title: string; day_id: string; start_time: string; end_time: string;
  meet_label: string; meet_time: string; meet_from: string; suggest_on_approach: boolean; items: FormItem[];
}

const STAYS = [10, 15, 20, 30, 45, 60, 90];
const inputClass = 'w-full border rounded-lg px-3 py-2 min-h-[44px]';

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  const message = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as { message?: unknown }).message : null;
  return extractApiErrorDetailMessage(detail) ?? (typeof message === 'string' && message ? message : fallback);
}

const pointOfCand = (c?: PlanCandidateItem): LatLng | null =>
  c && c.latitude != null && c.longitude != null ? [c.latitude, c.longitude] : null;

const SpotAreasPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [areas, setAreas] = useState<SpotArea[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [cands, setCands] = useState<PlanCandidateItem[]>([]);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [suggestions, setSuggestions] = useState<SpotSuggestion[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, cl, detail] = await Promise.all([listSpotAreas(planId), getCandidates(planId),
        api.getPlanDetail(planId).catch(() => null)]);
      setAreas(list.areas);
      setCanEdit(list.can_edit);
      setCands(cl.items.filter((c) => c.status !== 'dismissed' && !c.merged_into_id));
      setDays(detail?.data?.days ?? []);
      setSuggestions(list.can_edit ? await suggestSpotAreas(planId).catch(() => []) : []);
    } catch (e) {
      setError(errorMessage(e, 'エリアを読めませんでした'));
    } finally {
      setLoading(false);
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(cands.map((c) => [c.id, c])), [cands]);
  const toItem = (id: string, extra: Partial<FormItem> = {}): FormItem => {
    const c = byId.get(id);
    return { candidate_id: id, title: c?.title ?? '(候補)', genre: 'other', priority: 'maybe', stay_minutes: 20,
      point: pointOfCand(c), ...extra };
  };

  const blank = (init: Partial<Form> = {}): Form => ({ id: null, revision: 0, title: '', day_id: days[0]?.id ?? '', start_time: '',
    end_time: '', meet_label: '', meet_time: '', meet_from: '', suggest_on_approach: true, items: [], ...init });

  const fromSuggestion = (s: SpotSuggestion) => setForm(blank({
    title: s.title, items: s.candidates.map((c) => toItem(c.candidate_id, { genre: c.genre, title: c.title })),
  }));

  const fromArea = (a: SpotArea) => setForm({
    id: a.id, revision: a.revision, title: a.title, day_id: a.day_id ?? '', start_time: a.start_time ?? '', end_time: a.end_time ?? '',
    meet_label: a.meet_label ?? '', meet_time: a.meet_time ?? '',
    meet_from: a.meet_latitude != null ? (cands.find((c) => c.latitude === a.meet_latitude && c.longitude === a.meet_longitude)?.id ?? 'keep') : '',
    suggest_on_approach: a.suggest_on_approach,
    items: a.items.map((i) => ({ candidate_id: i.candidate_id, title: i.title, genre: i.genre, priority: i.priority,
      stay_minutes: i.stay_minutes, point: i.latitude != null && i.longitude != null ? [i.latitude, i.longitude] : null })),
  });

  const setItem = (k: number, patch: Partial<FormItem>) => form && setForm({ ...form, items: form.items.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
  const move = (k: number, d: -1 | 1) => {
    if (!form) return;
    const items = [...form.items];
    const t = k + d;
    if (t < 0 || t >= items.length) return;
    [items[k], items[t]] = [items[t]!, items[k]!];
    setForm({ ...form, items });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.title.trim()) return setError('エリアの名前を入れてください');
    const s = minutesOf(form.start_time);
    const en = minutesOf(form.end_time);
    if (s != null && en != null && en <= s) return setError('終わりは始まりより後にしてください');
    const area = form.id ? areas.find((a) => a.id === form.id) : null;
    const meetPoint = form.meet_from === 'keep' && area ? [area.meet_latitude, area.meet_longitude]
      : pointOfCand(byId.get(form.meet_from)) ?? [null, null];
    const input: SpotAreaInput = {
      title: form.title.trim(), day_id: form.day_id || null, start_time: form.start_time || null, end_time: form.end_time || null,
      meet_label: form.meet_label.trim() || null, meet_time: form.meet_time || null,
      meet_latitude: meetPoint[0] ?? null, meet_longitude: meetPoint[1] ?? null, suggest_on_approach: form.suggest_on_approach,
      items: form.items.map((i) => ({ candidate_id: i.candidate_id, genre: i.genre, priority: i.priority, stay_minutes: i.stay_minutes })),
    };
    setSaving(true);
    setError(null);
    try {
      const saved = form.id ? await updateSpotArea(planId, form.id, input, form.revision) : await createSpotArea(planId, input);
      setForm(null);
      setNotice(`「${saved.title}」を保存しました`);
      await load();
    } catch (err) {
      setError(errorMessage(err, '保存できませんでした'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: SpotArea) => {
    if (!window.confirm(`エリア「${a.title}」を消しますか?(候補箱の候補は残ります)`)) return;
    try {
      await deleteSpotArea(planId, a.id, a.revision);
      setNotice(`「${a.title}」を消しました`);
      await load();
    } catch (e) {
      setError(errorMessage(e, '消せませんでした'));
    }
  };

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;
  const free = form ? cands.filter((c) => !form.items.some((i) => i.candidate_id === c.id)) : [];
  const dayLabel = (id: string | null) => days.find((d) => d.id === id)?.local_date ?? '日を決めていない';

  return (
    <div className="tc-page tc-page--lg">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
        <h1 className="tc-page-title" data-eyebrow="SPOT · 自由に歩くエリア">自由に歩くエリア</h1>
        <p className="text-sm text-ink-700 mt-1">
          順番を決めずに歩く範囲です。当日は「スポットモード」で、地図を見ながらその時の天気・体調・気分で行き先を選べます。
        </p>
      </div>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {notice && <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{notice}</div>}

      {!form && canEdit && suggestions.map((s) => (
        <div key={s.title + s.center_latitude} className="mb-4 p-4 rounded-lg bg-[var(--tc-accent-soft)] text-[var(--tc-accent-strong)] text-sm flex flex-wrap items-center gap-3">
          <Sparkles size={18} aria-hidden="true" />
          <span className="flex-1 min-w-[200px]">候補箱の {s.candidates.length} 件が「{s.title}」(半径 {s.radius_m}m)にまとまっています。</span>
          <Button variant="primary" size="sm" onClick={() => fromSuggestion(s)}>まとめてエリアにする</Button>
        </div>
      ))}

      {!form && (
        <div className="space-y-3">
          {areas.length === 0 && <p className="text-sm text-ink-700">まだエリアはありません。{canEdit ? '候補箱の候補からエリアを作れます。' : ''}</p>}
          {areas.map((a) => (
            <Card key={a.id} padding="md">
              <section aria-labelledby={`area-${a.id}`} className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[220px]">
                  <h2 id={`area-${a.id}`} className="font-semibold text-ink-900">{a.title}</h2>
                  <p className="text-xs text-ink-700 mt-1">
                    {dayLabel(a.day_id)}{a.start_time ? ` ${a.start_time}〜${a.end_time ?? ''}` : ''} ・ 候補 {a.items.length}件
                    {a.meet_label ? ` ・ 集合 ${a.meet_label}${a.meet_time ? ` ${a.meet_time}` : ''}` : ''}
                  </p>
                  <p className="text-xs text-ink-700 mt-1">{a.items.map((i) => i.title).join('・')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/planner/${planId}/spot/${a.id}`} className="tc-mbtn tc-focus-ring inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg bg-[var(--tc-accent)] text-white font-semibold">
                    <MapIcon size={16} aria-hidden="true" />スポットモードで開く
                  </Link>
                  {canEdit && <Button variant="outline" size="sm" onClick={() => fromArea(a)}>直す</Button>}
                  {canEdit && <Button variant="ghost" size="sm" onClick={() => void remove(a)} aria-label={`${a.title}を消す`}><Trash2 size={16} /></Button>}
                </div>
              </section>
            </Card>
          ))}
          {canEdit && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm(blank())}>エリアを作る</Button>}
        </div>
      )}

      {form && (
        <form onSubmit={save} noValidate className="space-y-4" aria-label="エリアの設定">
          <Card padding="md">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="sa-title" className="block text-sm font-medium mb-1">エリアの名前</label>
                <input id="sa-title" className={inputClass} maxLength={100} value={form.title} placeholder="例: おかげ横丁・おはらい町"
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <label htmlFor="sa-day" className="block text-sm font-medium mb-1">日</label>
                <select id="sa-day" className={inputClass} value={form.day_id} onChange={(e) => setForm({ ...form, day_id: e.target.value })}>
                  <option value="">決めない</option>
                  {days.map((d) => <option key={d.id} value={d.id}>{d.local_date}{d.title ? ` ${d.title}` : ''}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="sa-start" className="block text-sm font-medium mb-1">始まり</label>
                  <input id="sa-start" type="time" className={inputClass} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div className="flex-1">
                  <label htmlFor="sa-end" className="block text-sm font-medium mb-1">終わり</label>
                  <input id="sa-end" type="time" className={inputClass} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
              </div>
              <div>
                <label htmlFor="sa-meet" className="block text-sm font-medium mb-1">集合の場所(戻る場所)</label>
                <input id="sa-meet" className={inputClass} maxLength={100} value={form.meet_label} placeholder="例: 駐車場"
                  onChange={(e) => setForm({ ...form, meet_label: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="sa-meet-time" className="block text-sm font-medium mb-1">集合の時刻</label>
                  <input id="sa-meet-time" type="time" className={inputClass} value={form.meet_time} onChange={(e) => setForm({ ...form, meet_time: e.target.value })} />
                </div>
                <div className="flex-1">
                  <label htmlFor="sa-meet-from" className="block text-sm font-medium mb-1">集合の位置</label>
                  <select id="sa-meet-from" className={inputClass} value={form.meet_from} onChange={(e) => setForm({ ...form, meet_from: e.target.value })}>
                    <option value="">地図に出さない</option>
                    {form.meet_from === 'keep' && <option value="keep">今の位置のまま</option>}
                    {cands.filter((c) => pointOfCand(c)).map((c) => <option key={c.id} value={c.id}>{c.title} の位置</option>)}
                  </select>
                </div>
              </div>
              <label className="sm:col-span-2 flex items-center gap-3 min-h-[44px] text-sm">
                <input type="checkbox" className="w-6 h-6" checked={form.suggest_on_approach}
                  onChange={(e) => setForm({ ...form, suggest_on_approach: e.target.checked })} />
                近づいたら・時間になったら、予定の画面でスポットモードを勧める(位置は端末の中だけで判定します)
              </label>
            </div>
          </Card>

          <Card padding="md">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-ink-900">候補 {form.items.length}件</h2>
              <p className="text-xs text-ink-700">「行きたい」だけなら 約 {wantMinutes(form.items)}分(歩き込み・直線の目安)</p>
            </div>
            <ol className="mt-3 space-y-2" aria-label="エリアの候補">
              {form.items.map((it, k) => (
                <li key={it.candidate_id} className="flex flex-wrap items-center gap-2 p-2 rounded-lg border bg-white">
                  <span className="w-8 h-8 rounded-full text-white font-bold text-sm grid place-items-center shrink-0"
                    style={{ background: GENRE_META[it.genre].color }} aria-hidden="true">{k + 1}</span>
                  <span className="flex-1 min-w-[140px] font-medium">{it.title}{!it.point && <span className="text-xs text-ink-700">(位置なし。地図に出ません)</span>}</span>
                  <div role="group" aria-label={`${it.title}の優先`} className="inline-flex rounded-full bg-[var(--tc-sand-100)] p-1">
                    {(['want', 'maybe'] as const).map((p) => (
                      <button key={p} type="button" aria-pressed={it.priority === p} onClick={() => setItem(k, { priority: p })}
                        className={`min-h-[40px] px-3 rounded-full text-sm font-semibold ${it.priority === p ? 'bg-white text-[var(--tc-accent-strong)] shadow' : 'text-ink-700'}`}>
                        {p === 'want' ? '行きたい' : '気分で'}
                      </button>
                    ))}
                  </div>
                  <label className="sr-only" htmlFor={`sa-g-${k}`}>{it.title}のジャンル</label>
                  <select id={`sa-g-${k}`} className="border rounded-lg px-2 min-h-[44px]" value={it.genre} onChange={(e) => setItem(k, { genre: e.target.value as SpotGenre })}>
                    {GENRE_ORDER.map((g) => <option key={g} value={g}>{GENRE_META[g].label}</option>)}
                  </select>
                  <label className="sr-only" htmlFor={`sa-s-${k}`}>{it.title}の滞在の目安</label>
                  <select id={`sa-s-${k}`} className="border rounded-lg px-2 min-h-[44px]" value={it.stay_minutes} onChange={(e) => setItem(k, { stay_minutes: Number(e.target.value) })}>
                    {(STAYS.includes(it.stay_minutes) ? STAYS : [...STAYS, it.stay_minutes].sort((a, b) => a - b)).map((m) => <option key={m} value={m}>{m}分</option>)}
                  </select>
                  <Button type="button" variant="ghost" size="sm" onClick={() => move(k, -1)} disabled={k === 0} aria-label={`${it.title}を上へ`}><ArrowUp size={16} /></Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => move(k, 1)} disabled={k === form.items.length - 1} aria-label={`${it.title}を下へ`}><ArrowDown size={16} /></Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== k) })} aria-label={`${it.title}をエリアから外す`}><Trash2 size={16} /></Button>
                </li>
              ))}
            </ol>
            {free.length > 0 && (
              <div className="mt-3">
                <label htmlFor="sa-add" className="block text-sm font-medium mb-1">候補箱から足す</label>
                <select id="sa-add" className={inputClass} value="" onChange={(e) => e.target.value && setForm({ ...form, items: [...form.items, toItem(e.target.value)] })}>
                  <option value="">選んでください</option>
                  {free.map((c) => <option key={c.id} value={c.id}>{c.title}{pointOfCand(c) ? '' : '(位置なし)'}</option>)}
                </select>
              </div>
            )}
            {cands.length === 0 && (
              <p className="text-sm text-ink-700 mt-2">候補箱に候補がありません。<Link to={`/planner/${planId}/candidates`}>候補箱</Link>で行きたい場所を足してください。</p>
            )}
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" type="submit" loading={saving}>保存</Button>
            <Button variant="ghost" type="button" onClick={() => setForm(null)}>やめる</Button>
          </div>
        </form>
      )}
    </div>
  );
};

export default SpotAreasPage;
