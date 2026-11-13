/**
 * [Gate TDay-Mock] 困った時・準備の画面: 寄り道(Mobile-Detour / DetourAdd)・雨の兆し(Mobile-Rain)・遅れの知らせ(Mobile-Delay)・
 * チケット・予約(Mobile-Ticket)・出発前のチェック(Mobile-Prepare)・写真を集める(Mobile-PhotoQR)・同行者(Mobile-Crew)・
 * お助け(Mobile-Help)・当日の設定(Mobile-Settings)。
 *
 * 既にある仕組みにつなぐ: 寄り道の検索と追加 / 控えの案(プランB)への切り替え / 外部状況(アラート)と再計画(案A・B)/
 * 予約とチケット(QR は端末の中で作る)/ 持ち物 / 写真の投稿リンク / 到着予定の共有。
 */
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CloudRain, QrCode, Phone, Wallet, Languages, Home, Users, ChevronRight, Check,
} from 'lucide-react';
import LocalQrCode from '@/components/share/LocalQrCode';
import TicketCode from '@/components/share/TicketCode';
import {
  applyReplan, createAlert, createPackingItem, createReplan, getAlerts, getPackingItems, getReplan, getReservation,
  getTickets, revealTicket, updatePackingItem,
} from '@/services/api';
import type { PackingItem, PlanAlert, Replan, Reservation, AlertKind, DetectedRouteIssue } from '@/services/api';
import { createUploadLink } from '@/services/api/photoFeatures';
import type { UploadLink } from '@/services/api/photoFeatures';
import {
  addDetourEvent, deleteEta, findDetours, type DetourCandidate, type DetourKind, type EtaShare,
} from '@/services/api/travelDay';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl, safeTelHref } from '@/utils/safeNavigation';
import { formatTimeInZone } from '../todayModel';
import { useSwitchOptions } from '../useSwitchOptions';
import TodaySwitchPanel from '../TodaySwitchPanel';
import {
  distanceKm, etaMessage, planDetour, rainTitle, rainWindow, speak, walkMinutes,
} from './todayLive';
import { Face, Pill, RainBars } from './TodayDash';
import { shareMyEta, type useCrew, ticketTabs } from './todayHelpers';
import { LiveSwitch } from './LivePieces';
import PushPanel from './PushPanel';
import TodayCardButton from './TodayCardButton';
import ScreenFrame from './ScreenFrame';
import { Thumb } from './ScreensBook';
import type { TodayCtx } from './todayCtx';

const TodayMap = React.lazy(() => import('./TodayMap'));
const hm = (iso: string | null | undefined, tz: string | null) => formatTimeInZone(iso ?? null, tz);

// ---- 寄り道 ------------------------------------------------------------------------------------------------------------

const KINDS: [DetourKind, string][] = [['all', 'すべて'], ['indoor', '屋内だけ'], ['sweets', '甘いもの'], ['surprise', '意外な一軒'], ['cafe', 'カフェ']];
const STAYS = [20, 30, 45];

export const DetourScreen: React.FC<{ ctx: TodayCtx; arg: string | null }> = ({ ctx, arg }) => {
  const gap = ctx.gap;
  const [kind, setKind] = useState<DetourKind>('all');
  const [items, setItems] = useState<DetourCandidate[] | null>(ctx.detourPins.length ? ctx.detourPins : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const initialPick = arg?.startsWith('pick:') ? Number(arg.slice(5)) : null;
  const [picked, setPicked] = useState<number | null>(initialPick != null && ctx.detourPins[initialPick] ? initialPick : null);
  const [stay, setStay] = useState(30);
  const search = useCallback(async (k: DetourKind) => {
    if (!gap) return;
    setKind(k);
    setBusy(true);
    setMsg(null);
    try {
      const r = await findDetours(ctx.planId, { after_event_id: gap.after_event_id, before_event_id: gap.before_event_id, kind: k });
      setItems(r.candidates);
      setMsg(r.message);
      ctx.setDetourPins(r.candidates);
    } catch (e) {
      setItems([]);
      setMsg(errorDetailMessage(e, '寄り道の候補を探せませんでした'));
    } finally {
      setBusy(false);
    }
  }, [ctx, gap]);
  useEffect(() => {
    if (items == null && gap && !ctx.stale) void search('all');
    // 開いた時に一度だけ(すべて)探す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!gap) {
    return (
      <ScreenFrame title="寄り道チャンス" onClose={ctx.close} testId="today-detour-screen">
        <div className="tl-pad"><p>今日、30分以上の空き時間はありません。</p></div>
      </ScreenFrame>
    );
  }
  const after = ctx.events.find((e) => e.id === gap.after_event_id);
  const before = ctx.events.find((e) => e.id === gap.before_event_id);
  const range = `${hm(gap.start_at, ctx.timeZone)}〜${hm(gap.end_at, ctx.timeZone)}`;
  const cand = picked != null && items ? items[picked] ?? null : null;
  if (cand) {
    return <DetourAdd ctx={ctx} cand={cand} index={picked!} stay={stay} setStay={setStay} onBack={() => setPicked(null)}
      afterTitle={after?.title ?? '前の予定'} beforeTitle={before?.title ?? '次の予定'} />;
  }
  return (
    <ScreenFrame title="寄り道チャンス" onClose={ctx.close} testId="today-detour-screen"
      tone={ctx.detourPins.some((d) => d.latitude != null) ? 'map' : undefined}>
      {ctx.detourPins.some((d) => d.latitude != null) && (
        <div className="tl-detour__map">
          <Suspense fallback={<div className="tl-map-loading" aria-busy="true">地図を読み込み中…</div>}>
            <TodayMap ctx={ctx} variant="full" />
          </Suspense>
        </div>
      )}
      <div className="tl-pad tl-sheet">
        <p className="tl-lbl tl-lbl--gold">寄り道チャンス</p>
        <h3 className="tl-title tl-title--lg">{`${after?.title ?? '前の予定'}のあと、${gap.minutes}分の空き`}</h3>
        <p className="tl-small tl-mute">{`${range} ・ ${before?.title ?? '次の予定'}へ向かう道の近く（経路から2km以内）`}</p>
        <div className="tl-chips" role="group" aria-label="寄り道の種類">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" className="tc-focus-ring tl-chip" aria-pressed={kind === k} disabled={busy || ctx.stale}
              onClick={() => void search(k)}>{label}</button>
          ))}
        </div>
        {busy && <p className="tl-small" role="status">探しています…</p>}
        {msg && <p className="tl-small tl-mute" role="status">{msg}</p>}
        {items && items.length > 0 && (
          <ul className="tl-detour__cands">
            {items.map((c, i) => (
              <li key={`${c.name}-${i}`}>
                <span className="tl-detour__letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{c.name}</b>
                  <div className="tl-pills">
                    {c.fit === 'indoor' && <Pill tone="info">屋内</Pill>}
                    {c.genre_label && <Pill>{c.genre_label}</Pill>}
                    {c.distance_km != null && <Pill>{`経路から${Math.round(c.distance_km * 1000)}m`}</Pill>}
                    <Pill>{`歩いて約${walkMinutes(c.distance_km)}分`}</Pill>
                  </div>
                </div>
                <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => setPicked(i)}
                  aria-label={`${c.name}を足す前に影響を見る`}>足す</button>
              </li>
            ))}
          </ul>
        )}
        <p className="tl-small tl-mute">足す前に、後の予定への影響を表示します。候補は保存しません。</p>
      </div>
    </ScreenFrame>
  );
};

