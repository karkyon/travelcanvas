/**
 * DesignCatalogPage - デザインの決まり(design tokens)と面の部品の一覧(/design-system、Gate G9 UX-1)。
 *
 * Storybook の代わりに、色・文字と地の組み合わせのコントラスト・面(glass / solid / quiet / critical)・角の丸み・影・
 * 余白・文字の大きさ・動きを1画面で確かめる(E2E で axe の検査をする)。明るい・暗いの見た目を切り替えられる
 * (暗い見た目はこの画面の中だけ。今の画面には当てない)。利用者のデータは含まない。
 */
import React, { useState } from 'react';
import Surface from '@/components/design/Surface';
import {
  SURFACES, TEXT_PAIRS, color, contrastRatio, motion, radius, safeAccent, shadow, space, type,
} from '@/styles/tokens';

const SURFACE_INFO: Record<string, { title: string; use: string }> = {
  glass: { title: 'glass(すりガラス)', use: '見出しの帯・旅行の切り替え・NOW/NEXT・浮かぶ操作だけ。背景の写真・模様の上に置く' },
  solid: { title: 'solid(不透明)', use: 'フォーム・表・チケット・長文。迷ったらこれ' },
  quiet: { title: 'quiet(控えめ)', use: '補足・ヒントのまとまり' },
  critical: { title: 'critical(止める問題)', use: '警告。色だけで伝えず、文字とアイコンも付ける' },
};

const SWATCHES: Array<[string, string]> = [
  ['Ink 900(本文)', color.ink900], ['Ink 700(補足)', color.ink700], ['Ink 500(弱い文字)', color.ink500],
  ['Cloud 0(白)', color.cloud0], ['Cloud 100', color.cloud100], ['Sand 100', color.sand100], ['Mist 50', color.mist50],
  ['強調色(journey accent)', color.accent], ['成功', color.success], ['注意', color.warning], ['危険', color.danger],
  ['情報', color.info],
];

