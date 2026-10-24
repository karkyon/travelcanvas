/**
 * [Gate G6] LOC-02 守る範囲(自宅・職場など)。
 * この範囲の中の場所・軌跡は、書き出し(GPX・KML)と旅行記の公開から外す。中心の座標は暗号化して保存し、本人にだけ見せる。
 */
import React, { useCallback, useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { createPrivacyZone, deletePrivacyZone, getPrivacyZones } from '@/services/api/g6';
import type { PrivacyZone, PrivacyZoneList } from '@/services/api/types/g6';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { zoneInputProblem } from './privacyModel';

const RADII = [100, 300, 500, 1000, 2000, 5000];

const PrivacyZonesCard: React.FC = () => {
  const [data, setData] = useState<PrivacyZoneList | null>(null);
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getPrivacyZones());
    } catch (e) {
      setError(errorDetailMessage(e, '守る範囲を取得できませんでした'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const problem = zoneInputProblem(label, lat, lng);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await createPrivacyZone({ label: label.trim(), latitude: Number(lat), longitude: Number(lng), radius_m: radius });
      setMessage(`「${label.trim()}」を守る範囲にしました。`);
      setLabel('');
      setLat('');
      setLng('');
      await load();
    } catch (err) {
      setError(errorDetailMessage(err, '守る範囲を追加できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (z: PrivacyZone) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await deletePrivacyZone(z.id);
      setMessage(`「${z.label}」を守る範囲から外しました。`);
      await load();
    } catch (err) {
      setError(errorDetailMessage(err, '守る範囲を削除できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const full = data ? data.zones.length >= data.max_zones : false;

  return (
    <Card padding="md" className="mt-4">
      <section aria-labelledby="privacy-zones-heading">
        <h2 id="privacy-zones-heading" className="font-semibold text-gray-900">守る範囲(自宅・職場など)</h2>
        <p className="text-sm text-gray-700 mt-1">
          この範囲の中の場所と移動の記録は、書き出し(GPX・KML)と旅行記の公開に含めません。
          あなたが所有する旅行では、メンバーが書き出す時も外します。中心の位置は暗号化して保存し、あなただけが見られます。
        </p>
        <div aria-live="polite">{message && <p className="text-sm text-green-900 mt-2" role="status">{message}</p>}</div>
        {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
        {!data && !error ? <div className="flex justify-center py-6"><LoadingSpinner /></div> : data && (
          data.zones.length === 0 ? (
            <p className="text-sm text-gray-700 mt-3">守る範囲はまだありません。</p>
          ) : (
            <ul className="mt-3 divide-y" aria-label="守る範囲の一覧">
              {data.zones.map((z) => (
                <li key={z.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-gray-900">{z.label}</span>
                    <span className="ml-2 text-sm text-gray-700">半径 {z.radius_m}m</span>
                    <span className="block text-sm text-gray-700">
                      {z.readable && z.latitude !== null && z.longitude !== null
                        ? `中心: ${z.latitude.toFixed(4)}, ${z.longitude.toFixed(4)}`
                        : '中心を読めません(安全のため、読めるまで全ての位置を外へ出しません)'}
                    </span>
                  </span>
                  <Button variant="outline" size="sm" disabled={busy} aria-label={`${z.label}を削除する`} onClick={() => void remove(z)}>
                    削除する
                  </Button>
                </li>
              ))}
            </ul>
          )
        )}
        {data && !full && (
          <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(e) => void add(e)} aria-label="守る範囲を追加する">
            <label className="text-sm text-gray-800">名前
              <input className="mt-1 block w-full border rounded px-2 py-1" value={label} maxLength={50}
                onChange={(e) => setLabel(e.target.value)} placeholder="自宅" />
            </label>
            <label className="text-sm text-gray-800">半径
              <select className="mt-1 block w-full border rounded px-2 py-1" value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}>
                {RADII.map((r) => <option key={r} value={r}>{r}m</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-800">中心の緯度
              <input className="mt-1 block w-full border rounded px-2 py-1" inputMode="decimal" value={lat}
                onChange={(e) => setLat(e.target.value)} placeholder="35.0116" />
            </label>
            <label className="text-sm text-gray-800">中心の経度
              <input className="mt-1 block w-full border rounded px-2 py-1" inputMode="decimal" value={lng}
                onChange={(e) => setLng(e.target.value)} placeholder="135.7681" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" size="sm" loading={busy}>守る範囲を追加する</Button>
            </div>
          </form>
        )}
        {data && full && <p className="text-sm text-gray-700 mt-2">守る範囲は{data.max_zones}件までです。</p>}
      </section>
    </Card>
  );
};

export default PrivacyZonesCard;
