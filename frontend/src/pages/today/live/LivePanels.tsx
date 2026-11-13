/**
 * [Gate TDay] 画面の中の知らせ(出発の合図・着きましたか・雨の兆し・遅延・寄り道)。画面の上に重ねて出す。
 * 閉じたものは同じ日に二度出さない。
 */
import React from 'react';
import { AlertTriangle, BookOpen, CloudRain, X, Clock, Footprints } from 'lucide-react';
import type { LiveNotice } from './todayLive';

// ---- 画面の中の知らせ ------------------------------------------------------------------------------------------

export const LiveNotices: React.FC<{ items: LiveNotice[]; onDismiss: (key: string) => void }> = ({ items, onDismiss }) => {
  if (items.length === 0) return null;
  const icon = { go: <Clock size={20} />, arrive: <BookOpen size={20} />, rain: <CloudRain size={20} />, delay: <AlertTriangle size={20} />,
    detour: <Footprints size={20} /> };
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
