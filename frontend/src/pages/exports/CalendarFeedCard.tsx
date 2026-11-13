/**
 * [Gate Remaining-5] FR-036 カレンダーの購読(外のカレンダーが旅程の変更を自動で追う)。
 * 推測できない URL を作り、Google・Apple・Outlook のカレンダーに「URL で追加」する。住所は入れない。
 * URL を知っている人は誰でも見られるので、作り直す・止めると前の URL は使えなくなる。
 */
import React, { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { createCalendarFeed, deleteCalendarFeed, getCalendarFeed, type CalendarFeed } from '@/services/api/remaining5';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const CalendarFeedCard: React.FC<{ planId: string }> = ({ planId }) => {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getCalendarFeed(planId).then((f) => { if (alive) setFeed(f); }).catch(() => { if (alive) setFeed(null); });
    return () => { alive = false; };
  }, [planId]);

  const run = async (fn: () => Promise<CalendarFeed>) => {
    setBusy(true);
    setError(null);
    try {
      setFeed(await fn());
    } catch (e) {
      setError(errorDetailMessage(e, 'カレンダーの購読を変えられませんでした'));
    } finally {
      setBusy(false);
    }
  };

  if (!feed) return null;
  return (
    <Card padding="md">
      <section aria-labelledby="export-feed" data-testid="calendar-feed">
        <h2 id="export-feed" className="font-semibold text-ink-900">カレンダーの購読(自動で追う)</h2>
        <p className="text-sm text-ink-700 mt-1">
          購読の URL をカレンダー(Google の「URL で追加」・Apple の「照会カレンダー」等)に入れると、旅程を変えた時にカレンダーも
          自動で新しくなります(反映はカレンダー側の間隔。数時間かかることがあります)。住所は入りません。
        </p>
        {feed.by_other ? (
          <p className="text-sm text-ink-700 mt-2">ほかのメンバーが購読の URL を作っています。</p>
        ) : feed.url ? (
          <>
            <input readOnly value={feed.webcal_url ?? feed.url} aria-label="カレンダーの購読の URL"
              className="mt-2 w-full px-2 py-1 border border-gray-300 rounded-lg text-xs font-mono" data-testid="calendar-feed-url" />
            <p className="text-xs text-ink-700 mt-1">URL を知っている人は誰でも見られます。人に教えないでください。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" loading={busy} onClick={() => void run(() => createCalendarFeed(planId))}>作り直す</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => deleteCalendarFeed(planId))}>止める</Button>
            </div>
          </>
        ) : (
          <Button variant="outline" size="sm" className="mt-2" loading={busy}
            onClick={() => void run(() => createCalendarFeed(planId))}>購読の URL を作る</Button>
        )}
        {error && <p className="mt-2 p-2 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</p>}
      </section>
    </Card>
  );
};

export default CalendarFeedCard;
