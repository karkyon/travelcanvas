/**
 * SharedPlanView - 共有リンクの閲覧者に見える内容(公開閲覧 /s/:token と、所有者の共有前プレビューで共通)。
 *
 * [Gate F45] FR-045 項目単位の共有の規則。backend(app/api/v1/public_share.py build_public_view)が
 * 許可した項目だけを返すので、届いた項目をそのまま表示する(画面側で隠すのではない)。
 * - 日程の見出しが届かない時は日付で見出しを作る
 * - 住所・メモ・予約の概要は所有者が選んだ時だけ届く
 */
import React from 'react';
import { Calendar, MapPin } from 'lucide-react';
import type { PublicSharedPlan } from '@/services/api';
import { reservationStatusLabel, reservationTypeLabel } from '@/pages/booklet/bookletModel';

interface Props {
  plan: PublicSharedPlan;
  /** 旅行名の見出しの階層。日程はその1つ下 */
  titleLevel?: 1 | 2 | 3;
}

const Heading: React.FC<{ level: number; className?: string; children: React.ReactNode }> = ({ level, className, children }) =>
  React.createElement(`h${Math.min(6, Math.max(1, level))}`, { className }, children);

const dayHeading = (date: string | null, title: string | null, idx: number): string =>
  title || (date ? new Date(date).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }) : `${idx + 1}日目`);

const SharedPlanView: React.FC<Props> = ({ plan, titleLevel = 1 }) => {
  const days = plan.days || [];
  const reservations = plan.reservations;
  return (
    <div>
      <Heading level={titleLevel} className={titleLevel === 1 ? 'text-3xl font-bold text-gray-900 mb-3' : 'text-xl font-bold text-gray-900 mb-2'}>
        {plan.title}
      </Heading>
      <div className="flex flex-wrap items-center gap-4 text-gray-700 text-sm mb-6">
        {plan.destination && (
          <span className="flex items-center gap-1">
            <MapPin size={16} aria-hidden="true" />
            {plan.destination}
          </span>
        )}
        {(plan.start_date || plan.end_date) && (
          <span className="flex items-center gap-1">
            <Calendar size={16} aria-hidden="true" />
            {plan.start_date ? new Date(plan.start_date).toLocaleDateString('ja-JP') : '未定'}
            {' 〜 '}
            {plan.end_date ? new Date(plan.end_date).toLocaleDateString('ja-JP') : '未定'}
          </span>
        )}
      </div>

      {plan.description && <p className="text-gray-700 mb-8 whitespace-pre-wrap">{plan.description}</p>}

      {days.length > 0 ? (
        <div className="space-y-4">
          {days.map((day, idx) => (
            <section key={idx} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
              <Heading level={titleLevel + 1} className="font-semibold text-gray-900 mb-2">
                {dayHeading(day.date, day.title, idx)}
              </Heading>
              {day.events.length > 0 ? (
                <ul className="space-y-2">
                  {day.events.map((ev, evIdx) => (
                    <li key={evIdx} className="text-sm text-gray-800 border-l-2 border-blue-200 pl-3">
                      {ev.local_start_time && <span className="text-gray-700 mr-2">{ev.local_start_time}</span>}
                      {ev.title || '(名称未設定のイベント)'}
                      {ev.address && <div className="text-xs text-gray-700">住所: {ev.address}</div>}
                      {ev.notes && <div className="text-xs text-gray-700 whitespace-pre-wrap">メモ: {ev.notes}</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-700">予定はまだ登録されていません</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-700">まだ日程が登録されていません</div>
      )}

      {reservations && (
        <section className="mt-6 bg-white rounded-xl shadow-sm p-5 border border-gray-100" aria-label="予約の概要">
          <Heading level={titleLevel + 1} className="font-semibold text-gray-900 mb-2">予約の概要</Heading>
          {reservations.length > 0 ? (
            <ul className="space-y-2">
              {reservations.map((r, i) => (
                <li key={i} className="text-sm text-gray-800">
                  <span className="font-medium">{r.provider_name || reservationTypeLabel(r.type)}</span>
                  <span className="ml-2 text-xs text-gray-700">
                    {reservationTypeLabel(r.type)}・{reservationStatusLabel(r.status)}
                    {r.start ? `・${r.start}` : ''}{r.end ? ` 〜 ${r.end}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-700">予約はまだ登録されていません</p>
          )}
          <p className="mt-2 text-xs text-gray-700">予約番号・予約者名・連絡先・金額は共有されません。</p>
        </section>
      )}
    </div>
  );
};

export default SharedPlanView;