const DesignCatalogPage: React.FC = () => {
  const [dark, setDark] = useState(false);
  const [accentInput, setAccentInput] = useState('#7dd3c8');
  const [moved, setMoved] = useState(false);
  const accent = safeAccent(accentInput);

  return (
    <div data-theme={dark ? 'dark' : 'light'} className="min-h-screen" style={{ fontFamily: type.body }}>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <header>
          <h1 style={{ fontFamily: type.display, fontSize: type.sizes['2xl'], color: 'var(--tc-ink-900)' }}>デザインの決まり</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--tc-ink-700)' }}>
            色・面・余白・文字・動きの決まりと部品の一覧です(UX-1)。今の画面の見た目はまだ変えていません。
          </p>
          <label className="inline-flex items-center gap-2 mt-3 text-sm" style={{ color: 'var(--tc-ink-900)' }}>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            暗い見た目で確かめる
          </label>
        </header>

        <Surface as="section" aria-labelledby="ds-colors">
          <h2 id="ds-colors" className="font-semibold">色</h2>
          <ul className="grid gap-3 grid-cols-2 sm:grid-cols-4 mt-3" aria-label="色の一覧">
            {SWATCHES.map(([name, hex]) => (
              <li key={name} className="text-sm">
                <span aria-hidden="true" className="block h-10 rounded-md border" style={{ background: hex, borderColor: color.cloud200 }} />
                <span className="block mt-1">{name}</span>
                <code className="text-xs tc-numeric">{hex}</code>
              </li>
            ))}
          </ul>
        </Surface>

        <Surface as="section" aria-labelledby="ds-contrast">
          <h2 id="ds-contrast" className="font-semibold">文字と地のコントラスト(WCAG 2.1 AA)</h2>
          <table className="w-full text-sm mt-2" aria-label="文字と地の組み合わせ">
            <thead>
              <tr className="text-left">
                <th scope="col" className="font-medium">組み合わせ</th>
                <th scope="col" className="font-medium">見本</th>
                <th scope="col" className="font-medium">比</th>
                <th scope="col" className="font-medium">基準</th>
              </tr>
            </thead>
            <tbody>
              {TEXT_PAIRS.map((p) => (
                <tr key={p.name} className="border-t" style={{ borderColor: 'var(--tc-cloud-200)' }}>
                  <th scope="row" className="font-normal">{p.name}</th>
                  <td><span className="px-2 py-0.5 rounded-sm" style={{ color: p.fg, background: p.bg }}>旅の行程 10:30</span></td>
                  <td className="tc-numeric">{`${contrastRatio(p.fg, p.bg).toFixed(2)} : 1`}</td>
                  <td>{`${p.min} 以上`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>

        <section aria-labelledby="ds-surfaces" className="tc-contour rounded-xl p-4">
          <h2 id="ds-surfaces" className="font-semibold" style={{ color: color.ink900 }}>面(surface)</h2>
          <div className="grid gap-4 sm:grid-cols-2 mt-3">
            {SURFACES.map((v) => (
              <Surface key={v} variant={v} as="article" aria-labelledby={`ds-surface-${v}`}>
                <h3 id={`ds-surface-${v}`} className="font-semibold">{SURFACE_INFO[v]!.title}</h3>
                <p className="text-sm mt-1" style={{ color: 'var(--tc-ink-700)' }}>{SURFACE_INFO[v]!.use}</p>
                {v === 'critical' && <p className="text-sm mt-1 font-medium" role="note">⚠ 最終の便に間に合いません</p>}
                {v === 'glass' && <p className="text-sm mt-1 tc-numeric">NOW 10:30 清水寺 / NEXT 12:00 昼食</p>}
              </Surface>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: color.ink700 }}>
            ぼかしを使えない環境・透明を減らす設定・強制の色では、glass は不透明の面になります。
          </p>
        </section>

        <Surface as="section" aria-labelledby="ds-shape">
          <h2 id="ds-shape" className="font-semibold">角の丸み・影・余白</h2>
          <div className="flex flex-wrap gap-4 mt-3" role="list" aria-label="角の丸みと影">
            {Object.entries(radius).map(([k, v]) => (
              <div key={k} role="listitem" className="text-xs text-center">
                <span aria-hidden="true" className="block w-16 h-12 border" style={{ borderRadius: v, borderColor: color.ink500 }} />
                {`角 ${k}: ${v}`}
              </div>
            ))}
            {Object.entries(shadow).map(([k, v]) => (
              <div key={k} role="listitem" className="text-xs text-center">
                <span aria-hidden="true" className="block w-16 h-12 rounded-md" style={{ boxShadow: v, background: 'var(--tc-surface-solid)' }} />
                {`影 ${k}`}
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-xs" aria-label="余白">
            {Object.entries(space).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-3 rounded-sm" style={{ width: v, background: color.accent }} />
                {`余白 ${k}: ${v}`}
              </li>
            ))}
          </ul>
        </Surface>

        <Surface as="section" aria-labelledby="ds-type">
          <h2 id="ds-type" className="font-semibold">文字</h2>
          {Object.entries(type.sizes).map(([k, v]) => (
            <p key={k} style={{ fontSize: v }}>{`${k} ${v} 旅を、確かな行程に。`}</p>
          ))}
          <p className="mt-2" style={{ fontFamily: type.display, fontSize: type.sizes.xl }}>見出しの書体(旅の冊子のような明朝)</p>
          <p className="tc-numeric">時刻・金額は桁をそろえる: 09:05 / 12:40 / ¥1,200 / ¥11,800</p>
        </Surface>

        <Surface as="section" aria-labelledby="ds-accent">
          <h2 id="ds-accent" className="font-semibold">旅行ごとの強調色(読みやすさの補正)</h2>
          <label htmlFor="ds-accent-input" className="block text-sm mt-2">表紙から取った色(例)</label>
          <input id="ds-accent-input" className="border rounded-sm px-2 py-1 text-sm tc-numeric" value={accentInput}
            onChange={(e) => setAccentInput(e.target.value)} />
          <p className="text-sm mt-2">
            {'白い地の上で文字に使う色: '}
            <code className="tc-numeric">{accent}</code>
            {`(${contrastRatio(accent, color.cloud0).toFixed(2)} : 1)`}
          </p>
          <p className="mt-1 px-2 py-1 rounded-sm inline-block" style={{ color: accent, background: color.cloud0, border: `1px solid ${color.cloud200}` }}>
            次の行程: 伏見稲荷 14:00
          </p>
        </Surface>

        <Surface as="section" aria-labelledby="ds-motion">
          <h2 id="ds-motion" className="font-semibold">動き</h2>
          <p className="text-sm mt-1">{`短い ${motion.fast}・標準 ${motion.base}。動きを減らす設定では止めます。`}</p>
          <button type="button" className="tc-focus-ring mt-2 px-3 py-1 rounded-md border text-sm"
            style={{ borderColor: color.ink500 }} onClick={() => setMoved((m) => !m)} aria-pressed={moved}>
            状態を切り替える
          </button>
          <div className="mt-2 h-8 rounded-md" style={{ width: moved ? '60%' : '20%', background: 'var(--tc-accent-soft)',
            transition: `width var(--tc-motion-base) var(--tc-motion-easing)` }} aria-hidden="true" />
        </Surface>
      </div>
    </div>
  );
};

export default DesignCatalogPage;
