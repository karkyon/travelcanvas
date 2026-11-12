/**
 * [Gate TDay] 旅の当日の面: 同行者の到着予定・お助け・当日の設定・移動モード・朝・旅の前・夜のふりかえり・画面の中の知らせ。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, CloudRain, Home, Languages, Navigation, Phone, QrCode, Users, Wallet, X, Clock, Footprints,
} from 'lucide-react';
import Modal from '@/components/common/Modal';
import type { TodayEvent } from '@/services/api';
import { deleteEta, getEta, putEta, type EtaShare, type GuideNextDay, type GuideUpcoming, type TodayGuide } from '@/services/api/travelDay';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl, safeInternalPath, safeTelHref } from '@/utils/safeNavigation';
import { formatTimeInZone, mapUrl } from '../todayModel';
import { etaMessage, recapTitle, speak, type GoNowView, type LiveNotice, type LiveSettings } from './todayLive';
import { Seal } from './LivePieces';

// ---- 同行者の到着予定 ------------------------------------------------------------------------------------------

export const CrewPanel: React.FC<{
  planId: string; next: TodayEvent | null; arriveMs: number | null; dayEndAt: string | null; timeZone: string | null;
  offline: boolean;
}> = ({ planId, next, arriveMs, dayEndAt, timeZone, offline }) => {
  const [shares, setShares] = useState<EtaShare[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setShares((await getEta(planId)).shares);
    } catch {
      setShares((s) => s ?? []);
    }
  }, [planId]);
  useEffect(() => {
    if (offline) return;
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load, offline]);
  const mine = shares?.find((s) => s.is_self) ?? null;
  const share = async () => {
    if (!next || arriveMs == null) return;
    setBusy(true);
    setMsg(null);
    const end = dayEndAt ? Date.parse(dayEndAt) : Date.now() + 12 * 3600_000;
    const until = Math.min(end, Date.now() + 12 * 3600_000);
    try {
      setShares((await putEta(planId, { event_id: next.id, arrive_at: new Date(arriveMs).toISOString(),
        until: new Date(Math.max(until, Date.now() + 3600_000)).toISOString() })).shares);
    } catch (e) {
      setMsg(errorDetailMessage(e, '到着予定を共有できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await deleteEta(planId);
      await load();
    } catch (e) {
      setMsg(errorDetailMessage(e, '共有を止められませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!next || arriveMs == null) return;
    const text = etaMessage(next.title, formatTimeInZone(new Date(arriveMs).toISOString(), timeZone), null);
    try {
      await navigator.clipboard.writeText(text);
      setMsg('知らせる文をコピーしました');
    } catch {
      setMsg(text);
    }
  };
  if (offline && !shares) return null;
  return (
    <section className="tc-live-card" aria-labelledby="today-crew-title" data-testid="today-crew">
      <h2 id="today-crew-title" className="tc-live-label"><Users size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />同行者の到着予定</h2>
      {shares && shares.length > 0 ? (
        <ul className="tc-crew">
          {shares.map((s) => (
            <li key={s.user_id}>
              <span className="tc-crew__face" data-self={s.is_self ? 'true' : undefined} aria-hidden="true">{[...s.label][0]}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b>{s.label}</b><br /><span className="tc-live-muted">{s.event_title}</span></span>
              <span>{`${formatTimeInZone(s.arrive_at, timeZone)} 着予定`}</span>
              {s.delay_minutes != null && s.delay_minutes > 0
                ? <span className="tc-live-chip tc-live-chip--warn">{`${s.delay_minutes}分遅れ`}</span>
                : <span className="tc-live-chip tc-live-chip--good">予定どおり</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tc-live-muted" style={{ margin: '8px 0 0' }}>まだ誰も到着予定を共有していません。</p>
      )}
      <div className="tc-live-actions">
        {mine ? (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} onClick={stop}>共有を止める</button>
        ) : (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" disabled={busy || !next || arriveMs == null || offline}
            onClick={share}>到着予定を共有する</button>
        )}
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={!next || arriveMs == null} onClick={copy}>知らせる文をコピー</button>
      </div>
      <p className="tc-live-muted" style={{ margin: '8px 0 0' }}>位置ではなく到着予定だけを、今日のうち(最長12時間)共有します。</p>
      {msg && <p role="status" className="tc-live-muted" style={{ margin: '4px 0 0' }}>{msg}</p>}
    </section>
  );
};

// ---- お助け ----------------------------------------------------------------------------------------------------

const HelpRow: React.FC<{ icon: React.ReactNode; title: string; sub: string; onClick?: () => void; url?: string | null;
  tel?: string | null }> = ({ icon, title, sub, onClick, url, tel }) => {
  const body = <><span className="tc-help__icon" aria-hidden="true">{icon}</span><span><b>{title}</b><small>{sub}</small></span></>;
  if (tel) return <li><a href={safeTelHref(tel) ?? undefined} className="tc-focus-ring">{body}</a></li>;
  if (url) return <li><a href={safeExternalUrl(url) ?? undefined} className="tc-focus-ring" target="_blank" rel="noopener noreferrer">{body}</a></li>;
  return <li><button type="button" className="tc-focus-ring" onClick={onClick}>{body}</button></li>;
};

export const HelpSheet: React.FC<{
  open: boolean; onClose: () => void; planId: string; next: TodayEvent | null; lodging: TodayEvent | null;
  phone: string | null; onPlanB: () => void; onTransit: () => void; onTabicho: () => void;
}> = ({ open, onClose, planId, next, lodging, phone, onPlanB, onTransit, onTabicho }) => {
  const navigate = useNavigate();
  const go = (path: string) => {
    onClose();
    const safe = safeInternalPath(path);
    if (safe) navigate(safe);
  };
  const home = lodging ? mapUrl(lodging) : null;
  return (
    <Modal isOpen={open} onClose={onClose} title="お助け" size="md">
      <p className="tc-live-muted" style={{ margin: '0 0 8px' }}>困った時は、まずここから</p>
      <ul className="tc-help" data-testid="today-help">
        <HelpRow icon={<AlertTriangle size={20} />} title="遅れた・休みだった" sub="後の予定を組み直す案(A/B)を作る" onClick={() => go(`/planner/${planId}/alerts`)} />
        <HelpRow icon={<CloudRain size={20} />} title="天気が悪い" sub="プランB(控えの案)に切り替える" onClick={() => { onClose(); onPlanB(); }} />
        <HelpRow icon={<QrCode size={20} />} title="チケット・予約を出す" sub="予約の画面で表示(通信なしでも保存済みの物)" onClick={() => go(`/planner/${planId}/reservations`)} />
        {phone && <HelpRow icon={<Phone size={20} />} title={`${next?.title ?? '次の場所'}に電話`} sub={phone} tel={phone} />}
        <HelpRow icon={<Navigation size={20} />} title="移動モード" sub="着くまでの残り時間だけを大きく" onClick={() => { onClose(); onTransit(); }} />
        <HelpRow icon={<Wallet size={20} />} title="立替を入れる" sub="割り勘は旅行の費用へ" onClick={() => go(`/planner/${planId}/expenses`)} />
        <HelpRow icon={<Languages size={20} />} title="翻訳を開く" sub="外の翻訳(新しいタブ)" url="https://translate.google.com/" />
        {home && <HelpRow icon={<Home size={20} />} title={`宿へ帰る(${lodging!.title})`} sub="外の地図で道案内" url={home} />}
        <HelpRow icon={<BookOpen size={20} />} title="今日の旅帖" sub="印・写真・ひとこと" onClick={() => { onClose(); onTabicho(); }} />
        <HelpRow icon={<Footprints size={20} />} title="位置の記録" sub="足跡を残す(既定は OFF)" onClick={() => go(`/planner/${planId}/track`)} />
      </ul>
    </Modal>
  );
};

// ---- 当日の設定 ------------------------------------------------------------------------------------------------

const LiveSwitch: React.FC<{ label: string; sub: string; checked: boolean; onToggle: (v: boolean) => void }> = ({ label, sub, checked, onToggle }) => (
  <label className="tc-live-switch"><span><b>{label}</b><small>{sub}</small></span>
    <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} /></label>
);

export const SettingsDialog: React.FC<{
  open: boolean; onClose: () => void; settings: LiveSettings; onChange: (s: LiveSettings) => void;
  simple: boolean; onSimple: () => void;
}> = ({ open, onClose, settings, onChange, simple, onSimple }) => {
  const n = settings.notices;
  const setN = (k: keyof LiveSettings['notices'], v: boolean) => onChange({ ...settings, notices: { ...n, [k]: v } });
  return (
    <Modal isOpen={open} onClose={onClose} title="当日の設定" size="md">
      <p className="tc-live-label">画面の中の知らせ</p>
      <LiveSwitch label="出発の合図" sub="出る20分前から" checked={n.go} onToggle={(v) => setN('go', v)} />
      <LiveSwitch label="着きましたか?" sub="予定の時刻になったら印を押す案内" checked={n.arrive} onToggle={(v) => setN('arrive', v)} />
      <LiveSwitch label="雨の兆し" sub="屋外の予定が雨の時間にかかる時" checked={n.rain} onToggle={(v) => setN('rain', v)} />
      <LiveSwitch label="遅延・運休" sub="登録した経路の運行状態" checked={n.delay} onToggle={(v) => setN('delay', v)} />
      <p className="tc-live-label" style={{ marginTop: 14 }}>表示</p>
      <LiveSwitch label="着いたらひとこと案内(読み上げ)" sub="印を押した時・移動モードで着いた時に読み上げる" checked={settings.voice}
        onToggle={(v) => { onChange({ ...settings, voice: v }); if (v) speak('読み上げをオンにしました'); }} />
      <LiveSwitch label="簡易表示" sub="今と次だけ・大きな文字" checked={simple} onToggle={() => onSimple()} />
      <p className="tc-live-muted" style={{ marginTop: 12 }}>この端末に覚えます。位置の記録は「位置の記録」の画面で ON にした時だけ使います(既定は OFF)。端末の通知(Web Push)は次の段階で入れます。</p>
    </Modal>
  );
};

// ---- 移動モード ------------------------------------------------------------------------------------------------

export const TransitMode: React.FC<{
  next: TodayEvent; go: GoNowView | null; nowMs: number; timeZone: string | null; voice: boolean; onClose: () => void;
}> = ({ next, go, nowMs, timeZone, voice, onClose }) => {
  const startMs = Date.parse(next.start_at ?? '');
  const leaveMs = go ? Date.parse(go.leaveBy) : NaN;
  const arriveMs = go?.expectedArrivalMs ?? (Number.isNaN(startMs) ? null : startMs);
  const left = arriveMs != null ? Math.max(0, Math.ceil((arriveMs - nowMs) / 60_000)) : null;
  const total = !Number.isNaN(leaveMs) && arriveMs != null ? Math.max(1, (arriveMs - leaveMs) / 60_000) : null;
  const progress = total != null && left != null ? Math.max(0, Math.min(100, Math.round((1 - left / total) * 100))) : null;
  const map = mapUrl(next);
  const [spoken, setSpoken] = useState(false);
  useEffect(() => {
    if (voice && left === 0 && !spoken) {
      speak(`${next.title}に着く時刻です`);
      setSpoken(true);
    }
  }, [voice, left, spoken, next.title]);
  // 画面の部品の変形(transform)の影響を受けないよう、body の直下に出す
  return createPortal(
    <div className="tc-transit" role="dialog" aria-modal="true" aria-label="移動モード" data-testid="today-transit">
      <div className="tc-live-row">
        <span className="tc-live-label" style={{ color: '#9fe3d3' }}>{`移動モード${next.transport_mode ? ` ・ ${next.transport_mode}` : ''}`}</span>
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" style={{ marginLeft: 'auto' }} onClick={onClose}>終える</button>
      </div>
      <div>
        <p className="tc-transit__muted" style={{ margin: 0 }}>{`${next.title}まで`}</p>
        <p className="tc-transit__big">{left == null ? '—' : left === 0 ? '到着の時刻' : `あと${left}分`}</p>
        <p style={{ margin: '8px 0 0', fontSize: 15 }}>
          {arriveMs != null ? `${formatTimeInZone(new Date(arriveMs).toISOString(), timeZone)} 着の見込み` : '到着の時刻は未定'}
          {go?.stage === 'late' ? ' ・ 予定より遅れ気味' : ' ・ 予定どおり'}
        </p>
      </div>
      {progress != null && (
        <div>
          <div className="tc-transit__bar" role="progressbar" aria-label="道のりの進み(時間)" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={progress}><div style={{ width: `${progress}%` }} /></div>
          <p className="tc-transit__muted" style={{ margin: '6px 0 0' }}>{go?.estimated ? '移動時間は直線距離からの概算です' : '登録した移動の時刻から'}</p>
        </div>
      )}
      {next.address && (
        <div className="tc-transit__box"><p className="tc-live-label" style={{ color: '#9fe3d3' }}>行き先</p>
          <p style={{ margin: '6px 0 0', fontSize: 15 }}>{next.address}</p></div>
      )}
      <div className="tc-transit__box">
        <label className="tc-live-switch" style={{ borderBottom: 0, padding: 0 }}>
          <span>着いたら読み上げる<small style={{ color: '#c9dde6' }}>当日の設定で変えられます</small></span>
          <input type="checkbox" checked={voice} readOnly aria-readonly="true" />
        </label>
      </div>
      <div className="tc-live-actions" style={{ marginTop: 'auto' }}>
        {map && (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--gold" style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => window.open(safeExternalUrl(map) ?? undefined, '_blank', 'noopener,noreferrer')}>
            <Navigation size={18} aria-hidden="true" />外の地図で案内
          </button>
        )}
        <button type="button" className="tc-focus-ring tc-mbtn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>今日の画面へ</button>
      </div>
    </div>,
    document.body,
  );
};

// ---- 朝・旅の前・夜 ---------------------------------------------------------------------------------------------

export const Dawn: React.FC<{ planId: string; title: string; first: TodayEvent; go: GoNowView | null; sky: string | null;
  timeZone: string | null; dayLabel: string | null }> = ({ planId, title, first, go, sky, timeZone, dayLabel }) => {
  const navigate = useNavigate();
  return (
    <section className="tc-live-dawn" aria-labelledby="today-dawn-title" data-testid="today-dawn">
      <p className="tc-live-label">{`おはようございます${dayLabel ? ` ・ ${dayLabel}` : ''}`}</p>
      <h2 id="today-dawn-title">{`今日は、${title}`}</h2>
      <p style={{ margin: '8px 0 0' }}>
        <b>{`最初は ${formatTimeInZone(first.start_at, timeZone)} ${first.title}`}</b>
        {go ? `(${formatTimeInZone(go.leaveBy, timeZone)} に出発・あと${Math.max(0, go.minutesToLeave)}分)` : ''}
      </p>
      {sky && <p style={{ margin: '4px 0 0' }}>{sky}</p>}
      <div className="tc-live-actions">
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={() => navigate(`/planner/${planId}/preparation`)}>出発前のチェック</button>
      </div>
    </section>
  );
};

export const BeforeTrip: React.FC<{ planId: string; upcoming: GuideUpcoming; title: string }> = ({ planId, upcoming, title }) => {
  const navigate = useNavigate();
  return (
    <section className="tc-live-dawn" aria-labelledby="today-before-title" data-testid="today-before">
      <p className="tc-live-label">{upcoming.is_trip_start ? '旅のはじまりまで' : '次の旅の日まで'}</p>
      <p id="today-before-title" className="tc-live-count">{upcoming.days_until <= 0 ? 'まもなく' : `あと ${upcoming.days_until}日`}</p>
      <p style={{ margin: '6px 0 0' }}>{`${title} ・ ${upcoming.date}${upcoming.day_title ? ` ・ ${upcoming.day_title}` : ''}`}</p>
      {upcoming.first_event_title && (
        <p style={{ margin: '4px 0 0' }}>{`最初の予定: ${upcoming.first_event_time ? `${upcoming.first_event_time.slice(0, 5)} ` : ''}${upcoming.first_event_title}`}</p>
      )}
      <ul style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
        <li>当日の情報は、開いた時に端末へ保存します(通信なしでも見られます)</li>
        <li>予約の「要確認」を確かめておく</li>
        <li>同行者に到着予定の共有を頼む</li>
      </ul>
      <div className="tc-live-actions">
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={() => navigate(`/planner/${planId}/preparation`)}>当日の準備をする</button>
        <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}`)}>旅程を見る</button>
      </div>
    </section>
  );
};

export const DayRecap: React.FC<{
  planId: string; guide: TodayGuide; events: TodayEvent[]; finished: boolean; next: GuideNextDay | null; onBook: () => void;
}> = ({ planId, guide, events, finished, next, onBook }) => {
  const navigate = useNavigate();
  const m = guide.metrics;
  return (
    <section className="tc-live-night" aria-labelledby="today-recap-title" data-testid="today-recap">
      <p className="tc-live-label">{finished ? '旅の終わり' : '今日のふりかえり'}</p>
      <h2 id="today-recap-title">{finished ? `おかえりなさい。旅帖が一冊になりました` : `おつかれさま。${recapTitle(m.visited, m.total)}`}</h2>
      <div className="tc-live-night__stats">
        <div><b>{`${m.visited}か所`}</b><span>印を押した場所</span></div>
        <div><b>{`${m.photos}枚`}</b><span>写真</span></div>
        <div><b>{`${m.notes}件`}</b><span>ひとこと・声</span></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {events.filter((e) => guide.stamps[e.id]?.status === 'visited').slice(0, 8).map((e) => (
          <Seal key={e.id} title={e.title} id={e.id} eventType={e.event_type} size={40} />
        ))}
      </div>
      <p className="tc-live-night__muted" style={{ marginTop: 8 }}>数値は自分の画面だけ。順位は作りません。</p>
      {next && !finished && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: '#1a2f45' }}>
          <p className="tc-live-label" style={{ color: '#9fe3d3' }}>明日のチラ見せ</p>
          <p style={{ margin: '4px 0 0' }}>
            {`${next.date}${next.day_title ? ` ${next.day_title}` : ''} ・ ${next.event_count}か所`}
            {next.first_event_title ? ` ・ 最初は ${next.first_event_time ? `${next.first_event_time.slice(0, 5)} ` : ''}${next.first_event_title}` : ''}
          </p>
        </div>
      )}
      <div className="tc-live-actions">
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={onBook}>今日の旅帖を見る</button>
        <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}/journey`)}>
          {finished ? '旅のふりかえり・旅行記へ' : '旅の振り返り'}
        </button>
        <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}/memories`)}>写真とリール</button>
      </div>
    </section>
  );
};

// ---- 画面の中の知らせ ------------------------------------------------------------------------------------------

export const LiveNotices: React.FC<{ items: LiveNotice[]; onDismiss: (key: string) => void }> = ({ items, onDismiss }) => {
  if (items.length === 0) return null;
  const icon = { go: <Clock size={20} />, arrive: <BookOpen size={20} />, rain: <CloudRain size={20} />, delay: <AlertTriangle size={20} /> };
  return (
    <div className="tc-live-notices" aria-live="polite" data-testid="today-notices">
      {items.map((n) => (
        <div key={n.key} className="tc-live-notice" data-kind={n.kind} role="status">
          <span aria-hidden="true">{icon[n.kind]}</span>
          <p><b>{n.title}</b>{n.sub}</p>
          <button type="button" className="tc-focus-ring tc-live-notice__act" onClick={n.onAction}>{n.action}</button>
          <button type="button" className="tc-focus-ring tc-live-notice__close" aria-label={`「${n.title}」を閉じる`} onClick={() => onDismiss(n.key)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
};
