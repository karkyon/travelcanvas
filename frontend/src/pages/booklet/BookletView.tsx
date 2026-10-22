/**
 * [Gate P4] しおりの描画(FR-034/035/046)。
 *
 * プレビュー・Web表示・印刷・PDF保存のすべてを、backendが返す同じしおり投影(booklet-v1)から描く。
 * - テーマは見た目だけを変え、載せる情報は変えない。白黒でも予定の種類・警告を文字で区別する(FC-089)
 * - 版の情報(版番号・作成時刻・情報の基準時刻・旅程revision・有効期限)と注意を本文の先頭に印字する(SC-26・EX-019)
 * - 機密情報を含む版は作成者名の透かしを全ページに入れる(FC-088)
 */
import React from 'react';
import type { Booklet, BookletExport, BookletTheme } from '@/services/api';
import { categoryLabel as expenseCategoryLabel, formatMoney } from '../expenses/financeModel';
import { categoryLabel as packingCategoryLabel } from '../preparation/preparationModel';
import type { ExpenseCategory, PackingCategory } from '@/services/api';
import {
  SECTION_LABEL, WARNING_TEXT, eventTypeLabel, formatDateTime, modeLabel, reservationStatusLabel,
  reservationTypeLabel, tocSections,
} from './bookletModel';
import './booklet.css';

interface ThemeStyle { root: string; heading: string; box: string }

const THEME_STYLE: Record<BookletTheme, ThemeStyle> = {
  simple: { root: 'bg-white text-gray-900', heading: 'text-gray-900 border-gray-300', box: 'border-gray-300' },
  cute: { root: 'bg-pink-50 text-gray-900', heading: 'text-pink-900 border-pink-300', box: 'border-pink-300 rounded-xl' },
  family: { root: 'bg-orange-50 text-gray-900', heading: 'text-orange-900 border-orange-300 text-2xl', box: 'border-orange-300 rounded-lg' },
  school: { root: 'bg-white text-gray-900', heading: 'text-blue-900 border-blue-400', box: 'border-blue-300' },
  business: { root: 'bg-white text-slate-900', heading: 'text-slate-900 border-slate-500', box: 'border-slate-300' },
  accessible: { root: 'bg-white text-black text-lg leading-relaxed', heading: 'text-black border-black border-b-2', box: 'border-black border-2' },
  mono: { root: 'bg-white text-black booklet-mono', heading: 'text-black border-black', box: 'border-black' },
};

interface Props {
  booklet: Booklet;
  /** 保存済みの版。null はプレビュー(保存されていない) */
  exportInfo: BookletExport | null;
}

const Section: React.FC<{ id: string; title: string; style: ThemeStyle; compact: boolean; children: React.ReactNode }> = ({
  id, title, style, compact, children,
}) => (
  <section className={`booklet-section ${compact ? 'mt-4' : 'mt-8'}`} aria-labelledby={`booklet-sec-${id}`}>
    <h2 id={`booklet-sec-${id}`} className={`font-bold border-b pb-1 mb-3 text-xl ${style.heading}`}>{title}</h2>
    {children}
  </section>
);