const DetourAdd: React.FC<{
  ctx: TodayCtx; cand: DetourCandidate; index: number; stay: number; setStay: (n: number) => void; onBack: () => void;
  afterTitle: string; beforeTitle: string;
}> = ({ ctx, cand, index, stay, setStay, onBack, afterTitle, beforeTitle }) => {
  const gap = ctx.gap!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const travel = walkMinutes(cand.distance_km);
  const plan = planDetour(gap, stay, travel, ctx.timeZone);
  const before = ctx.events.find((e) => e.id === gap.before_event_id);
  const lodging = ctx.lodgingEvent;
  const h = plan ? Number(plan.start.slice(0, 2)) : null;
  const rainy = h != null && ctx.hours.some((x) => x.hour === h && x.rainy);
  const add = async () => {
    if (!plan || !ctx.guide?.day_id) return;
    setBusy(true);
    setMsg(null);
    try {
      await addDetourEvent(ctx.planId, { day_id: ctx.guide.day_id, title: cand.name, local_start_time: plan.start, local_end_time: plan.end,
        address: cand.address, latitude: cand.latitude, longitude: cand.longitude });
      ctx.refresh();
      setMsg(`「${cand.name}」を ${plan.start} に足しました`);
      window.setTimeout(ctx.close, 700);
    } catch (e) {
      setMsg(errorDetailMessage(e, '旅程に足せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const beforeHm = hm(before?.start_at, ctx.timeZone);
  const lodgingHm = lodging ? hm(lodging.start_at, ctx.timeZone) : null;
  return (
    <ScreenFrame title="寄り道を足す" onClose={onBack} closeIcon="x" closeLabel="候補に戻る" testId="today-detour-add"
      footer={(
        <div className="tl-actions tl-actions--fill tl-actions--col">
          <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" disabled={busy || !plan || !ctx.guide?.day_id || !plan.fits}
            onClick={() => void add()}>今日の旅程に足す</button>
          <button type="button" className="tc-focus-ring tl-btn" onClick={onBack}>ほかの候補を見る</button>
        </div>
      )}>
      <div className="tl-pad">
        <div className="tl-row" style={{ justifyContent: 'flex-start', gap: 12 }}>
          <span className="tl-detour__letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
          <div><p className="tl-lbl tl-lbl--gold">{`寄り道 ${String.fromCharCode(65 + index)}`}</p><b className="tl-title">{cand.name}</b>
            <p className="tl-small tl-mute">{[cand.distance_km != null ? `経路から${Math.round(cand.distance_km * 1000)}m` : null, cand.genre_label].filter(Boolean).join(' ・ ')}</p></div>
        </div>
        <p className="tl-lbl" id="tl-detour-when">いつ寄る？</p>
        <div className="tl-seg" role="radiogroup" aria-labelledby="tl-detour-when">
          {STAYS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={stay === m} className="tc-focus-ring" onClick={() => setStay(m)}>{`${m}分`}</button>
          ))}
        </div>
        {plan && <p className="tl-title" style={{ marginTop: 10 }}>{`${afterTitle}のあと ${plan.start}〜${plan.end}`}</p>}
        <section className="tl-card tl-card--flat" aria-label="後の予定への影響">
          <h4 className="tl-lbl">後の予定への影響</h4>
          {plan && (
            <dl className="tl-impact">
              <div><dt>{beforeTitle}</dt><dd>{plan.fits ? `${beforeHm} → ${beforeHm} 変わらず` : `${plan.overflowMinutes}分はみ出します`}</dd></div>
              {lodging && lodging.id !== before?.id && <div><dt>宿に着く</dt><dd>{plan.fits ? `${lodgingHm} → ${lodgingHm} 変わらず` : '遅れる可能性'}</dd></div>}
              <div><dt>空き時間</dt><dd>{`${gap.minutes}分 → ${plan.leftMinutes}分`}</dd></div>
              <div><dt>雨の時間</dt><dd>{cand.fit === 'indoor' ? '屋内なので影響なし' : rainy ? '雨の時間にかかります' : '影響なし'}</dd></div>
            </dl>
          )}
        </section>
        <p className="tl-small tl-mute">移動時間は直線距離からの概算です。足した予定は旅程からいつでも消せます。</p>
        {msg && <p role="status" className="tl-small">{msg}</p>}
      </div>
    </ScreenFrame>
  );
};

// ---- 雨の兆し ------------------------------------------------------------------------------------------------------

export const RainScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const navigate = useNavigate();
  const sw = useSwitchOptions(ctx.planId, ctx.data.today_date, ctx.events, ctx.refresh, ctx.stale);
  const title = rainTitle(ctx.hours, ctx.nowHour) ?? '今日は雨の心配はありません';
  const w = rainWindow(ctx.hours, ctx.nowHour);
  const affected = ctx.events.filter((e) => ctx.rainIds.has(e.id) && !ctx.doneIds.has(e.id) && !ctx.visitedIds.has(e.id));
  const later = ctx.events.filter((e) => !ctx.doneIds.has(e.id) && !ctx.visitedIds.has(e.id)).slice(0, 4);
  const o = sw.data?.options.find((x) => x.recommended) ?? sw.data?.options[0] ?? null;
  return (
    <ScreenFrame title="雨の兆し" onClose={ctx.close} tone="rain" testId="today-rain-screen"
      right={ctx.sky ? <span className="tl-small">{`予報 ${hm(new Date(ctx.sky.fetchedAt).toISOString(), ctx.timeZone)} 取得`}</span> : null}
      footer={(
        <>
          <div className="tl-actions tl-actions--fill tl-actions--col">
            <button type="button" className="tc-focus-ring tl-btn tl-btn--blue" disabled={!o?.join || sw.busy != null}
              onClick={() => o && void sw.go(o, false)}>プランBに切り替える</button>
            <div className="tl-actions tl-actions--fill">
              <button type="button" className="tc-focus-ring tl-btn" onClick={ctx.close}>このまま行く</button>
              <button type="button" className="tc-focus-ring tl-btn" onClick={() => navigate(`/planner/${ctx.planId}`)}>ほかの案を作る</button>
            </div>
          </div>
          <p className="tl-small tl-mute tl-center">切り替えは旅程の「元に戻す」で取り消せます</p>
        </>
      )}>
      <div className="tl-pad">
        <h3 className="tl-title tl-title--lg">{title}</h3>
        <RainBars hours={ctx.hours} from={Math.max(0, (w?.start ?? ctx.nowHour) - 2)} count={8} />
        {affected.length > 0 && (
          <p className="tl-small">{'影響する予定：'}<b>{affected.map((e) => `${hm(e.start_at, ctx.timeZone)} ${e.title}（屋外）`).join('、')}</b></p>
        )}
        {sw.saved !== null && <p className="tl-small tl-c-warn">通信できないため、保存した切り替え先を出しています</p>}
        {sw.queued && <p className="tl-small">端末に保存した切り替えがあります。通信が戻ったら送ります</p>}
        <div className="tl-compare">
          <section className="tl-card tl-card--flat" aria-label="今の旅程">
            <h4 className="tl-lbl">今の旅程</h4>
            <ul>{later.map((e) => <li key={e.id} data-rain={ctx.rainIds.has(e.id) ? 'true' : undefined}>
              {`${hm(e.start_at, ctx.timeZone)} ${e.title}${ctx.rainIds.has(e.id) ? '（雨）' : ''}`}</li>)}</ul>
          </section>
          <section className="tl-card tl-card--flat tl-card--good" aria-label="プランB">
            <h4 className="tl-lbl">{o ? `プランB「${o.variant.name}」` : 'プランB'}</h4>
            {o ? (
              <ul>
                {o.join ? <li>{`${o.join.start} ${o.join.title}（合流）`}</li> : <li>今から間に合う予定がありません</li>}
                {o.outdoor_after_join.length > 0 && <li>{`屋外: ${o.outdoor_after_join.join('・')}`}</li>}
              </ul>
            ) : <p className="tl-small">{sw.data?.message ?? '控えの案(プランB)はまだありません。'}</p>}
          </section>
        </div>
        {o && (
          <ul className="tl-impactlist">
            {o.join && <li>{`合流：${o.join.title} ${o.join.arrive} 着（余裕 ${o.join.margin_minutes}分）`}</li>}
            <li>{`外れる予定：${o.skipped.length ? o.skipped.join('・') : 'なし'}`}</li>
            {o.done.length > 0 && <li>{`済んだ予定（${o.done.join('・')}）はそのまま記録に残ります`}</li>}
            {o.check.items.filter((i) => i.level !== 'ok').map((i) => <li key={i.title}>{i.title}</li>)}
          </ul>
        )}
        {sw.done && <p role="status" className="tl-small tl-c-good">{sw.done}</p>}
        {sw.error && <p role="alert" className="tl-small tl-c-bad">{sw.error}</p>}
        {(sw.data?.options.length ?? 0) > 0 && (
          <details className="tl-more">
            <summary className="tc-focus-ring">切り替え先をすべて見る（今いる所を選ぶ）</summary>
            <TodaySwitchPanel planId={ctx.planId} date={ctx.data.today_date} events={ctx.events} offline={ctx.stale} onSwitched={ctx.refresh} />
          </details>
        )}
      </div>
    </ScreenFrame>
  );
};

// ---- 遅れの知らせ ------------------------------------------------------------------------------------------------------

const KIND_WORD: Record<'delay' | 'cancellation' | 'closure', string> = { delay: '遅れ', cancellation: '運休', closure: '休業' };

export const DelayScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const [alert, setAlert] = useState<PlanAlert | null>(null);
  const [detected, setDetected] = useState<DetectedRouteIssue | null>(null);
  const [replan, setReplan] = useState<Replan | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const later = ctx.events.filter((e) => !ctx.doneIds.has(e.id) && !ctx.visitedIds.has(e.id) && e.id !== ctx.nowEv?.id);
  const [form, setForm] = useState<{ event: string; kind: 'delay' | 'cancellation' | 'closure'; minutes: number }>({
    event: ctx.nextEv?.id ?? later[0]?.id ?? '', kind: 'delay', minutes: 20 });

  const makeReplan = useCallback(async (a: PlanAlert) => {
    const r = a.latest_replan_id && a.latest_replan_status === 'proposed' ? await getReplan(ctx.planId, a.latest_replan_id)
      : await createReplan(ctx.planId, a.id);
    setReplan(r);
  }, [ctx.planId]);

  useEffect(() => {
    if (ctx.stale) { setLoaded(true); return; }
    let alive = true;
    (async () => {
      try {
        const list = await getAlerts(ctx.planId);
        if (!alive) return;
        setCanEdit(list.can_edit);
        const today = ctx.data.today_date;
        const a = list.alerts.filter((x) => x.status === 'active' && (!today || x.local_date === today) && x.kind !== 'weather')
          .sort((x, y) => (y.created_at ?? '').localeCompare(x.created_at ?? ''))[0] ?? null;
        setAlert(a);
        setDetected(list.detected.find((d) => !today || d.local_date === today) ?? null);
        if (a && list.can_edit) await makeReplan(a);
      } catch (e) {
        if (alive) setMsg(errorDetailMessage(e, '遅れの知らせを取得できませんでした'));
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [ctx.planId, ctx.data.today_date, ctx.stale, makeReplan]);

  const report = async (input: { kind: AlertKind; event_id: string; delay_minutes: number | null; source: 'user_report' | 'route_status' }) => {
    setBusy(true);
    setMsg(null);
    try {
      const a = await createAlert(ctx.planId, { kind: input.kind, event_id: input.event_id, delay_minutes: input.delay_minutes,
        source: input.source, confidence: 'reported', observed_at: new Date().toISOString() });
      setAlert(a);
      await makeReplan(a);
    } catch (e) {
      setMsg(errorDetailMessage(e, '知らせを登録できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const apply = async (id: 'A' | 'B') => {
    if (!replan) return;
    setBusy(true);
    setMsg(null);
    try {
      await applyReplan(ctx.planId, replan.id, id, replan.plan_revision);
      setMsg(`案${id}で組み直しました。旅程の「元に戻す」で取り消せます。`);
      ctx.refresh();
      window.setTimeout(ctx.close, 900);
    } catch (e) {
      setMsg(errorDetailMessage(e, '組み直せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const a = replan?.candidates.find((c) => c.id === 'A');
  const b = replan?.candidates.find((c) => c.id === 'B');
  const effect = a?.changes.slice(0, 2).map((c) => `${c.title} ${c.before_time ?? ''} → ${c.after_time ?? ''}`).join('、');
  return (
    <ScreenFrame title="遅れの知らせ" onClose={ctx.close} testId="today-delay"
      footer={replan ? (
        <div className="tl-actions tl-actions--fill tl-actions--col">
          <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" disabled={busy || !a?.available || !replan.can_apply}
            onClick={() => void apply('A')}>案Aで組み直す</button>
          <div className="tl-actions tl-actions--fill">
            <button type="button" className="tc-focus-ring tl-btn" disabled={busy || !b?.available || !replan.can_apply} onClick={() => void apply('B')}>案Bにする</button>
            <button type="button" className="tc-focus-ring tl-btn" onClick={ctx.close}>このまま</button>
          </div>
        </div>
      ) : undefined}>
      <div className="tl-pad">
        {!loaded && <p className="tl-small" role="status" aria-busy="true">遅れの知らせを確かめています…</p>}
        {ctx.stale && <p className="tl-small">通信できないため、遅れの知らせ・組み直しは通信が戻ってから使えます。</p>}
        {alert && (
          <section className="tl-card tl-card--warn" aria-label="知らせ">
            <b className="tl-title">{`${alert.event_title ?? '予定'}${alert.kind === 'delay' ? 'への移動' : ''}が ${alert.delay_minutes ? `${alert.delay_minutes}分` : ''}${alert.kind_label}`}</b>
            <p className="tl-small">
              {[alert.source === 'route_status' ? '登録した経路の運行状態から' : alert.source_label ?? '同行者の知らせから',
                alert.observed_at ? `${hm(alert.observed_at, ctx.timeZone)} 取得` : null,
                `確度 ${alert.confidence === 'confirmed' ? '高' : '中'}`].filter(Boolean).join(' ・ ')}
            </p>
            {effect && <p className="tl-small">{`影響： ${effect}`}</p>}
          </section>
        )}
        {!alert && detected && loaded && (
          <section className="tl-card tl-card--warn" aria-label="知らせ">
            <b className="tl-title">{`${detected.event_title} への経路が${detected.transport_status === 'cancelled' ? '運休' : '遅れています'}`}</b>
            <p className="tl-small">{`登録した経路の運行状態から${detected.observed_at ? ` ・ ${hm(detected.observed_at, ctx.timeZone)} 取得` : ''}`}</p>
            <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" disabled={busy || !canEdit}
              onClick={() => void report({ kind: detected.suggested_kind, event_id: detected.event_id, delay_minutes: null, source: 'route_status' })}>
              組み直しの案を作る</button>
          </section>
        )}
        {!alert && !detected && loaded && !ctx.stale && (
          <section className="tl-card tl-card--flat" aria-labelledby="tl-delay-form">
            <h3 id="tl-delay-form" className="tl-lbl">遅れ・休みを知らせる</h3>
            <label className="tl-field">どの予定？
              <select value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} className="tc-focus-ring">
                {later.map((e) => <option key={e.id} value={e.id}>{`${hm(e.start_at, ctx.timeZone)} ${e.title}`}</option>)}
              </select>
            </label>
            <div className="tl-seg" role="radiogroup" aria-label="何があった？">
              {(Object.keys(KIND_WORD) as ('delay' | 'cancellation' | 'closure')[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={form.kind === k} className="tc-focus-ring"
                  onClick={() => setForm({ ...form, kind: k })}>{KIND_WORD[k]}</button>
              ))}
            </div>
            {form.kind === 'delay' && (
              <label className="tl-field">どれくらい遅れる？
                <select value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} className="tc-focus-ring">
                  {[10, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{`${m}分`}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" disabled={busy || !form.event || !canEdit}
              onClick={() => void report({ kind: form.kind, event_id: form.event, delay_minutes: form.kind === 'delay' ? form.minutes : null, source: 'user_report' })}>
              組み直しの案を作る</button>
            {!canEdit && <p className="tl-small">見るだけの参加者は組み直せません。</p>}
          </section>
        )}
        {replan && (
          <>
            <h3 className="tl-lbl">組み直しの案</h3>
            {replan.is_stale && <p className="tl-small tl-c-warn">案を作った後に旅程が変わりました。作り直してください。</p>}
            <div className="tl-replans">
              {[a, b].filter(Boolean).map((c) => (
                <section key={c!.id} className="tl-card tl-card--flat" aria-label={`案${c!.id}`}>
                  <b>{`案${c!.id} ${c!.label}`}</b>
                  {!c!.available ? <p className="tl-small">{c!.unavailable_reason ?? 'この案は使えません'}</p> : (
                    <>
                      <ul className="tl-replan__list">
                        {c!.changes.slice(0, 5).map((x) => <li key={x.event_id}>{`${x.title} ${x.after_time ?? ''}`}</li>)}
                        {c!.lost.map((x) => <li key={x.event_id}><s>{x.title}</s></li>)}
                      </ul>
                      <p className="tl-small tl-mute">
                        {[c!.metrics.day_end_shift_minutes ? `宿に${c!.metrics.day_end_shift_minutes}分遅れ` : '宿の時刻は変わらず',
                          c!.lost.length ? `${c!.lost.map((x) => x.title).join('・')}は外れます` : '外す予定なし'].join(' ・ ')}
                      </p>
                      {c!.warnings.map((x) => <p key={x} className="tl-small tl-c-warn">{x}</p>)}
                    </>
                  )}
                </section>
              ))}
            </div>
            <p className="tl-small tl-mute">承認するまで旅程は変わりません。適用後も「元に戻す」で取り消せます。予約・支払い済みの予定は守ります。</p>
          </>
        )}
        {msg && <p role="status" className="tl-small">{msg}</p>}
      </div>
    </ScreenFrame>
  );
};

// ---- チケット・予約 --------------------------------------------------------------------------------------------------------



export const TicketScreen: React.FC<{ ctx: TodayCtx; eventId: string | null }> = ({ ctx, eventId }) => {
  const navigate = useNavigate();
  const tabs = ticketTabs(ctx);
  const [cur, setCur] = useState<string | null>(() => tabs.find((t) => t.eventId === eventId)?.key ?? tabs[0]?.key ?? null);
  const tab = tabs.find((t) => t.key === cur) ?? null;
  const resId = tab?.resId ?? null;
  const [res, setRes] = useState<Reservation | null>(null);
  const [qr, setQr] = useState<{ payload: string; format: string | null } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'none' | 'error'>('idle');
  useEffect(() => {
    if (!resId) return;
    let alive = true;
    setRes(null);
    setQr(null);
    setState('loading');
    (async () => {
      try {
        const r = await getReservation(ctx.planId, resId).catch(() => null);
        if (alive) setRes(r);
        const tickets = await getTickets(ctx.planId, resId);
        const t = tickets.find((x) => x.has_payload && x.status === 'active') ?? tickets.find((x) => x.has_payload) ?? null;
        if (!t) { if (alive) setState('none'); return; }
        const v = await revealTicket(ctx.planId, resId, t.id);
        if (!alive) return;
        if (v.payload) { setQr({ payload: v.payload, format: v.barcode_format }); setState('idle'); } else setState('none');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; };
  }, [ctx.planId, resId]);
  const ev = tab ? ctx.events.find((e) => e.id === tab.eventId) ?? null : null;
  const phone = res?.contact_phone ?? (ev ? ctx.gEvents[ev.id]?.phone : null) ?? null;
  return (
    <ScreenFrame title="チケット・予約" onClose={ctx.close} testId="today-ticket"
      right={<span className={`tl-pill ${ctx.stale ? 'tl-pill--warn' : 'tl-pill--good'}`}>{ctx.stale ? '保存済み' : '最新'}</span>}
      footer={tab ? (
        <div className="tl-actions tl-actions--fill">
          {phone && safeTelHref(phone) && <a className="tc-focus-ring tl-btn" href={safeTelHref(phone) ?? undefined}><Phone size={18} aria-hidden="true" />お店に電話</a>}
          <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => navigate(`/planner/${ctx.planId}/reservations`)}>予約の画面へ</button>
        </div>
      ) : undefined}>
      <div className="tl-pad">
        {tabs.length === 0 ? (
          <>
            <p>今日の予定に、予約・チケットは登録されていません。</p>
            <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => navigate(`/planner/${ctx.planId}/reservations`)}>予約の画面へ</button>
          </>
        ) : (
          <>
            <div className="tl-tabs" role="tablist" aria-label="今日の予約">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" id={`tl-tk-${t.key}`} aria-selected={t.key === cur} aria-controls="tl-tk-panel"
                  className="tc-focus-ring" onClick={() => setCur(t.key)}>{t.label}</button>
              ))}
            </div>
            {tab && (
              <section id="tl-tk-panel" role="tabpanel" aria-labelledby={`tl-tk-${tab.key}`} className="tl-card tl-ticket">
                <p className="tl-small tl-mute">{`${hm(tab.start, ctx.timeZone)} ・ ${res?.provider_name ?? ev?.title ?? ''}`}</p>
                <b className="tl-title tl-title--lg">{[tab.type, tab.guests ? `${tab.guests}名` : null].filter(Boolean).join(' ')}</b>
                <div className="tl-ticket__qr">
                  {qr ? <TicketCode value={qr.payload} format={qr.format} size={200} label={`${tab.label}のチケットのコード`} />
                    : state === 'loading' ? <span className="tl-small" role="status">表示しています…</span>
                      : state === 'error' ? <span className="tl-small">{ctx.stale ? '通信できないため表示できません' : 'チケットを表示できませんでした'}</span>
                        : <span className="tl-small">この予約に QR のチケットは登録されていません</span>}
                </div>
                <p className="tl-small">{`予約番号 ${res?.confirmation_number_masked ?? '（予約の画面で表示）'}`}</p>
                <p className="tl-small tl-mute">画面を明るくしてお見せください ・ 同行者の権限で見えない項目は隠れます</p>
                {tab.issue && (
                  <p className="tl-warnbox"><AlertTriangle size={16} aria-hidden="true" />予約の状態が「要確認」です。お店からの確認メールを取り込むと「予約済み」になります。</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </ScreenFrame>
  );
};

// ---- 出発前のチェック ----------------------------------------------------------------------------------------------------

export const PrepareScreen: React.FC<{ ctx: TodayCtx; onDone: () => void }> = ({ ctx, onDone }) => {
  const [items, setItems] = useState<PackingItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItems((await getPackingItems(ctx.planId)).filter((i) => i.visibility === 'full'));
    } catch {
      setItems([]);
    }
  }, [ctx.planId]);
  useEffect(() => { if (!ctx.stale) void load(); else setItems([]); }, [load, ctx.stale]);
  const tabs = ticketTabs(ctx);
  const w = rainWindow(ctx.hours, 0);
  const km = (() => {
    let s = 0;
    for (let i = 1; i < ctx.events.length; i += 1) s += distanceKm(ctx.events[i - 1]!, ctx.events[i]!) ?? 0;
    return Math.round(s * 10) / 10;
  })();
  const list = items ?? [];
  const has = (re: RegExp) => list.some((i) => re.test(i.name ?? ''));
  const suggest: { key: string; name: string; why: string }[] = [];
  if (w && !has(/傘/)) suggest.push({ key: 'umbrella', name: '折りたたみ傘', why: `${w.start}〜${w.end}時に雨の可能性 ${w.max}%` });
  if (km >= 3 && !has(/靴/)) suggest.push({ key: 'shoes', name: '歩きやすい靴', why: `今日は約${Math.round(km)}km歩く見込み` });
  const resDone = tabs.filter((t) => !t.issue).length;
  const packed = list.filter((i) => i.status === 'packed' || i.status === 'after_use').length;
  const total = tabs.length + list.length + suggest.length;
  const done = resDone + packed;
  const toggle = async (i: PackingItem) => {
    setBusy(i.id);
    try {
      const next = i.status === 'packed' ? 'to_prepare' : 'packed';
      const r = await updatePackingItem(ctx.planId, i.id, { status: next }, i.revision);
      setItems((cur) => (cur ?? []).map((x) => (x.id === i.id ? r : x)));
    } catch (e) {
      setMsg(errorDetailMessage(e, '持ち物を変えられませんでした'));
    } finally {
      setBusy(null);
    }
  };
  const add = async (s: { key: string; name: string; why: string }) => {
    setBusy(s.key);
    try {
      await createPackingItem(ctx.planId, { name: s.name, note: s.why, scope: 'personal', category: s.key === 'umbrella' ? 'gear' : 'clothing' });
      await load();
    } catch (e) {
      setMsg(errorDetailMessage(e, '持ち物に足せませんでした'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <ScreenFrame title="出発前のチェック" onClose={ctx.close} testId="today-prepare"
      footer={<button type="button" className="tc-focus-ring tl-btn tl-btn--pri tl-btn--block" onClick={onDone}>準備OK・今日の画面へ</button>}>
      <div className="tl-pad">
        <div className="tl-row">
          <b className="tl-title tl-title--lg">{total - done > 0 ? `あと ${total - done} つで準備完了` : '準備ができました'}</b>
          <Pill tone={total - done > 0 ? 'warn' : 'good'}>{`${done} / ${total}`}</Pill>
        </div>
        <div className="tl-bar" role="progressbar" aria-label="準備の進み" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done}>
          <span style={{ width: `${total ? Math.round((done / total) * 100) : 100}%` }} />
        </div>
        <h3 className="tl-lbl">予約・チケット</h3>
        <ul className="tl-checks">
          {tabs.length === 0 && <li className="tl-small tl-mute">今日の予約はありません</li>}
          {tabs.map((t) => (
            <li key={t.key} data-done={!t.issue ? 'true' : undefined}>
              <span className="tl-check" aria-hidden="true">{!t.issue && <Check size={14} />}</span>
              <span><b>{t.label}</b><br /><span className="tl-small tl-mute">{t.issue ? '要確認 ・ 予約の画面で確かめる' : `予約済み${t.start ? ` ・ ${hm(t.start, ctx.timeZone)}` : ''}`}</span></span>
              <span className="sr-only">{t.issue ? '(まだ)' : '(済み)'}</span>
            </li>
          ))}
        </ul>
        <h3 className="tl-lbl">持ち物（天気から追加）</h3>
        <ul className="tl-checks">
          {list.map((i) => (
            <li key={i.id} data-done={i.status === 'packed' ? 'true' : undefined}>
              <button type="button" role="checkbox" aria-checked={i.status === 'packed' || i.status === 'after_use'} className="tc-focus-ring tl-check"
                disabled={busy === i.id} onClick={() => void toggle(i)} aria-label={i.name ?? '持ち物'}>
                {(i.status === 'packed' || i.status === 'after_use') && <Check size={14} aria-hidden="true" />}
              </button>
              <span><b>{i.name}</b>{i.note && <><br /><span className="tl-small tl-mute">{i.note}</span></>}</span>
            </li>
          ))}
          {suggest.map((s) => (
            <li key={s.key}>
              <span className="tl-check tl-check--add" aria-hidden="true">＋</span>
              <span style={{ flex: 1 }}><b>{s.name}</b><br /><span className="tl-small tl-mute">{s.why}</span></span>
              <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" disabled={busy === s.key || ctx.stale} onClick={() => void add(s)}>足す</button>
            </li>
          ))}
          {list.length === 0 && suggest.length === 0 && <li className="tl-small tl-mute">持ち物は登録されていません</li>}
        </ul>
        <section className="tl-card tl-card--good tl-card--flat">
          <b>今日の情報を端末に保存しました</b>
          <p className="tl-small">{`予定・地図の範囲・チケット・宿${ctx.fetchedAt ? ` ・ ${hm(new Date(ctx.fetchedAt).toISOString(), ctx.timeZone)}` : ''}`}</p>
        </section>
        {msg && <p role="status" className="tl-small">{msg}</p>}
      </div>
    </ScreenFrame>
  );
};

// ---- 写真を集める ------------------------------------------------------------------------------------------------------

export const PhotoQrScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const [link, setLink] = useState<UploadLink | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (ctx.stale) return;
    let alive = true;
    createUploadLink(ctx.planId).then((l) => { if (alive) setLink(l); })
      .catch((e) => { if (alive) setErr(errorDetailMessage(e, 'QR コードを作れませんでした(編集できる人だけが作れます)')); });
    return () => { alive = false; };
  }, [ctx.planId, ctx.stale]);
  const url = link?.token ? `${window.location.origin}/u/${link.token}` : null;
  const photos = ctx.guide?.day_photos ?? [];
  return (
    <ScreenFrame title="写真を集める" onClose={ctx.close} testId="today-photoqr">
      <div className="tl-pad tl-center">
        <h3 className="tl-title tl-title--lg">同行者のスマホから<br />今日の旅帖に写真を送ってもらう</h3>
        <p className="tl-small">QRを読むと、この旅行の写真の投稿ページが開きます。撮った場所と時刻で、旅帖のページに自動で綴じます。</p>
        <div className="tl-ticket__qr">
          {url ? <LocalQrCode value={url} size={200} label="写真投稿のQRコード" />
            : <span className="tl-small" role="status">{err ?? (ctx.stale ? '通信できないため作れません' : 'QR コードを作っています…')}</span>}
        </div>
        {link && <p className="tl-small">{`確認コード `}<b className="tl-code">{link.code}</b>{` ・ ${hm(link.expires_at, ctx.timeZone)} まで`}</p>}
        <h4 className="tl-lbl" style={{ textAlign: 'left' }}>届いた写真</h4>
        {photos.length === 0 ? <p className="tl-small tl-mute">まだ写真はありません</p> : (
          <div className="tl-book__photos">
            {photos.slice(-5).map((p) => <Thumb key={p.id} planId={ctx.planId} id={p.id} size={56} alt="届いた写真" />)}
            {photos.length > 5 && <span className="tl-thumb tl-thumb--more">{`+${photos.length - 5}`}</span>}
          </div>
        )}
      </div>
    </ScreenFrame>
  );
};

// ---- 同行者 --------------------------------------------------------------------------------------------------------

export const CrewScreen: React.FC<{ ctx: TodayCtx; crew: ReturnType<typeof useCrew> }> = ({ ctx, crew }) => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const shares: EtaShare[] = crew.shares ?? [];
  const mine = shares.find((s) => s.is_self) ?? null;
  const others = shares.filter((s) => !s.is_self);
  const share = async () => {
    setBusy(true);
    setMsg(null);
    try {
      crew.setShares(await shareMyEta(ctx));
    } catch (e) {
      setMsg(errorDetailMessage(e, '到着予定を共有できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await deleteEta(ctx.planId);
      await crew.load();
    } catch (e) {
      setMsg(errorDetailMessage(e, '共有を止められませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const tell = async () => {
    const e = ctx.nextEv;
    const arrive = ctx.go?.expectedArrivalMs ?? (e?.start_at ? Date.parse(e.start_at) : null);
    const text = e ? `先に行くね。${etaMessage(e.title, arrive != null ? hm(new Date(arrive).toISOString(), ctx.timeZone) : null, null)}` : '先に行くね';
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setMsg('知らせる文をコピーしました'); }
    } catch {
      setMsg(text);
    }
  };
  return (
    <ScreenFrame title="同行者" onClose={ctx.close} testId="today-crew-screen"
      footer={<button type="button" className="tc-focus-ring tl-btn tl-btn--pri tl-btn--block" onClick={() => void tell()}>
        <Users size={18} aria-hidden="true" />みんなに「先に行くね」と知らせる</button>}>
      {ctx.events.some((e) => e.latitude != null) && (
        <div className="tl-crew__map">
          <Suspense fallback={<div className="tl-map-loading" aria-busy="true">地図を読み込み中…</div>}>
            <TodayMap ctx={ctx} variant="full" crew={shares} />
          </Suspense>
        </div>
      )}
      <div className="tl-pad">
        <ul className="tl-crew-list">
          <li>
            <Face label="あなた" self size={38} />
            <span style={{ flex: 1, minWidth: 0 }}><b>あなた</b><br />
              <span className="tl-small tl-mute">{mine ? `${mine.event_title} ・ ${hm(mine.arrive_at, ctx.timeZone)}着予定` : '到着予定を共有していません'}</span></span>
            <Pill tone={mine ? 'good' : 'mute'}>{mine ? '共有中' : '止めています'}</Pill>
          </li>
          {others.map((s, i) => (
            <li key={s.user_id}>
              <Face label={s.label} size={38} tone={i} />
              <span style={{ flex: 1, minWidth: 0 }}><b>{s.label}</b><br /><span className="tl-small tl-mute">{`${s.event_title}へ`}</span></span>
              <span className="tl-small" style={{ textAlign: 'right' }}>{hm(s.arrive_at, ctx.timeZone)}
                {s.delay_minutes != null && s.delay_minutes > 0 ? <><br /><b className="tl-c-warn">{`${s.delay_minutes}分遅れ`}</b></> : null}</span>
            </li>
          ))}
          {others.length === 0 && <li className="tl-small tl-mute">ほかの同行者はまだ共有していません</li>}
        </ul>
        <section className="tl-card tl-card--flat" aria-labelledby="tl-crew-mine">
          <h3 id="tl-crew-mine" className="tl-lbl">あなたの共有</h3>
          <p>{mine ? <><b>到着予定だけ</b>{` を、今日 ${hm(mine.until, ctx.timeZone)} まで同行者に見せています`}</>
            : `位置ではなく到着予定だけを、今日のうち（最長${crew.maxHours}時間）共有できます`}</p>
          <div className="tl-actions tl-actions--fill">
            <button type="button" className="tc-focus-ring tl-btn" onClick={() => navigate(`/planner/${ctx.planId}/track`)}>位置も見せる</button>
            {mine ? <button type="button" className="tc-focus-ring tl-btn" disabled={busy} onClick={() => void stop()}>今すぐ止める</button>
              : <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" disabled={busy || !ctx.nextEv || ctx.stale} onClick={() => void share()}>到着予定を共有する</button>}
          </div>
        </section>
        {msg && <p role="status" className="tl-small">{msg}</p>}
      </div>
    </ScreenFrame>
  );
};

// ---- お助け --------------------------------------------------------------------------------------------------------------

export const HelpScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const navigate = useNavigate();
  const nextPhone = ctx.nextEv ? ctx.gEvents[ctx.nextEv.id]?.phone ?? null : null;
  const phone = nextPhone ?? ctx.lodging?.phone ?? null;
  const rows: { icon: React.ReactNode; title: string; sub: string; onClick?: () => void; tel?: string | null; url?: string }[] = [
    { icon: <AlertTriangle size={20} />, title: '遅れた・休みだった', sub: '後の予定を組み直す案（A/B）を作る', onClick: () => ctx.open('delay') },
    { icon: <CloudRain size={20} />, title: '天気が悪い', sub: 'プランBに切り替える', onClick: () => ctx.open('rain') },
    { icon: <QrCode size={20} />, title: 'チケット・予約を出す', sub: '通信なしでも表示', onClick: () => ctx.open('ticket') },
    { icon: <Phone size={20} />, title: 'お店・宿に電話', sub: [nextPhone ? '次の場所' : null, ctx.lodging?.phone ? '今日の宿' : null].filter(Boolean).join(' ・ ') || '電話番号が登録されていません',
      tel: phone },
    { icon: <Wallet size={20} />, title: '立替を入れる', sub: '割り勘は旅行の費用へ', onClick: () => navigate(`/planner/${ctx.planId}/expenses`) },
    { icon: <Languages size={20} />, title: '翻訳を開く', sub: '外の翻訳アプリへ', url: 'https://translate.google.com/' },
    { icon: <Home size={20} />, title: '宿へ帰る', sub: '今いる場所から', onClick: () => ctx.open('home') },
    { icon: <Users size={20} />, title: '同行者に知らせる', sub: '遅れる・先に行く', onClick: () => ctx.open('crew') },
  ];
  return (
    <ScreenFrame title="お助け" onClose={ctx.close} closeIcon="x" closeLabel="閉じる" sheet testId="today-help">
      <div className="tl-pad">
        <p className="tl-small tl-mute">困った時は、まずここから</p>
        <ul className="tl-helplist">
          {rows.map((r) => {
            const body = <><span className="tl-helplist__icon" aria-hidden="true">{r.icon}</span>
              <span className="tl-helplist__text"><b>{r.title}</b><small>{r.sub}</small></span><ChevronRight size={18} aria-hidden="true" /></>;
            return (
              <li key={r.title}>
                {r.url ? <a className="tc-focus-ring" href={safeExternalUrl(r.url) ?? undefined} target="_blank" rel="noopener noreferrer">{body}</a>
                  : r.tel ? <a className="tc-focus-ring" href={safeTelHref(r.tel) ?? undefined}>{body}</a>
                  : r.tel === null ? <span className="is-disabled">{body}</span>
                    : <button type="button" className="tc-focus-ring" onClick={r.onClick}>{body}</button>}
              </li>
            );
          })}
        </ul>
      </div>
    </ScreenFrame>
  );
};

// ---- 当日の設定 --------------------------------------------------------------------------------------------------------

export const SettingsScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const s = ctx.settings;
  const setN = (k: keyof typeof s.notices, v: boolean) => ctx.setSettings({ ...s, notices: { ...s.notices, [k]: v } });
  const setL = (k: keyof typeof s.location, v: boolean) => ctx.setSettings({ ...s, location: { ...s.location, [k]: v } });
  return (
    <ScreenFrame title="当日の設定" onClose={ctx.close} testId="today-settings">
      <div className="tl-pad">
        <h3 className="tl-lbl">知らせ</h3>
        <LiveSwitch label="出発の合図" sub="出る10分前と、出る時刻に" checked={s.notices.go} onToggle={(v) => setN('go', v)} />
        <LiveSwitch label="雨の兆し" sub="屋外の予定の1時間前に" checked={s.notices.rain} onToggle={(v) => setN('rain', v)} />
        <LiveSwitch label="遅延・休業" sub="登録した経路・場所の変化" checked={s.notices.delay} onToggle={(v) => setN('delay', v)} />
        <LiveSwitch label="寄り道チャンス" sub="30分以上の空きがある時" checked={s.notices.detour} onToggle={(v) => setN('detour', v)} />
        <LiveSwitch label="着きましたか?" sub="予定の時刻になったら印を押す案内" checked={s.notices.arrive} onToggle={(v) => setN('arrive', v)} />
        <h3 className="tl-lbl" style={{ marginTop: 16 }}>位置（既定はOFF）</h3>
        <LiveSwitch label="着いたら印を押す提案" sub="位置の記録をONにした時だけ。保護エリアでは使いません" checked={s.location.arrive}
          onToggle={(v) => setL('arrive', v)} testId="today-set-loc-arrive" />
        <LiveSwitch label="今日の足跡を地図に描く" sub="この端末だけに置く" checked={s.location.trail} onToggle={(v) => setL('trail', v)}
          testId="today-set-loc-trail" />
        <h3 className="tl-lbl" style={{ marginTop: 16 }}>表示</h3>
        <LiveSwitch label="着いたらひとこと案内（読み上げ）" sub="場所のメモ・見どころを読み上げ" checked={s.voice}
          onToggle={(v) => { ctx.setSettings({ ...s, voice: v }); if (v) speak('読み上げをオンにしました'); }} />
        <LiveSwitch label="簡易表示" sub="今と次だけ・大きな文字" checked={ctx.simple} onToggle={() => ctx.toggleSimple()} />
        <p className="tl-small tl-mute">設定はこの端末に覚えます。位置は端末の中だけで使い、送りません。</p>
        <PushPanel />
        <TodayCardButton planId={ctx.planId} />
      </div>
    </ScreenFrame>
  );
};

