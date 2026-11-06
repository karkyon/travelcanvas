/**
 * [Gate HeaderPicker] 見た目(端末に合わせる / 明るい / 暗い)の切り替え。上の帯の検索の右に 1 色の印で置く。
 * 以前はホームの見出しの横に大きな選択の欄があり、目立ちすぎていた。押すと 3 つの選択を小さく出す。
 * 選んだ値はこの端末に保存する(useThemePreference。全ての画面に効く)。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useThemePreference, type ThemePreference } from '../../hooks/useThemePreference';

const CHOICES: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'system', label: '端末に合わせる', icon: Monitor },
  { value: 'light', label: '明るい', icon: Sun },
  { value: 'dark', label: '暗い', icon: Moon },
];

const ThemeToggle: React.FC = () => {
  const { preference, setPreference } = useThemePreference();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = CHOICES.find((c) => c.value === preference) ?? CHOICES[0]!;
  const Icon = current.icon;

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={box}>
      <button type="button" className="tc-focus-ring tc-top-icon" aria-haspopup="true" aria-expanded={open}
        aria-label={`表示: ${current.label}(変える)`} title={`表示: ${current.label}`} data-testid="theme-toggle"
        onClick={() => setOpen((v) => !v)}>
        <Icon size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="tc-theme-menu" role="radiogroup" aria-label="表示" data-testid="theme-menu">
          {CHOICES.map((c) => {
            const I = c.icon;
            return (
              <button key={c.value} type="button" role="radio" aria-checked={preference === c.value}
                className="tc-focus-ring" data-testid={`theme-${c.value}`}
                onClick={() => { setPreference(c.value); setOpen(false); }}>
                <I size={15} aria-hidden="true" />{c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThemeToggle;
