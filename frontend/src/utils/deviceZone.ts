/**
 * [Gate2 G2-04] 端末の時刻帯(IANA。Asia/Tokyo など)。読めない時は undefined。
 * 新しい日を作る時に送る(送らないとサーバーの既定の UTC になり、今日・NOW/NEXT が 9 時間ずれる)。
 */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** [Gate2 G2-04] 日の時刻帯が UTC のままで、端末は UTC でない時だけ「合わせる」を出す(本当に UTC の旅行は出さない) */
export const needsZoneFix = (dayZone: string | undefined, device: string | undefined): boolean =>
  !!device && device !== 'UTC' && dayZone === 'UTC';
