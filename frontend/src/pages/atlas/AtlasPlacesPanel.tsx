/**
 * [Gate Remaining-2] FR-052 Atlas の地名のまとめ(国・都道府県(州)・市区町村)。
 *
 * 押した時だけ調べる(区画の真ん中の座標を丸めて、日本は国土地理院、外は OpenStreetMap へ送る)。1 回に調べる区画は
 * 限られるため、残りがあれば「続きを調べる」。調べられない区画は地名を作らずに数だけ出す。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { getAtlasPlaces, type AtlasPlaces } from '@/services/api/remaining2';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { STATE_INFO } from './atlasModel';

const AtlasPlacesPanel: React.FC<{ year: number | null }> = ({ year }) => {
  const [data, setData] = useState<AtlasPlaces | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await getAtlasPlaces(year));
    } catch (e) {
      setError(errorDetailMessage(e, '地名を調べられませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="atlas-places-heading" className="mt-6" data-testid="atlas-places">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="atlas-places-heading" className="font-semibold text-ink-900">国・都道府県・市区町村</h2>
        <Button variant="outline" size="sm" loading={busy} onClick={run}>
          {data && data.pending > 0 ? `続きを調べる(残り${data.pending}区画)` : data ? 'もう一度調べる' : '地名でまとめる'}
        </Button>
      </div>
      <p className="text-xs text-ink-700 mt-1">
        区画の真ん中の位置(約1kmに丸めた座標)から地名を調べます。日本は国土地理院、日本の外は OpenStreetMap を使います。
      </p>
      {error && <p className="mt-2 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</p>}
      {data && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-ink-900" role="status">
            {`訪れた国 ${data.visited.countries} ・ 都道府県(州) ${data.visited.regions} ・ 市区町村 ${data.visited.municipalities}`}
            {data.unresolved > 0 && ` ・ 地名の分からない区画 ${data.unresolved}`}
          </p>
          {data.countries.length === 0 ? (
            <Card padding="md" className="text-ink-700 text-sm">
              {data.pending > 0 ? 'まだ調べていない区画があります。「続きを調べる」を押してください。' : 'まとめられる区画はありません。'}
            </Card>
          ) : (
            <ul className="space-y-2" aria-label="国ごとのまとめ">
              {data.countries.map((c) => (
                <li key={c.country_code}>
                  <Card padding="md">
                    <p className="font-medium text-ink-900">
                      {`${STATE_INFO[c.state].mark} ${c.country}(${STATE_INFO[c.state].label}・${c.cells}区画)`}
                    </p>
                    <ul className="mt-1 ml-4 space-y-1 text-sm">
                      {c.regions.map((r) => (
                        <li key={r.name}>
                          <span className="text-ink-900">{`${STATE_INFO[r.state].mark} ${r.name}(${STATE_INFO[r.state].label})`}</span>
                          {r.municipalities.length > 0 && (
                            <span className="text-ink-700">
                              {' : '}
                              {r.municipalities.map((m) => `${m.name}(${STATE_INFO[m.state].label})`).join('、')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-700">{`出典: ${data.sources}`}</p>
        </div>
      )}
    </section>
  );
};

export default AtlasPlacesPanel;
