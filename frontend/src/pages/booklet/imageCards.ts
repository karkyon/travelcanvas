/**
 * [Gate P16] しおりの投影(booklet-v1)から画像のカードを組み立てる(FR-046、CA-004)。
 *
 * - 画像には機密項目を含めない(予約番号・住所・電話・参加者名はサーバーの投影で除外し、QR・チケットはそもそも含まれない)
 * - 範囲: 旅行全体 / 1日。予定(時刻・名前・場所の名前)と移動(出発・区間・所要時間)を載せる
 * - 生成日時・旅程の版(最新か)・含めていない情報をフッターに書き、古い投影には警告を付ける
 */
import type { Booklet, BookletDay } from '@/services/api';
import type { CardInput, CardSection } from '@/utils/cardImage';

export const EXCLUDED_NOTE = '予約番号・住所・電話・参加者名・QR・チケットは含めていません';

const MODE_LABEL: Record<string, string> = {
  walk: '徒歩', train: '電車', bus: 'バス', car: '車', taxi: 'タクシー', flight: '飛行機', ferry: '船', bicycle: '自転車',
  subway: '地下鉄', mixed: '乗り継ぎ',
};

function dayLabel(d: BookletDay): string {
  const date = new Date(`${d.date}T00:00:00Z`);
  const wd = Number.isNaN(date.getTime()) ? '' : `(${'日月火水木金土'[date.getUTCDay()]})`;
  return `${d.date}${wd}${d.title ? ` ${d.title}` : ''}`;
}

function daySection(b: Booklet, d: BookletDay): CardSection {
  // [並び順の鍵, 行]。終日・時刻未定は先頭、あとは時刻順(予定と移動を混ぜて並べる)
  const rows: Array<[string, string]> = [];
  for (const e of d.events) {
    const time = e.is_all_day ? '終日' : e.local_start_time ?? '時刻未定';
    rows.push([e.is_all_day || !e.local_start_time ? '' : e.local_start_time,
      `${time}  ${e.title}${e.place_name ? `(${e.place_name})` : ''}`]);
  }
  for (const t of b.schedule?.transport ?? []) {
    if (!t.departure || !t.departure.startsWith(d.date)) continue;
    const route = [t.from_label, t.to_label].filter(Boolean).join(' → ');
    const mins = t.duration_minutes !== null && t.duration_minutes !== undefined ? `・${t.duration_minutes}分` : '';
    rows.push([t.departure.slice(11, 16), `${t.departure.slice(11, 16)}  ${MODE_LABEL[t.mode] ?? t.mode}${route ? ` ${route}` : ''}${mins}`]);
  }
  const lines = rows.map((r, i) => [r[0], i, r[1]] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]).map((r) => r[2]);
  if (lines.length === 0) lines.push('予定はありません');
  return { heading: dayLabel(d), lines };
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** scope: 'trip' か、日付(YYYY-MM-DD) */
export function buildCard(b: Booklet, scope: string): CardInput {
  const days = b.schedule?.days ?? [];
  const chosen = scope === 'trip' ? days : days.filter((d) => d.date === scope);
  const cover = b.cover;
  const range = cover?.start_date ? `${cover.start_date}${cover.end_date && cover.end_date !== cover.start_date ? ` 〜 ${cover.end_date}` : ''}` : '';
  return {
    title: cover?.title ?? '旅のしおり',
    subtitle: [cover?.destination, scope === 'trip' ? range : chosen[0] ? dayLabel(chosen[0]) : ''].filter(Boolean).join('・') || ' ',
    sections: chosen.map((d) => daySection(b, d)),
    footer: [`生成 ${stamp(b.generated_at)}・旅程の版 r${b.input_revision}${b.is_stale ? '(古い)' : '(最新)'}`, EXCLUDED_NOTE],
    warning: b.is_stale ? '旅程がこの後に更新されています。最新の内容で作り直してください' : null,
  };
}

export function fileName(title: string, scope: string, page: number, pages: number): string {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'しおり';
  // 範囲はASCIIにする(一部のブラウザは非ASCIIのファイル名を捨てるため。旅行名はそのまま)
  const part = scope === 'trip' ? 'trip' : scope;
  return `${safe}_${part}${pages > 1 ? `_${page}of${pages}` : ''}.png`;
}
