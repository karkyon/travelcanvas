/**
 * [Gate2 G2-04] 日の時刻帯が UTC のままの時の知らせ。
 * 以前の「新しい旅行」「日を追加」は時刻帯を送らず、サーバーの既定の UTC で日が作られた。
 * UTC の日では、日本の 10:00 の予定が「9 時間後」と見え、朝 9 時前は「今日」が空になる。
 * 押した時だけ、その日の時刻帯を端末の時刻帯へ付け替える(予定の「10:00」は 10:00 のまま)。
 */
import React, { useState } from 'react';
import { usePlanStore } from '@/store/planStore';
import { deviceTimeZone, needsZoneFix } from '@/utils/deviceZone';

const DayZoneNotice: React.FC<{ dayId: string; dayZone: string | undefined }> = ({ dayId, dayZone }) => {
  const setDayTimeZone = usePlanStore((s) => s.setDayTimeZone);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const device = deviceTimeZone();
  if (!device || !needsZoneFix(dayZone, device)) return null;
  return (
    <div className="tc-card mb-3 p-3 text-sm" role="note" data-testid="day-zone-notice">
      <p>
        この日の時刻帯が <b>UTC</b> のままです(端末は <b>{device}</b>)。このままだと、旅の当日の「次の予定」「今日」が数時間ずれて見えます。
      </p>
      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-2" disabled={busy}
        onClick={async () => {
          setBusy(true); setFailed(false);
          const ok = await setDayTimeZone(dayId, device);
          setBusy(false); setFailed(!ok);
        }}>
        {`この日の時刻帯を ${device} に合わせる`}
      </button>
      {failed && <p className="mt-1 text-red-800" role="alert">変えられませんでした。旅行の持ち主の端末で、通信できる時にもう一度試してください。</p>}
    </div>
  );
};

export default DayZoneNotice;
