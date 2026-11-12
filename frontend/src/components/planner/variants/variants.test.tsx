/** [Gate PlanB] 日ごとの案: 並び・要約・検証の見出し分け、タブと控えの案の帯 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ createVariant: vi.fn(), patchVariant: vi.fn(), indoorCandidates: vi.fn(), replaceInVariant: vi.fn(),
  aiCheckVariant: vi.fn() }));
vi.mock('@/services/api/dayVariants', async (orig) => ({
  ...(await orig<typeof import('@/services/api/dayVariants')>()), createVariant: m.createVariant, patchVariant: m.patchVariant,
  indoorCandidates: m.indoorCandidates, replaceInVariant: m.replaceInVariant, aiCheckVariant: m.aiCheckVariant,
}));
import type { VariantSummary } from '@/services/api/dayVariants';
import VariantBar from './VariantBar';
import CreateVariantDialog from './CreateVariantDialog';
import IndoorDialog from './IndoorDialog';
import AiCheckDialog from './AiCheckDialog';
import AllDaysChart from '../AllDaysChart';
import SharedPlanView from '@/components/share/SharedPlanView';
import { booklet as bookletDecoder } from '@/services/api/decoders';
import { activeOf, conditionText, groupChecks, sortVariants } from './variantModel';

const v = (o: Partial<VariantSummary>): VariantSummary => ({
  day_id: 'd', local_date: '2026-11-29', label: 'A', name: '今の案', status: 'active', reason: null, reason_label: null,
  conditions: {}, group_id: null, copied_from_day_id: null, events: 3, first_time: '09:00', last_time: '18:00', titles: [], ...o,
});
const A = v({ day_id: 'a' });
const B = v({ day_id: 'b', label: 'B', name: '雨の日', status: 'standby', reason: 'rain', reason_label: '雨',
  conditions: { transport_mode: 'train', party_size: 4, prefer_indoor: true } });
const C = v({ day_id: 'c', label: 'C', name: '古い案', status: 'archived' });

describe('variantModel', () => {
  it('A→E の順で、しまった案は後ろ', () => {
    expect(sortVariants([C, B, A]).map((x) => x.label)).toEqual(['A', 'B', 'C']);
    expect(activeOf([B, A])?.day_id).toBe('a');
  });
  it('条件の要約', () => {
    expect(conditionText(B)).toEqual(['理由: 雨', '移動の既定: 電車・徒歩', '4人', '屋内を優先']);
  });
  it('検証の結果を見出しに分けて重い順', () => {
    const g = groupChecks([
      { kind: 'next', level: 'ok', title: '翌日', text: '' }, { kind: 'prev', level: 'bad', title: '前日', text: '' },
      { kind: 'drop', level: 'warn', title: '予約', text: '' },
    ]);
    expect(g.map((x) => x.title)).toEqual(['前後のつながり', '予約']);
    expect(g[0]!.items[0]!.level).toBe('bad');
  });
});

describe('VariantBar', () => {
  const handlers = () => ({ onOpen: vi.fn(), onCreate: vi.fn(), onSwitch: vi.fn(), onCompare: vi.fn(), onCheck: vi.fn(),
    onRename: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() });
  it('案が 1 つで編集できない時は出さない', () => {
    const { container } = render(<VariantBar variants={[A]} openId={null} canEdit={false} {...handlers()} />);
    expect(container.firstChild).toBeNull();
  });
  it('タブで控えの案を開き、帯から切り替える', () => {
    const h = handlers();
    const { rerender } = render(<VariantBar variants={[A, B]} openId={null} canEdit {...h} />);
    expect(screen.queryByTestId('variant-banner')).toBeNull();
    fireEvent.click(screen.getByTestId('variant-tab-B'));
    expect(h.onOpen).toHaveBeenCalledWith('b');
    rerender(<VariantBar variants={[A, B]} openId="b" canEdit checkSummary={{ ok: 2, warn: 1, bad: 0 }} {...h} />);
    expect(screen.getByTestId('variant-banner').textContent).toContain('雨の日');
    expect(screen.getByTestId('variant-tab-B').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('variant-switch'));
    expect(h.onSwitch).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('variant-tab-A'));
    expect(h.onOpen).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByTestId('variant-create'));
    expect(h.onCreate).toHaveBeenCalled();
  });
});

describe('[P5] たたき台・全日程・共有・しおり', () => {
  it('雨の案はたたき台を既定で作り、遅れは分と時刻を送る。白紙ではたたき台を出さない', async () => {
    m.createVariant.mockResolvedValue({ revision: 2, variants: [{ day_id: 'nb' }] });
    const onDone = vi.fn();
    render(<CreateVariantDialog planId="p" isOpen date="2026-11-29" dateLabel="11/29" otherDays={[]} revision={1}
      onClose={vi.fn()} onDone={onDone} />);
    expect(screen.queryByTestId('variant-scaffold')).toBeNull();
    fireEvent.click(screen.getByTestId('variant-reason-rain'));
    expect(screen.getByTestId('variant-scaffold').textContent).toContain('屋外の予定に印');
    fireEvent.click(screen.getByTestId('variant-reason-delay'));
    fireEvent.change(screen.getByTestId('variant-delay-min'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('variant-submit'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('nb'));
    const body = m.createVariant.mock.calls[0]![1];
    expect(body.scaffold).toBe(true);
    expect(body.reason).toBe('delay');
    expect(body.conditions.delay_minutes).toBe(90);
    // 白紙にするとたたき台は出ない
    fireEvent.click(screen.getByRole('radio', { name: /白紙から/ }));
    expect(screen.queryByTestId('variant-scaffold')).toBeNull();
  });

  it('控えの案の帯にたたき台の印を出す', () => {
    const withNotes = { ...B, conditions: { ...B.conditions, scaffold: [
      { kind: 'rain' as const, event_id: 'e1', title: '二見興玉神社', text: '屋外の予定です' }] } };
    render(<VariantBar variants={[A, withNotes]} openId="b" canEdit onOpen={vi.fn()} onCreate={vi.fn()} onSwitch={vi.fn()}
      onCompare={vi.fn()} onCheck={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('variant-scaffold-notes').textContent).toContain('二見興玉神社 屋外の予定です');
  });

  it('全日程の見出しに「B あり」の札', () => {
    render(<AllDaysChart days={[{ id: 'd1', date: '2026-11-29', timezone_id: 'Asia/Tokyo', events: [] }]} segments={[]} currentDay={0}
      onOpenDay={vi.fn()} variantsByDate={{ '2026-11-29': ['B 雨の日', 'C 2人'] }} />);
    expect(screen.getByTestId('chart-variants-0').textContent).toBe('B・C あり');
  });

  it('共有の閲覧で、その日の下に控えの案を出す', () => {
    render(<SharedPlanView plan={{ plan_id: 'p', title: '伊勢', days: [{ date: '2026-11-29', title: null, events: [] }],
      permission: 'view', can_edit: false,
      variants: [{ date: '2026-11-29', label: 'B', name: '雨の日', reason_label: '雨',
        events: [{ title: '鳥羽水族館', event_type: 'sightseeing', local_start_time: '10:00', is_all_day: false }] }] }} />);
    expect(screen.getByTestId('shared-variant-2026-11-29-B').textContent).toContain('控えの案 B 雨の日(雨の時)10:00鳥羽水族館');
  });

  it('しおりの付録「控えの案」を読み、古い版(variants 無し)も読める', () => {
    const base = {
      policy_version: 'v', plan_id: 'p', theme: 'simple', density: 'normal', format: 'print', sections: ['cover', 'variants'],
      includes: { confirmation_numbers: false, addresses: false, phones: false, participants: false }, contains_sensitive: false,
      generated_at: 'x', input_revision: 1, current_revision: 1, is_stale: false, data_as_of: 'x', warnings: [],
      cover: null, schedule: null, map: null, reservations: null, packing: null, contacts: null, costs: null, notes: null,
    };
    expect(() => bookletDecoder(base, '$')).not.toThrow();
    const b = bookletDecoder({ ...base, variants: [{ date: '2026-11-29', label: 'B', name: '雨の日', reason_label: '雨',
      events: [{ title: '水族館', event_type: 'activity', local_start_time: '10:00', is_all_day: false }] }] }, '$');
    expect(b.variants?.[0]?.name).toBe('雨の日');
  });
});

describe('[Next] 予報・屋内の候補・AI の確かめ', () => {
  const h = () => ({ onOpen: vi.fn(), onCreate: vi.fn(), onSwitch: vi.fn(), onCompare: vi.fn(), onCheck: vi.fn(),
    onRename: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onCreateRain: vi.fn(), onIndoor: vi.fn(), onAiCheck: vi.fn() });
  const rain = { date: '2026-11-29', day_id: 'a', label: '雨', weather_code: 63, precipitation_probability: 80, precipitation_mm: 12,
    temp_max: 16.2, temp_min: 9, rainy: true, source: 'Open-Meteo', has_rain_variant: false };

  it('雨の予報で雨の案が無い時は「雨の日の案を作る」。雨の控えの案を開くと屋内の候補・AI のボタン', () => {
    const x = h();
    const { rerender } = render(<VariantBar variants={[A]} openId={null} canEdit forecast={rain} {...x} />);
    expect(screen.getByTestId('variant-forecast').textContent).toBe('予報 雨 · 降水 80% · 16℃');
    rerender(<VariantBar variants={[A]} openId={null} canEdit {...x} forecast={{ ...rain, rain_hours: ['11時〜15時'],
      affected_events: [{ event_id: 'e', title: '河原でバーベキュー', time: '12:00', probability: 80, fit: 'outdoor' }] }} />);
    expect(screen.getByTestId('variant-forecast').textContent).toBe('予報 雨 · 降水 80% · 16℃ · 雨 11時〜15時');
    expect(screen.getByTestId('variant-affected').textContent).toBe('雨の時間に屋外: 河原でバーベキュー 12:00');
    fireEvent.click(screen.getByTestId('variant-create-rain'));
    expect(x.onCreateRain).toHaveBeenCalled();
    rerender(<VariantBar variants={[A, B]} openId="b" canEdit forecast={{ ...rain, has_rain_variant: true }} {...x} />);
    expect(screen.queryByTestId('variant-create-rain')).toBeNull();
    fireEvent.click(screen.getByTestId('variant-indoor'));
    fireEvent.click(screen.getByTestId('variant-ai'));
    expect(x.onIndoor).toHaveBeenCalled();
    expect(x.onAiCheck).toHaveBeenCalled();
  });

  it('屋内の候補: 屋外の予定を選んで探し、入れ替える', async () => {
    m.indoorCandidates.mockResolvedValue({ candidates: [{ name: '伊勢美術館', kind: 'sightseeing', fit: 'indoor', distance_km: 2,
      genre_label: '観光', latitude: 34.4, longitude: 136.7 }], region: { label: 'この日の範囲', radius_km: 5 }, near_event: 'BBQ',
    failed_providers: [] });
    m.replaceInVariant.mockResolvedValue({ revision: 9 });
    const onDone = vi.fn();
    const v = { ...B, conditions: { scaffold: [{ kind: 'rain' as const, event_id: 'e9', title: '河原でバーベキュー', text: '', fit: 'outdoor' as const }] } };
    render(<IndoorDialog planId="p" isOpen variant={v} revision={8} onClose={vi.fn()} onDone={onDone} />);
    await waitFor(() => expect(m.indoorCandidates).toHaveBeenLastCalledWith('p', 'b', 'e9'));
    fireEvent.click(await screen.findByTestId('indoor-put-伊勢美術館'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(m.replaceInVariant).toHaveBeenCalledWith('p', 'b', 8, { replace_event_id: 'e9', name: '伊勢美術館', address: null,
      latitude: 34.4, longitude: 136.7, event_type: 'sightseeing' });
  });

  it('AI の確かめ: 結果を出し、断られた時は理由を出す', async () => {
    m.aiCheckVariant.mockResolvedValueOnce({ result: { text: '大きな問題はありません' }, notice: '要確認' });
    const { unmount } = render(<AiCheckDialog planId="p" isOpen variant={B} onClose={vi.fn()} />);
    expect((await screen.findByTestId('ai-check-text')).textContent).toBe('大きな問題はありません');
    unmount();
    m.aiCheckVariant.mockRejectedValueOnce({ isAxiosError: true, response: { status: 403, data: { detail: {
      code: 'consent_required', message: 'AI の利用に同意していないため、AI へ送りません' } } } });
    render(<AiCheckDialog planId="p" isOpen variant={B} onClose={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('同意していない');
  });
});
