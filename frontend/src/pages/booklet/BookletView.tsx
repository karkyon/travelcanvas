/**
 * [Gate P4 / BookletPatterns] しおりの描画(FR-034/035/046)。
 *
 * プレビュー・Web表示・印刷・PDF保存のすべてを、backendが返す同じしおり投影から描く。
 * - デザイン(12 パターン + 3)は見た目と見出しの言葉だけを変え、載せる情報は変えない。
 *   タイトル・日程・エリア・地図・大日程・日別の行程表は、共有の設定で隠されていない限り必ず載る
 * - 色・枠・字体・並べ方は booklet.css の .bk--<テーマ>。白黒でも予定の種類・警告を文字で区別する(FC-089)
 * - 版の情報(版番号・作成時刻・情報の基準時刻・旅程revision・有効期限)と注意を本文の先頭に印字する(SC-26・EX-019)
 * - 機密情報を含む版は作成者名の透かしを全ページに入れる(FC-088)
 */
import React, { useEffect, useMemo } from 'react';
import type { Booklet, BookletExport, BookletPoint, BookletSection } from '@/services/api';
import { categoryLabel as expenseCategoryLabel, formatMoney } from '../expenses/financeModel';
import { categoryLabel as packingCategoryLabel } from '../preparation/preparationModel';
import type { ExpenseCategory, PackingCategory } from '@/services/api';
import BookletCover from './BookletCover';
import { safeExternalUrl } from '@/utils/safeNavigation';
import LocalQrCode from '@/components/share/LocalQrCode';
import BookletMap from './BookletMap';
import {
  MY_MAP_URL, SECTION_LABEL, WARNING_TEXT, buildOverview, googleDayRoutes, buildTimeline, clock, eventTypeLabel, formatDateTime, modeLabel, reservationStatusLabel,
  reservationTypeLabel, shortDate, tocSections, unplacedMoves,
} from './bookletModel';
import { THEME_WORDS, fontUrl } from './bookletThemes';
import './booklet.css';

interface Props {
  booklet: Booklet;
  /** 保存済みの版。null はプレビュー(保存されていない) */
  exportInfo: BookletExport | null;
  /** [Gate BookletWeb] 版の表示の文を変える(Web で公開したページ) */
  stampLabel?: string;
  /** [Gate BookletPatterns] A4 の幅で見る(印刷のイメージ) */
  sheet?: boolean;
}

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section className={`booklet-section bk-sec bk-sec--${id}`} aria-labelledby={`booklet-sec-${id}`}>
    <h2 id={`booklet-sec-${id}`} className="bk-h2">{title}</h2>
    {children}
  </section>
);

/** [Gate BookletQR] 紙では QR を読み、画面ではそのまま押せる */
const MapQr: React.FC<{ url: string; title: string; size?: number; note?: string }> = ({ url, title, size = 112, note }) => (
  <a className="bk-qr" href={safeExternalUrl(url) ?? undefined} target="_blank" rel="noopener noreferrer" data-testid="booklet-map-qr">
    <LocalQrCode value={url} size={size} label={`${title}を Google マップで開く QR コード`} />
    <span className="bk-qr-text"><b>{title}</b>{note && <small>{note}</small>}</span>
  </a>
);