const BookletView: React.FC<Props> = ({ booklet: b, exportInfo }) => {
  const style = THEME_STYLE[b.theme];
  const compact = b.density === 'compact';
  const cur = b.costs?.base_currency ?? 'JPY';
  return (
    <article className={`booklet-root relative max-w-3xl mx-auto border shadow-xs ${compact ? 'p-4 text-sm' : 'p-8'} ${style.root} ${style.box}`}
      aria-label="しおり" data-testid="booklet" data-theme={b.theme}>
      {exportInfo?.watermark_text && (
        <div className="booklet-watermark" data-text={exportInfo.watermark_text} aria-hidden="true" data-testid="booklet-watermark" />
      )}

      <div className={`text-xs border rounded-sm p-2 mb-4 ${style.box}`} data-testid="booklet-stamp">
        <p>
          {exportInfo ? `第${exportInfo.version_no}版` : 'プレビュー(保存されていません)'}
          {` ・ 作成 ${formatDateTime(b.generated_at)}`}
          {` ・ 情報の基準 ${formatDateTime(b.data_as_of)}`}
          {` ・ 旅程の版 ${b.input_revision}`}
        </p>
        {exportInfo?.valid_until && <p className="font-bold">有効期限: {formatDateTime(exportInfo.valid_until)} まで</p>}
        {exportInfo?.watermark_text && <p className="font-bold">{exportInfo.watermark_text}(紛失・置き忘れに注意)</p>}
        {b.warnings.length > 0 && (
          <ul className="mt-1 list-disc pl-4" aria-label="注意">
            {b.warnings.map((w) => <li key={w}>【注意】{WARNING_TEXT[w]}</li>)}
          </ul>
        )}
      </div>

      {b.cover && (
        <header className={`booklet-cover text-center ${compact ? 'py-4' : 'py-12'}`}>
          <h1 className={`font-bold ${b.theme === 'accessible' || b.theme === 'family' ? 'text-4xl' : 'text-3xl'}`}>{b.cover.title}</h1>
          {b.cover.destination && <p className="mt-2 text-lg">{b.cover.destination}</p>}
          <p className="mt-2">
            {b.cover.start_date ?? '日付未定'}{b.cover.end_date && b.cover.end_date !== b.cover.start_date ? ` 〜 ${b.cover.end_date}` : ''}
          </p>
          <p className="mt-1 text-sm">{b.cover.day_count}日間 ・ {b.cover.member_count}人</p>
        </header>
      )}

      {b.sections.includes('toc') && (
        <nav aria-labelledby="booklet-toc" className="booklet-section mt-6">
          <h2 id="booklet-toc" className={`font-bold border-b pb-1 mb-2 text-xl ${style.heading}`}>目次</h2>
          <ol className="list-decimal pl-6">
            {tocSections(b.sections).map((s) => (
              <li key={s}><a href={`#booklet-sec-${s}`} className="underline">{SECTION_LABEL[s]}</a></li>
            ))}
          </ol>
        </nav>
      )}

      {b.schedule && (
        <Section id="schedule" title="日程" style={style} compact={compact}>
          {b.schedule.days.length === 0 ? <p>日程はまだありません。</p> : b.schedule.days.map((d) => (
            <div key={d.date} className="mb-4">
              <h3 className="font-bold text-lg">{d.date}{d.title ? ` ${d.title}` : ''}<span className="ml-2 text-xs font-normal">({d.timezone_id})</span></h3>
              {d.events.length === 0 ? <p className="text-sm">予定はありません。</p> : (
                <ul className="mt-1 space-y-1">
                  {d.events.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-14 shrink-0 font-mono">{e.is_all_day ? '終日' : (e.local_start_time ?? '--:--')}</span>
                      <span>
                        <span className={`text-xs border px-1 mr-1 ${style.box}`}>{eventTypeLabel(e.event_type)}</span>
                        <span className="font-medium">{e.title}</span>
                        {e.locked && <span className="ml-1 text-xs">(確定)</span>}
                        {(e.place_name || e.address) && (
                          <span className="block text-sm">場所: {[e.place_name, e.address].filter(Boolean).join(' / ')}</span>
                        )}
                        {e.reservations.map((r, j) => (
                          <span key={j} className="block text-sm">
                            予約: {reservationTypeLabel(r.type)} {r.provider_name ?? ''}({reservationStatusLabel(r.status)})
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {b.schedule.transport.length > 0 && (
            <>
              <h3 className="font-bold mt-4">移動</h3>
              <table className="w-full text-sm mt-1">
                <thead><tr className="border-b text-left"><th className="py-1 pr-2">手段</th><th className="pr-2">区間</th><th className="pr-2">出発</th><th className="pr-2">到着</th><th>便名・番線</th></tr></thead>
                <tbody>
                  {b.schedule.transport.map((t, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-1 pr-2">{modeLabel(t.mode)}{t.is_estimate ? '(目安)' : ''}</td>
                      <td className="pr-2">{t.from_label ?? '?'} → {t.to_label ?? '?'}</td>
                      <td className="pr-2">{t.departure ?? '未定'}</td>
                      <td className="pr-2">{t.arrival ?? '未定'}</td>
                      <td>{[t.transport_number, t.platform && `${t.platform}番線`].filter(Boolean).join(' ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
      )}

      {b.map && (
        <Section id="map" title="地図(場所の一覧)" style={style} compact={compact}>
          <p className="text-sm mb-2">地図の画像は含めていません。訪れる場所を日付順に載せています。</p>
          {b.map.places.length === 0 ? <p>場所はまだありません。</p> : (
            <ol className="list-decimal pl-6">
              {b.map.places.map((p, i) => (
                <li key={i}>
                  {p.label}{p.date ? `(${p.date})` : ''}
                  {p.address && <span className="block text-sm">{p.address}</span>}
                  {p.latitude != null && p.longitude != null && <span className="block text-xs">緯度 {p.latitude} / 経度 {p.longitude}</span>}
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}

      {b.reservations && (
        <Section id="reservations" title="予約" style={style} compact={compact}>
          {b.reservations.length === 0 ? <p>予約はありません。</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left"><th className="py-1 pr-2">種類</th><th className="pr-2">名称・状態</th><th className="pr-2">日時</th><th className="pr-2">予約番号</th><th>連絡先・取消期限</th></tr></thead>
              <tbody>
                {b.reservations.map((r, i) => (
                  <tr key={i} className="border-b align-top">
                    <td className="py-1 pr-2">{reservationTypeLabel(r.type)}</td>
                    <td className="pr-2">{r.provider_name ?? '—'}<span className="block text-xs">{reservationStatusLabel(r.status)}{r.guest_count ? ` ・ ${r.guest_count}名` : ''}</span></td>
                    <td className="pr-2">{r.start ?? '未定'}{r.end ? ` 〜 ${r.end}` : ''}</td>
                    <td className="pr-2 font-mono">{r.confirmation ?? '—'}{r.confirmation && !r.confirmation_is_full && <span className="block text-xs font-sans">(一部を伏せています)</span>}</td>
                    <td>
                      {r.contact_phone && <span className="block">電話 {r.contact_phone}</span>}
                      {r.cancellation_deadline && <span className="block text-xs">取消期限 {r.cancellation_deadline}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {b.packing && (
        <Section id="packing" title="持ち物(共有)" style={style} compact={compact}>
          {b.packing.length === 0 ? <p>共有の持ち物はありません。</p> : (
            <ul className="columns-1 sm:columns-2">
              {b.packing.map((p, i) => (
                <li key={i} className="break-inside-avoid">
                  <span className="booklet-checkbox" aria-hidden="true" />
                  {p.name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}
                  <span className="text-xs ml-1">({packingCategoryLabel(p.category as PackingCategory)}{p.is_required ? '・必須' : ''})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs mt-2">個人の持ち物は載せていません。</p>
        </Section>
      )}

      {b.contacts && (
        <Section id="contacts" title="連絡先" style={style} compact={compact}>
          <p>参加者: {b.contacts.members ? b.contacts.members.join('、') : `${b.contacts.member_count}人(名前は載せていません)`}</p>
          {b.contacts.reservation_contacts ? (
            b.contacts.reservation_contacts.length === 0 ? <p className="mt-1">予約先の電話番号は登録されていません。</p> : (
              <ul className="mt-1">
                {b.contacts.reservation_contacts.map((c, i) => (
                  <li key={i}>{reservationTypeLabel(c.type)} {c.provider_name ?? ''}: {c.phone}{c.url ? ` (${c.url})` : ''}</li>
                ))}
              </ul>
            )
          ) : <p className="mt-1 text-sm">予約先の電話番号は載せていません。</p>}
        </Section>
      )}

      {b.costs && (
        <Section id="costs" title="費用" style={style} compact={compact}>
          <p>
            予算 {b.costs.budget_total ? formatMoney(b.costs.budget_total, cur) : '未設定'} ・ 実績 {formatMoney(b.costs.actual_total, cur)}
            {b.costs.over && <strong className="ml-1">【超過】</strong>}
          </p>
          {b.costs.by_category.length > 0 && (
            <table className="w-full text-sm mt-2">
              <thead><tr className="border-b text-left"><th className="py-1 pr-2">カテゴリ</th><th className="pr-2 text-right">予算</th><th className="text-right">実績</th></tr></thead>
              <tbody>
                {b.costs.by_category.map((c) => (
                  <tr key={c.category} className="border-b">
                    <td className="py-1 pr-2">{expenseCategoryLabel(c.category as ExpenseCategory)}</td>
                    <td className="pr-2 text-right">{c.budget ? formatMoney(c.budget, cur) : '—'}</td>
                    <td className="text-right">{formatMoney(c.actual, cur)}{c.over ? ' 【超過】' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {b.costs.unconverted_expenses > 0 && <p className="text-sm mt-1">換算できない外貨の支出{b.costs.unconverted_expenses}件は合計に含みません。</p>}
        </Section>
      )}

      {b.notes && (
        <Section id="notes" title="注意事項" style={style} compact={compact}>
          <ul className="list-disc pl-6">{b.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Section>
      )}
    </article>
  );
};

export default BookletView;
