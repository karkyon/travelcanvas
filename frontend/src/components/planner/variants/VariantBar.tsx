/**
 * [Gate PlanB] 旅程の日の見出しの下: 日の案のタブ(A 今の案・B 雨の日…・＋案を作る)と、控えの案を開いている時の帯
 * (この案に切り替える・今の案と比べる・前後のつながり)。案の名前の変更・しまう・消すもここから。
 */
import React, { useState } from 'react';
import type { Forecast, VariantSummary } from '@/services/api/dayVariants';
import { conditionText, sortVariants } from './variantModel';

interface Props {
  variants: ReadonlyArray<VariantSummary>;
  openId: string | null;
  canEdit: boolean;
  checkSummary?: { ok: number; warn: number; bad: number } | null;
  onOpen: (dayId: string | null) => void;
  onCreate: () => void;
  onSwitch: () => void;
  onCompare: () => void;
  onCheck: () => void;
  onRename: (v: VariantSummary) => void;
  onArchive: (v: VariantSummary) => void;
  onDelete: (v: VariantSummary) => void;
  /** [PlanB-Weather] この日の予報(無ければ出さない) */
  forecast?: Forecast | null;
  /** 予報が雨で雨の案が無い時に「雨の日の案を作る」 */
  onCreateRain?: () => void;
  /** [PlanB-Indoor] 屋内の候補を探す(雨・屋内を優先の案) */
  onIndoor?: () => void;
  /** [PlanB-AI] AI で確かめる(押した時だけ) */
  onAiCheck?: () => void;
}