/** デザインの字体を使う時だけ読み込む。読めない時は端末の字体で表示・印刷できる */
function useThemeFont(theme: Booklet['theme']) {
  useEffect(() => {
    const id = `bk-font-${theme}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = fontUrl(theme);
    document.head.appendChild(link);
  }, [theme]);
}

const BookletView: React.FC<Props> = ({ booklet: b, exportInfo, stampLabel, sheet = false }) => {
  useThemeFont(b.theme);
  useEffect(() => {
    // 印刷のページの余白にもデザインの地の色を敷く(booklet.css)
    document.documentElement.dataset.bookletTheme = b.theme;
    return () => { delete document.documentElement.dataset.bookletTheme; };
  }, [b.theme]);
  const words = THEME_WORDS[b.theme];
  const title = (s: BookletSection) => words.sections[s] ?? SECTION_LABEL[s];
  const compact = b.density === 'compact';
  const cur = b.costs?.base_currency ?? 'JPY';
  const overview = useMemo(() => buildOverview(b), [b]);
  const days = useMemo(() => b.schedule?.days ?? [], [b.schedule]);
  const dayIndex = useMemo(() => new Map(days.map((d, i) => [d.date, i])), [days]);
  const points: BookletPoint[] = useMemo(() => b.map?.points ?? [], [b.map]);
  const byNo = useMemo(() => new Map(points.map((p) => [p.no, p])), [points]);
  const colorOf = (p: BookletPoint) => dayIndex.get(p.date ?? '') ?? 0;
  const routes = days.map((d, i) => ({
    color: i, nos: d.events.map((e) => e.map_no).filter((n): n is number => typeof n === 'number'),
  }));
  const unlocated = (b.map?.places ?? []).filter((p) => !points.some((q) => q.label === p.label));
  const stopsOf = (d: (typeof days)[number]) => d.events.map((e) => (typeof e.map_no === 'number' ? byNo.get(e.map_no) : undefined)).filter((p): p is BookletPoint => !!p);
  const myMap = b.map?.my_map_url && MY_MAP_URL.test(b.map.my_map_url) ? b.map.my_map_url : null;
  const leftover = b.schedule ? unplacedMoves(days, b.schedule.transport) : [];
  return (
    <article className={`booklet-root bk bk--${b.theme}${compact ? ' bk--compact' : ''}${sheet ? ' bk--sheet' : ''}`}
      aria-label="しおり" data-testid="booklet" data-theme={b.theme}>
      {exportInfo?.watermark_text && (
        <div className="booklet-watermark" data-text={exportInfo.watermark_text} aria-hidden="true" data-testid="booklet-watermark" />
      )}

      {b.cover && <BookletCover cover={b.cover} theme={b.theme} />}

      <div className="bk-body">
      <div className="bk-stamp" data-testid="booklet-stamp">
        <p>
          {stampLabel ?? (exportInfo ? `第${exportInfo.version_no}版` : 'プレビュー(保存されていません)')}
          {` ・ 作成 ${formatDateTime(b.generated_at)}`}
          {` ・ 情報の基準 ${formatDateTime(b.data_as_of)}`}
          {` ・ 旅程の版 ${b.input_revision}`}
        </p>
        {exportInfo?.valid_until && <p className="bk-strong">有効期限: {formatDateTime(exportInfo.valid_until)} まで</p>}
        {exportInfo?.watermark_text && <p className="bk-strong">{exportInfo.watermark_text}(紛失・置き忘れに注意)</p>}
        {b.warnings.length > 0 && (
          <ul aria-label="注意">
            {b.warnings.map((w) => <li key={w}>【注意】{WARNING_TEXT[w]}</li>)}
          </ul>
        )}
      </div>

      {b.sections.includes('toc') && (
        <nav aria-labelledby="booklet-toc" className="booklet-section bk-sec bk-toc">
          <h2 id="booklet-toc" className="bk-h2">目次</h2>
          <ol>
            {b.schedule && <li><a href="#booklet-sec-overview">{words.overview}</a></li>}
            {tocSections(b.sections).map((s) => (
              <li key={s}><a href={`#booklet-sec-${s}`}>{s === 'schedule' ? words.schedule : title(s)}</a></li>
            ))}
          </ol>
        </nav>
      )}

      {b.schedule && (
        <Section id="overview" title={words.overview}>
          {b.cover && <p className="bk-lead">エリア: {b.cover.destination ?? '未設定'}</p>}
          {overview.length === 0 ? <p>日程はまだありません。</p> : (
            <table className="bk-ov">
              <thead><tr><th scope="col">日</th><th scope="col">日付</th><th scope="col">主な予定</th><th scope="col">宿</th></tr></thead>
              <tbody>
                {overview.map((r) => (
                  <tr key={r.date}>
                    <th scope="row"><span className="bk-daydot" style={{ background: `var(--bk-d${(r.no - 1) % 6})` }} aria-hidden="true" />{words.day(r.no)}</th>
                    <td className="bk-ov-date">{shortDate(r.date)}</td>
                    <td>
                      {r.title && <b className="bk-ov-title">{r.title}</b>}
                      {r.highlights.length ? r.highlights.join(' → ') : '予定はありません'}{r.more > 0 ? ` ほか${r.more}件` : ''}
                    </td>
                    <td>{r.stay ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {b.map && (
        <Section id="map" title={title('map')}>
          {points.length > 0 ? (
            <BookletMap points={points} routes={routes} colorOf={colorOf} label={`旅行全体の地図。${points.map((p) => `${p.no} ${p.label}`).join('、')}`} />
          ) : <p>地図に載せられる場所はまだありません(場所の座標がありません)。場所の一覧だけを載せます。</p>}
          {myMap && (
            <div className="bk-qrs"><MapQr url={myMap} title="マイマップ" note="Google マイマップで旅行全体を見る" /></div>
          )}
          {points.length > 0 && (
            <ol className="bk-legend">
              {points.map((p) => (
                <li key={p.no}><span className="bk-pin" style={{ background: `var(--bk-d${colorOf(p) % 6})` }}>{p.no}</span>{p.label}{p.date ? <span className="bk-muted"> {shortDate(p.date)}</span> : null}</li>
              ))}
            </ol>
          )}
          {(unlocated.length > 0 || b.map.places.some((p) => p.address)) && (
            <ul className="bk-places">
              {b.map.places.filter((p) => p.address || unlocated.includes(p)).map((p, i) => (
                <li key={i}>
                  {p.label}{p.date ? `(${p.date})` : ''}
                  {p.address && <span className="bk-sub">{p.address}</span>}
                  {p.latitude != null && p.longitude != null && <span className="bk-sub">緯度 {p.latitude} / 経度 {p.longitude}</span>}
                </li>
              ))}
            </ul>
          )}
          {points.length > 0 && b.map.coordinates_rounded && <p className="bk-note">住所を含めない版のため、ピンの位置は約 100m の精度に丸めています。</p>}
        </Section>
      )}

      {b.schedule && (
        <Section id="schedule" title={words.schedule}>
          {days.length === 0 ? <p>日程はまだありません。</p> : days.map((d, i) => {
            const nos = [...new Set(d.events.map((e) => e.map_no).filter((n): n is number => typeof n === 'number'))];
            const dayPoints = nos.map((n) => byNo.get(n)).filter((p): p is BookletPoint => !!p);
            return (
              <div key={d.date} className="bk-day" style={{ '--bk-day': `var(--bk-d${i % 6})` } as React.CSSProperties}>
                <h3 className="bk-day-h">
                  <span className="bk-day-no">{words.day(i + 1)}</span>
                  <span className="bk-day-date">{shortDate(d.date)}</span>
                  {d.title && <span className="bk-day-title">{d.title}</span>}
                  {d.timezone_id !== 'Asia/Tokyo' && <span className="bk-day-tz">{d.timezone_id}</span>}
                </h3>
                {dayPoints.length >= 2 && !compact && (
                  <BookletMap points={dayPoints} height={250} routes={[{ color: i, nos: d.events.map((e) => e.map_no).filter((n): n is number => typeof n === 'number') }]}
                    colorOf={() => i} label={`${shortDate(d.date)}の地図。${dayPoints.map((p) => `${p.no} ${p.label}`).join('、')}`} />
                )}
                {(() => {
                  const routes = googleDayRoutes(stopsOf(d));
                  return routes.length > 0 ? (
                    <div className="bk-qrs">
                      {routes.map((url, n) => (
                        <MapQr key={url} url={url} size={124} title={`${words.day(i + 1)}の経路${routes.length > 1 ? ` ${n + 1}/${routes.length}` : ''}`}
                          note="読み取ると Google マップで、この日の順路が開きます" />
                      ))}
                    </div>
                  ) : null;
                })()}
                {d.events.length === 0 ? <p>予定はありません。</p> : (
                  <ul className="bk-events">
                    {buildTimeline(d, b.schedule!.transport).map((item, j) => (item.kind === 'move' ? (
                      <li key={j} className="bk-move">
                        <span className="bk-move-time">{clock(item.move.departure)}</span>
                        <span>
                          {modeLabel(item.move.mode)}{item.move.is_estimate ? '(目安)' : ''}
                          {item.move.duration_minutes != null ? ` ${item.move.duration_minutes}分` : ''}
                          {` ・ ${item.move.from_label ?? '?'} → ${item.move.to_label ?? '?'}`}
                          {item.move.arrival ? ` ・ ${clock(item.move.arrival)} 着` : ''}
                          {[item.move.transport_number, item.move.platform && `${item.move.platform}番線`].filter(Boolean).map((x) => ` ・ ${x}`).join('')}
                        </span>
                      </li>
                    ) : (
                      <li key={j} className="bk-ev">
                        <div className="bk-ev-time">
                          {item.event.is_all_day ? '終日' : (clock(item.event.local_start_time) || '--:--')}
                          {item.event.end && <small>〜{clock(item.event.end)}</small>}
                        </div>
                        <div className="bk-ev-main">
                          <div className="bk-ev-title">
                            {typeof item.event.map_no === 'number' && <span className="bk-pin" style={{ background: 'var(--bk-day)' }}>{item.event.map_no}</span>}
                            <b>{item.event.title}</b>
                            <span className="bk-tag">{eventTypeLabel(item.event.event_type)}</span>
                            {item.event.locked && <span className="bk-tag">確定</span>}
                          </div>
                          {(item.event.place_name || item.event.address) && (
                            <span className="bk-sub">場所: {[item.event.place_name, item.event.address].filter(Boolean).join(' / ')}</span>
                          )}
                          {item.event.reservations.map((r, k) => (
                            <span key={k} className="bk-sub">予約: {reservationTypeLabel(r.type)} {r.provider_name ?? ''}({reservationStatusLabel(r.status)})</span>
                          ))}
                        </div>
                      </li>
                    )))}
                  </ul>
                )}
              </div>
            );
          })}
          {leftover.length > 0 && (
            <>
              <h3 className="bk-h3">移動(日時が未定のもの)</h3>
              <div className="bk-scroll"><table className="bk-table">
                <thead><tr><th>手段</th><th>区間</th><th>出発</th><th>到着</th><th>便名・番線</th></tr></thead>
                <tbody>
                  {leftover.map((t, i) => (
                    <tr key={i}>
                      <td>{modeLabel(t.mode)}{t.is_estimate ? '(目安)' : ''}</td>
                      <td>{t.from_label ?? '?'} → {t.to_label ?? '?'}</td>
                      <td>{t.departure ?? '未定'}</td>
                      <td>{t.arrival ?? '未定'}</td>
                      <td>{[t.transport_number, t.platform && `${t.platform}番線`].filter(Boolean).join(' ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
        </Section>
      )}

      {b.reservations && (
        <Section id="reservations" title={title('reservations')}>
          {b.reservations.length === 0 ? <p>予約はありません。</p> : (
            <div className="bk-scroll"><table className="bk-table">
              <thead><tr><th>種類</th><th>名称・状態</th><th>日時</th><th>予約番号</th><th>連絡先・取消期限</th></tr></thead>
              <tbody>
                {b.reservations.map((r, i) => (
                  <tr key={i}>
                    <td>{reservationTypeLabel(r.type)}</td>
                    <td>{r.provider_name ?? '—'}<span className="bk-sub">{reservationStatusLabel(r.status)}{r.guest_count ? ` ・ ${r.guest_count}名` : ''}</span></td>
                    <td>{r.start ?? '未定'}{r.end ? ` 〜 ${r.end}` : ''}</td>
                    <td className="bk-code">{r.confirmation ?? '—'}{r.confirmation && !r.confirmation_is_full && <span className="bk-sub">(一部を伏せています)</span>}</td>
                    <td>
                      {r.contact_phone && <span className="bk-sub">電話 {r.contact_phone}</span>}
                      {r.cancellation_deadline && <span className="bk-sub">取消期限 {r.cancellation_deadline}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Section>
      )}

      {b.packing && (
        <Section id="packing" title={title('packing')}>
          {b.packing.length === 0 ? <p>共有の持ち物はありません。</p> : (
            <ul className="bk-packing">
              {b.packing.map((p, i) => (
                <li key={i}>
                  <span className="booklet-checkbox" aria-hidden="true" />
                  {p.name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}
                  <span>({packingCategoryLabel(p.category as PackingCategory)}{p.is_required ? '・必須' : ''})</span>
                </li>
              ))}
            </ul>
          )}
          <p>個人の持ち物は載せていません。</p>
        </Section>
      )}

      {b.contacts && (
        <Section id="contacts" title={title('contacts')}>
          <p>参加者: {b.contacts.members ? b.contacts.members.join('、') : `${b.contacts.member_count}人(名前は載せていません)`}</p>
          {b.contacts.reservation_contacts ? (
            b.contacts.reservation_contacts.length === 0 ? <p>予約先の電話番号は登録されていません。</p> : (
              <ul>
                {b.contacts.reservation_contacts.map((c, i) => (
                  <li key={i}>{reservationTypeLabel(c.type)} {c.provider_name ?? ''}: {c.phone}{c.url ? ` (${c.url})` : ''}</li>
                ))}
              </ul>
            )
          ) : <p>予約先の電話番号は載せていません。</p>}
        </Section>
      )}

      {b.costs && (
        <Section id="costs" title={title('costs')}>
          <p>
            予算 {b.costs.budget_total ? formatMoney(b.costs.budget_total, cur) : '未設定'} ・ 実績 {formatMoney(b.costs.actual_total, cur)}
            {b.costs.over && <strong>【超過】</strong>}
          </p>
          {b.costs.by_category.length > 0 && (
            <table className="bk-table">
              <thead><tr><th>カテゴリ</th><th className="bk-num">予算</th><th className="bk-num">実績</th></tr></thead>
              <tbody>
                {b.costs.by_category.map((c) => (
                  <tr key={c.category}>
                    <td>{expenseCategoryLabel(c.category as ExpenseCategory)}</td>
                    <td className="bk-num">{c.budget ? formatMoney(c.budget, cur) : '—'}</td>
                    <td className="bk-num">{formatMoney(c.actual, cur)}{c.over ? ' 【超過】' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {b.costs.unconverted_expenses > 0 && <p>換算できない外貨の支出{b.costs.unconverted_expenses}件は合計に含みません。</p>}
        </Section>
      )}

      {b.notes && (
        <Section id="notes" title={title('notes')}>
          <ul>{b.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Section>
      )}
      </div>
    </article>
  );
};

export default BookletView;
