/**
 * [Gate AreaAI2] AI が条件から選んだ方面の「選んだ理由」(特色・代表的な場所・希望に合う理由・注意・片道の目安)と、
 * [Gate AreaImages] 方面の代表画像(Wikipedia の記事の代表画像。出典のリンクつき。無ければ色の帯と絵)。
 */
import React from 'react';
import type { AreaImage, ExtractedArea } from '@/services/api/types/tripIntent';
import { minutesRange } from './consultModel';
import { asKind, KIND_META } from './placeKinds';
import UiIcon from '@/components/common/UiIcon';
import { safeExternalUrl } from '@/utils/safeNavigation';

export const AreaCover: React.FC<{ name: string; image: AreaImage | null | undefined; order?: number;
  fallback: { from: string; to: string }; className?: string }> = ({ name, image, order, fallback, className = 'h-20' }) => (
  <div className={`relative overflow-hidden rounded-lg ${className}`} data-testid={`area-cover-${name}`}
    style={{ background: `linear-gradient(135deg, ${fallback.from}, ${fallback.to})` }}>
    {image && <img src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
    {order !== undefined && <span className="absolute left-1 top-1 rounded bg-cloud-0 px-1 text-xs font-bold text-ink-900">{order}</span>}
    {image && safeExternalUrl(image.page_url) ? (
      <a href={safeExternalUrl(image.page_url) ?? undefined} target="_blank" rel="noreferrer noopener"
        className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 text-[9px] leading-4 text-white underline"
        title={`写真: Wikipedia「${image.title}」の代表画像`}>写真: Wikipedia</a>
    ) : (
      <span className="absolute bottom-1 left-1 right-1 rounded bg-cloud-0 px-1 text-[10px] text-ink-900" aria-hidden="true">イメージ</span>
    )}
  </div>
);

export const AreaInsight: React.FC<{ area: ExtractedArea; compact?: boolean; showRange?: boolean }> = ({
  area, compact = false, showRange = true }) => {
  const range = showRange ? minutesRange(area.minutes_min, area.minutes_max) : null;
  return (
    <div className="mt-1 space-y-1 text-xs text-ink-900" data-testid={`area-insight-${area.name}`}>
      {range && <p><b>片道の目安</b>{` ${range}(AI の目安 · 休憩・渋滞は含まない)`}</p>}
      {area.summary && <p><b>特色</b>{` ${area.summary}`}</p>}
      {(area.spots ?? []).length > 0 && (
        <div>
          <b>代表的な場所</b>
          <ul className={`mt-0.5 ${compact ? 'flex flex-wrap gap-1' : 'space-y-0.5'}`}>
            {(area.spots ?? []).map((s) => {
              const meta = KIND_META[asKind(s.kind)];
              return (
                <li key={s.name} className={compact ? 'rounded-full px-2 py-0.5' : 'flex items-start gap-1'}
                  style={compact ? { background: meta.bg, color: meta.fg } : undefined}>
                  <UiIcon icon={meta.icon} size={12} className="mt-0.5" />
                  <span>{compact ? s.name : <><b>{s.name}</b>{s.note ? ` — ${s.note}` : ''}<span className="text-ink-700">{`(${meta.label})`}</span></>}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {area.reason && <p><b>あなたの希望に合う理由</b>{` ${area.reason}`}</p>}
      {!area.summary && area.highlights && <p><b>見どころ</b>{` ${area.highlights}`}</p>}
      {area.caution && <p className="text-warning"><b>注意</b>{` ${area.caution}`}</p>}
    </div>
  );
};