const Svg: React.FC<{ d: string; size?: number }> = ({ d, size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICON = {
  rain: 'M3 12a9 9 0 0 1 18 0zM12 12v6a2 2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  branch: 'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9c0 5-6 4-12 9',
};

const VariantBar: React.FC<Props> = ({ variants, openId, canEdit, checkSummary, onOpen, onCreate, onSwitch, onCompare, onCheck,
  onRename, onArchive, onDelete, forecast, onCreateRain, onIndoor, onAiCheck }) => {
  const [menu, setMenu] = useState(false);
  const list = sortVariants(variants);
  const active = list.find((v) => v.status === 'active');
  const open = list.find((v) => v.day_id === openId) ?? null;
  if (list.length <= 1 && !canEdit && !forecast) return null;
  const showing = open && open.status !== 'active' ? open : null;
  return (
    <div className="tc-variant" data-testid="variant-bar">
      <div className="tc-variant-head">
        <span className="tc-variant-label">この日の案</span>
        {list.length > 1 && <span className="tc-variant-note">今の案は旅程・しおり・共有に出ます</span>}
        {forecast && (
          <span className={`tc-variant-forecast${forecast.rainy ? ' is-rain' : ''}`} data-testid="variant-forecast"
            title={`予報(${forecast.source})`}>
            {`予報 ${forecast.label}`}
            {forecast.precipitation_probability !== null ? ` · 降水 ${forecast.precipitation_probability}%` : ''}
            {forecast.temp_max !== null ? ` · ${Math.round(forecast.temp_max)}℃` : ''}
          </span>
        )}
        {forecast?.rainy && !forecast.has_rain_variant && canEdit && onCreateRain && (
          <button type="button" className="tc-focus-ring tc-mini-link" onClick={onCreateRain} data-testid="variant-create-rain">
            雨の予報です。雨の日の案を作る
          </button>
        )}
      </div>
      <div className="tc-variant-tabs">
      <div className="tc-variant-tabs" role="tablist" aria-label="この日の案">
        {list.map((v) => {
          const isActive = v.status === 'active';
          const isOpen = showing ? v.day_id === showing.day_id : isActive;
          return (
            <button key={v.day_id} type="button" role="tab" aria-selected={isOpen} data-testid={`variant-tab-${v.label}`}
              className={`tc-focus-ring tc-vtab${isActive ? ' is-active' : ''}${isOpen && !isActive ? ' is-open' : ''}${v.status === 'archived' ? ' is-archived' : ''}`}
              onClick={() => onOpen(isActive ? null : v.day_id)}>
              <span className="tc-vtab-letter" aria-hidden="true">{v.label}</span>
              <span>{v.name}</span>
              {isActive && <span className="tc-vtab-now"><span className="tc-vtab-dot" aria-hidden="true" />今の案</span>}
              {v.reason === 'rain' && <Svg d={ICON.rain} />}
              {v.status === 'archived' && <span className="tc-vtab-arch">しまった案</span>}
            </button>
          );
        })}
      </div>
        {canEdit && (
          <button type="button" className="tc-focus-ring tc-vtab tc-vtab-add" onClick={onCreate} data-testid="variant-create">
            <Svg d={ICON.plus} />案を作る
          </button>
        )}
      </div>
      {showing && (
        <div className="tc-variant-banner" role="status" data-testid="variant-banner">
          <p className="tc-variant-banner-title">
            <Svg d={ICON.eye} size={15} />
            <strong>{`控えの案「${showing.label} ${showing.name}」を見ています`}</strong>
            {active && <span>{`今の案は ${active.label} ${active.name}`}</span>}
          </p>
          {(showing.conditions?.scaffold?.length ?? 0) > 0 && (
            <details className="tc-variant-scaffold" data-testid="variant-scaffold-notes">
              <summary>{`たたき台で変えた所・印 ${showing.conditions!.scaffold!.length}件`}</summary>
              <ul>
                {showing.conditions!.scaffold!.map((n, i) => (
                  <li key={`${n.kind}-${n.event_id ?? i}`}><strong>{n.title}</strong>{` ${n.text}`}</li>
                ))}
              </ul>
            </details>
          )}
          {conditionText(showing).length > 0 && (
            <p className="tc-variant-chips">{conditionText(showing).map((t) => <span key={t} className="tc-variant-chip">{t}</span>)}</p>
          )}
          <div className="tc-variant-actions">
            {canEdit && showing.status === 'standby' && (
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={onSwitch} data-testid="variant-switch">
                <Svg d={ICON.branch} />この案に切り替える
              </button>
            )}
            <button type="button" className="tc-focus-ring tc-mbtn" onClick={onCompare} data-testid="variant-compare">
              {active ? `${active.label} ${active.name}と比べる` : '比べる'}
            </button>
            <button type="button" className="tc-focus-ring tc-mbtn" onClick={onCheck} data-testid="variant-check">
              前後のつながり
              {checkSummary && (
                <span className="tc-variant-counts">
                  <span className="is-ok">{`✓${checkSummary.ok}`}</span>
                  {checkSummary.warn > 0 && <span className="is-warn">{`⚠${checkSummary.warn}`}</span>}
                  {checkSummary.bad > 0 && <span className="is-bad">{`✕${checkSummary.bad}`}</span>}
                </span>
              )}
            </button>
            {canEdit && onIndoor && (showing.reason === 'rain' || showing.conditions?.prefer_indoor) && (
              <button type="button" className="tc-focus-ring tc-mbtn" onClick={onIndoor} data-testid="variant-indoor">屋内の候補を探す</button>
            )}
            {canEdit && onAiCheck && (
              <button type="button" className="tc-focus-ring tc-mbtn" onClick={onAiCheck} data-testid="variant-ai">AI で確かめる</button>
            )}
            {canEdit && (
              <span className="tc-variant-more">
                <button type="button" className="tc-focus-ring tc-mini-link" aria-expanded={menu} onClick={() => setMenu((m) => !m)}
                  data-testid="variant-menu">この案の操作</button>
                {menu && (
                  <span className="tc-variant-menu" role="group" aria-label="この案の操作">
                    <button type="button" className="tc-focus-ring" onClick={() => { setMenu(false); onRename(showing); }}>名前・理由・条件を変える</button>
                    {showing.status === 'standby'
                      ? <button type="button" className="tc-focus-ring" onClick={() => { setMenu(false); onArchive(showing); }}>しまう(タブの後ろへ)</button>
                      : <button type="button" className="tc-focus-ring" onClick={() => { setMenu(false); onArchive(showing); }}>控えに戻す</button>}
                    <button type="button" className="tc-focus-ring is-danger" onClick={() => { setMenu(false); onDelete(showing); }}
                      data-testid="variant-delete">この案を消す</button>
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VariantBar;
