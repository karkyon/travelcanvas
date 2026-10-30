/**
 * スポット検索(/search)。
 *
 * [Gate Honesty] 監査 2026-10-30: 以前は「AI がインターネットを解析」「AI 画像解析」「AI 音声認識」「AI 検索エンジンが待機中」
 * 「AI 信頼度」と書き、値段の段階(¥¥)を全ての結果に既定値で付けていた。実際は次のとおりのため、画面の言葉を実際に合わせる:
 *   - 文字の検索: サーバーの /search/spots が公開のデータ(Wikipedia・OpenStreetMap の Nominatim・Overpass)をキーワードで引く。
 *     AI・有料の提供元は使っていない(未接続)。並びは提供元が返した順
 *   - 写真から探す・声で探す: 未実装(押しても何も解析しない)。準備中と示し、送る操作を出さない
 *   - 評価・値段・所要時間・費用は提供元から来ないため出さない(作った値を見せない)
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MapPin, Globe, Camera, Mic, Info } from 'lucide-react';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { searchSpots } from '../services/api';
import UiIcon from '@/components/common/UiIcon';
import type { LucideIcon } from 'lucide-react';
import PageHead from '@/components/shell/PageHead';
import { IcCoffee, IcHotel, IcLandmark, IcMapPin, IcShopping, IcTrees, IcUtensils } from '@/components/common/uiIcons';

interface SearchResult {
  id: string;
  name: string;
  description: string;
  category: string;
  provider?: string;
  location?: { latitude?: number; longitude?: number; address?: string };
  address?: string;
}

const SPOT_TYPE_MARKS: Record<string, [LucideIcon, string]> = {
  restaurant: [IcUtensils, '飲食店'],
  tourist_attraction: [IcLandmark, '観光地'],
  shopping_mall: [IcShopping, '買い物'],
  lodging: [IcHotel, '宿泊'],
  park: [IcTrees, '公園'],
  cafe: [IcCoffee, 'カフェ'],
  default: [IcMapPin, 'スポット'],
};

const PROVIDER_LABEL: Record<string, string> = {
  wikipedia: 'Wikipedia',
  nominatim: 'OpenStreetMap(Nominatim)',
  overpass: 'OpenStreetMap(Overpass)',
};

type Mode = 'text' | 'image' | 'voice';
type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; results: SearchResult[] }
  | { kind: 'error'; message: string };

const MODES: Array<{ key: Mode; label: string; icon: LucideIcon; ready: boolean }> = [
  { key: 'text', label: '言葉で探す', icon: Search, ready: true },
  { key: 'image', label: '写真から探す', icon: Camera, ready: false },
  { key: 'voice', label: '声で探す', icon: Mic, ready: false },
];

function loadSearchPreferences(): { maxResults: number; area: { latitude: number; longitude: number } | null } {
  // [Gate #22] /search/settings で保存した候補数・優先エリアを検索に使う
  try {
    const saved = JSON.parse(localStorage.getItem('search_preferences') || 'null');
    const lat = saved?.preferredArea?.latitude;
    const lng = saved?.preferredArea?.longitude;
    return {
      maxResults: Number(saved?.searchSettings?.maxResults) || 5,
      area: typeof lat === 'number' && typeof lng === 'number' ? { latitude: lat, longitude: lng } : null,
    };
  } catch {
    return { maxResults: 5, area: null };
  }
}

const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('text');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [prefs] = useState(loadSearchPreferences);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(prefs.area);
  const [locationNote, setLocationNote] = useState<string>(prefs.area ? `検索の設定の座標(${prefs.area.latitude.toFixed(2)}, ${prefs.area.longitude.toFixed(2)})の近くを先に探します` : '');

  useEffect(() => {
    if (prefs.area || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setLocationNote('今いる場所の近くを先に探します(位置は検索の時だけ送ります)');
      },
      () => setLocationNote('位置を使わずに探します'),
    );
  }, [prefs.area]);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) {
      setStatus({ kind: 'error', message: '探す言葉を入れてください' });
      return;
    }
    setStatus({ kind: 'loading' });
    const response = await searchSpots({ query: query.trim(), location: location ?? undefined, max_results: prefs.maxResults });
    if (!response.success) {
      setStatus({ kind: 'error', message: '検索できませんでした。時間をおいてもう一度試してください。' });
      return;
    }
    setStatus({ kind: 'done', results: (response.data?.spots as SearchResult[] | undefined) ?? [] });
  };

  const addSpotToPlan = (spot: SearchResult) => {
    // [Gate #16] 追加と成功の知らせは旅程の画面の受け取り(PlannerPage)で行う
    navigate('/planner', { state: { newSpot: spot } });
  };

  const categoryMark = (category: string) => {
    const [icon, label] = SPOT_TYPE_MARKS[category] ?? SPOT_TYPE_MARKS.default!;
    return (
      <>
        <UiIcon icon={icon} size={18} className="mr-1 align-[-3px]" />
        <span className="sr-only">{`${label}: `}</span>
      </>
    );
  };

  const current = MODES.find((m) => m.key === mode)!;

  return (
    <div className="min-h-screen bg-cloud-50">
      <div className="tc-page">
        <PageHead
          eyebrow="DISCOVER · 発見"
          title="スポット検索"
          sub="キーワードで、公開の地図・百科事典のデータ(Wikipedia・OpenStreetMap)から場所の候補を探します。"
          actions={<Link to="/search/settings" className="tc-focus-ring tc-mbtn tc-mbtn--sm">検索の設定</Link>}
        />

        <p className="tc-card px-4 py-3 mb-4 text-sm text-ink-700 flex gap-2" data-testid="search-honesty">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            AI・有料の検索の提供元はまだつながっていません(未接続)。結果は提供元が返した順に並べ、評価や値段は付けません。
          </span>
        </p>

        <div role="tablist" aria-label="探し方" className="flex flex-wrap gap-2 mb-4">
          {MODES.map(({ key, label, icon: Icon, ready }) => (
            <button key={key} type="button" role="tab" id={`search-tab-${key}`} aria-selected={mode === key}
              aria-controls={`search-panel-${key}`} onClick={() => setMode(key)}
              className={`tc-focus-ring tc-mbtn tc-mbtn--sm ${mode === key ? 'tc-mbtn--primary' : ''}`}>
              <Icon size={14} aria-hidden="true" />{label}
              {!ready && <span className="tc-pill tc-pill--warn ml-1">準備中</span>}
            </button>
          ))}
        </div>

        <section role="tabpanel" id={`search-panel-${mode}`} aria-labelledby={`search-tab-${mode}`} className="tc-card p-5 mb-6">
          {current.ready ? (
            <form onSubmit={run} className="flex flex-col sm:flex-row gap-3" role="search">
              <label htmlFor="search-q" className="sr-only">探す言葉</label>
              <input id="search-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="例: 清水寺、金沢 市場、海の見えるカフェ"
                className="tc-focus-ring flex-1 min-h-11 rounded-xl border border-cloud-200 bg-cloud-0 px-4 text-ink-900" />
              <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={status.kind === 'loading'}>
                <Search size={16} aria-hidden="true" />探す
              </button>
            </form>
          ) : (
            <div data-testid={`search-unavailable-${mode}`}>
              <p className="font-semibold text-ink-900">{`${current.label}は準備中です`}</p>
              <p className="text-sm text-ink-700 mt-1">
                {mode === 'image'
                  ? '写真から場所を見つける仕組み(画像の解析)はまだありません。写真を送っても解析しないため、ここでは受け付けていません。'
                  : '声から場所を探す仕組み(音声の文字起こし)はまだありません。録音しても解析しないため、ここでは受け付けていません。'}
              </p>
              <button type="button" onClick={() => setMode('text')} className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-3">
                言葉で探す
              </button>
            </div>
          )}
          {current.ready && locationNote && <p className="text-xs text-ink-500 mt-2">{locationNote}</p>}
        </section>

        <div aria-live="polite">
          {status.kind === 'loading' && (
            <div className="flex items-center justify-center py-12" role="status">
              <LoadingSpinner size="lg" />
              <span className="ml-3 text-ink-700">探しています…</span>
            </div>
          )}
          {status.kind === 'error' && (
            <p role="alert" className="tc-card px-4 py-3 text-sm text-danger">{status.message}</p>
          )}
          {status.kind === 'done' && status.results.length === 0 && (
            <div className="tc-card p-8 text-center text-ink-700" data-testid="search-empty">
              <Search size={36} className="mx-auto mb-3 opacity-50" aria-hidden="true" />
              <p className="font-medium">候補が見つかりませんでした</p>
              <p className="text-sm mt-1">言葉を変えるか、地名を足して試してください。</p>
            </div>
          )}
          {status.kind === 'done' && status.results.length > 0 && (
            <section aria-labelledby="search-results-title">
              <div className="tc-section-row mb-3">
                <h2 id="search-results-title" className="tc-section-title">{`見つかった候補(${status.results.length}件)`}</h2>
                <span className="text-xs text-ink-500">提供元が返した順</span>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {status.results.map((spot) => (
                  <li key={spot.id} className="tc-card p-5 flex flex-col gap-2">
                    <h3 className="font-semibold text-lg text-ink-900 break-words">{categoryMark(spot.category)}{spot.name}</h3>
                    <p className="text-xs text-ink-700 flex items-center gap-1">
                      <MapPin size={12} aria-hidden="true" />{spot.location?.address || spot.address || '住所の情報なし'}
                    </p>
                    {spot.provider && (
                      <p className="text-xs text-ink-700 flex items-center gap-1">
                        <Globe size={12} aria-hidden="true" />{`出典: ${PROVIDER_LABEL[spot.provider] ?? spot.provider}`}
                      </p>
                    )}
                    <div className="mt-auto pt-2">
                      <button type="button" onClick={() => addSpotToPlan(spot)} className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary"
                        aria-label={`「${spot.name}」をプランに追加`}>
                        プランに追加
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {status.kind === 'idle' && (
            <div className="tc-card p-8 text-center text-ink-700">
              <p className="font-medium">行きたい場所の名前や、地名と種類(「金沢 市場」など)を入れて探してください。</p>
              <p className="text-sm mt-1">見つかった候補は、旅程に追加すると地図と日程に並びます。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchPage;
