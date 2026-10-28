/**
 * [Gate G11] 設定 → 表示 の「見た目の系統」(仕様 §3.4)。標準・Atlas・Editorial・Daylight・Studio から1つを選ぶ
 * (明るい・暗い・端末に合わせる とは別の軸)。選ぶとすぐこの端末に当て、会員はアカウントにも保存する
 * (別の端末でも同じ系統になる)。保存に失敗しても端末には当たったままにし、その旨を知らせる。
 */
import React, { useState } from 'react';
import { useStylePreference } from '@/hooks/useThemePreference';
import { useAuthStore } from '@/store/authStore';
import { api as apiService } from '@/services/api';
import { STYLE_IDS, STYLE_PREF_KEY, type StyleId } from '@/styles/styleIds';
import { STYLE_META, STYLE_TOKENS, color } from '@/styles/tokens';

function swatch(id: StyleId): { page: string; accent: string } {
  if (id === 'standard') return { page: color.cloud50, accent: color.accent };
  return { page: STYLE_TOKENS[id].page, accent: STYLE_TOKENS[id].light.accent };
}

export interface StylePickerProps {
  /** 選んだ時に呼ぶ(設定の画面の保存の内容をそろえるため) */
  onChange?: (style: StyleId) => void;
}

const StylePicker: React.FC<StylePickerProps> = ({ onChange }) => {
  const { style, setStyle } = useStylePreference();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'local' | 'error'>('idle');

  const choose = async (next: StyleId) => {
    setStyle(next);
    onChange?.(next);
    const { user, isGuest } = useAuthStore.getState();
    if (!user || isGuest) {
      setStatus('local');
      return;
    }
    // アカウントの値を先にそろえる(ThemeRoot がアカウントの値を優先するため、古い値へ戻さない)
    useAuthStore.setState({ user: { ...user, ui_style: next, preferences: { ...(user.preferences ?? {}), [STYLE_PREF_KEY]: next } } });
    setStatus('saving');
    try {
      await apiService.updateProfile({ preferences: { [STYLE_PREF_KEY]: next } });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = STYLE_IDS.indexOf(style);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % STYLE_IDS.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + STYLE_IDS.length) % STYLE_IDS.length;
    if (j < 0) return;
    e.preventDefault();
    const next = STYLE_IDS[j]!;
    void choose(next);
    (e.currentTarget.querySelector<HTMLElement>(`[data-style-option="${next}"]`))?.focus();
  };

  return (
    <fieldset className="md:col-span-2">
      <legend id="settings-style-label" className="block text-sm font-medium text-ink-700 mb-1">見た目の系統</legend>
      <p id="settings-style-help" className="text-xs text-ink-500 mb-2">
        色・角の丸み・見出しの書体・ボタンの大きさが変わります。画面の並びや機能は変わりません。明るい・暗いの設定と組み合わせて使えます。
      </p>
      <div role="radiogroup" aria-labelledby="settings-style-label" aria-describedby="settings-style-help"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" onKeyDown={onKey}>
        {STYLE_IDS.map((id) => {
          const sw = swatch(id);
          const selected = style === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
              data-style-option={id} onClick={() => void choose(id)}
              className={`flex items-start gap-3 text-left rounded-lg border px-3 py-2 min-h-11 bg-cloud-0 ${
                selected ? 'border-accent ring-2 ring-accent' : 'border-cloud-200 hover:border-ink-500'}`}>
              <span aria-hidden="true" className="mt-0.5 flex shrink-0 overflow-hidden rounded-md border border-cloud-200">
                <span className="block h-8 w-5" style={{ backgroundColor: sw.page }} />
                <span className="block h-8 w-5" style={{ backgroundColor: sw.accent }} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-900">
                  {STYLE_META[id].label}{selected && <span className="ml-2 text-xs font-medium text-accent">✓ 選択中</span>}
                </span>
                <span className="block text-xs text-ink-700">{STYLE_META[id].description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-ink-700">
        {status === 'saving' && 'アカウントに保存しています…'}
        {status === 'saved' && 'この端末に当て、アカウントにも保存しました(ほかの端末でも同じ見た目になります)'}
        {status === 'local' && 'この端末に当てました(ログインするとアカウントにも保存できます)'}
        {status === 'error' && 'この端末には当てましたが、アカウントへの保存に失敗しました。通信を確かめて、もう一度選んでください'}
      </p>
    </fieldset>
  );
};

export default StylePicker;
