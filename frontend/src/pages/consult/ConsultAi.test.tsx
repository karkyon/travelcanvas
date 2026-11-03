/**
 * [Gate ConsultAI] 旅行相談の「AI で読み取る」・AI の方面の案・Google で調べる(押した時だけ・未確認として示す)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const m = vi.hoisted(() => ({
  getConsultAiStatus: vi.fn(), startConsult: vi.fn(), aiExtract: vi.fn(), consultPlaces: vi.fn(), consultRoute: vi.fn(),
  updateConsents: vi.fn(), extractIntent: vi.fn(),
}));
vi.mock('@/services/api/consultAi', () => ({
  getConsultAiStatus: m.getConsultAiStatus, startConsult: m.startConsult, aiExtract: m.aiExtract,
  consultPlaces: m.consultPlaces, consultRoute: m.consultRoute,
  newIdempotencyKey: (() => { let n = 0; return () => `k${(n += 1)}`; })(),
  consultErrorCode: (e: { response?: { data?: { detail?: { code?: string } } } }) => e?.response?.data?.detail?.code ?? null,
}));
vi.mock('@/services/api', () => ({ updateConsents: m.updateConsents }));
vi.mock('@/services/api/tripIntent', () => ({
  extractIntent: m.extractIntent, compareAreas: vi.fn(), createTripDraft: vi.fn(), getAreaImages: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/services/api/g11discover', () => ({ searchNearby: vi.fn() }));
vi.mock('@/components/planning/PlanningClassSummary', () => ({ default: () => null }));
vi.mock('./AreaMap', () => ({ default: () => null }));

import TripConsultPage from './TripConsultPage';
import { operationBlocker } from './consultAiModel';
import type { ConsultAiStatus } from '@/services/api/consultAi';

const op = (over: Record<string, unknown> = {}) => ({
  provider: 'openai', included: true, key_ready: true, suspended: false, reason: null, ready: true, ...over });
const status = (over: Partial<ConsultAiStatus> = {}, ai: Record<string, unknown> = {}): ConsultAiStatus => ({
  class: 'journey', class_label: 'Journey', consent: { ai_processing: true }, stub: false, model: 'gpt-5-nano',
  max_text_chars: 3000,
  operations: { 'ai.generate': op(ai), 'places.search': op({ provider: 'google_places' }),
    'routes.element': op({ provider: 'google_routes' }) },
  ...over,
} as ConsultAiStatus);

const usage = { currency: 'JPY', plan_cap: '50.0000', plan_used: '0.4200', plan_reserved: '0.0000',
  plan_remaining: '49.5800', class: 'journey', scope: 'consult' };
const it_ = (key: string, over: Record<string, unknown>) => ({ key, label: key, value: null, display: '', source: 'ai',
  strength: 'undecided', evidence: null, question: null, needs_answer: false, note: null, sensitive: false, ...over });

const AI_RESULT = {
  extractor: 'openai_responses', ai_connected: true, nights: 1, model: 'gpt-5-nano', usage, stub: false,
  notice: 'AI の読み取りです(未確認)',
  areas: [{ name: '伊勢', source: 'user_input' }],
  suggested_areas: [{ name: '城崎温泉', reason: '車で行ける温泉地', source: 'ai_suggested' }],
  unknowns: ['宿の種類'],
  items: [
    it_('origin', { value: '大阪府枚方市', display: '大阪府枚方市', evidence: '枚方から' }),
    it_('party_size', { value: 4, display: '4人' }), it_('nights', { value: 1, display: '1泊2日' }),
    it_('transport', { value: { mode: 'car', highway: false }, display: '自家用車' }),
    it_('one_way', { source: 'unspecified' }), it_('room', { source: 'unspecified' }),
    it_('budget', { source: 'unspecified' }), it_('dates', { value: { status: 'undecided' }, source: 'unspecified' }),
    it_('preferences', { value: [], source: 'unspecified' }),
  ],
};

const renderPage = () => render(<MemoryRouter><TripConsultPage /></MemoryRouter>);

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  window.sessionStorage.clear();
  m.startConsult.mockResolvedValue({ session_id: 's1', expires_at: '2026-11-08T00:00:00Z' });
});

describe('旅行相談の AI', () => {
  it('開いただけでは送らない。使える時は「AI で読み取る」で送り、AI の行を未確認として示す', async () => {
    m.getConsultAiStatus.mockResolvedValue(status());
    m.aiExtract.mockResolvedValue(AI_RESULT);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('consult-ai-state')).toHaveTextContent('使えます(gpt-5-nano)'), { timeout: 5000 });
    expect(m.aiExtract).not.toHaveBeenCalled();
    expect(m.startConsult).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('希望・事情'), { target: { value: '家族4人で1泊2日。枚方から車で。' } });
    fireEvent.click(screen.getByTestId('consult-ai-extract'));
    await waitFor(() => expect(m.aiExtract).toHaveBeenCalledTimes(1));
    expect(m.aiExtract.mock.calls[0]?.[0]).toBe('s1');
    expect(m.aiExtract.mock.calls[0]?.[1]).toMatchObject({ text: '家族4人で1泊2日。枚方から車で。' });
    expect(await screen.findByText(/AI\(OpenAI\)の読み取りです/)).toBeInTheDocument();
    expect(screen.getByTestId('review-confirm-origin').parentElement).toHaveTextContent('AI の読み取り · 未確認 · 合っていれば印');
    expect(screen.getByTestId('review-row-origin')).toHaveTextContent('文章の該当: 「枚方から」');
    // AI の方面の案は、足すまで比べない
    const add = screen.getByTestId('consult-suggest-城崎温泉');
    expect(add).toHaveTextContent('比較に足す');
    fireEvent.click(add);
    expect(screen.getByTestId('consult-suggest-城崎温泉')).toHaveTextContent('比較から外す');
    expect(screen.getByTestId('consult-ai-suggestions')).toHaveTextContent('宿の種類');
  });

  it('鍵の確認がまだ・クラスに含まれない時は押せず、理由と AI を使わない道を示す', async () => {
    m.getConsultAiStatus.mockResolvedValue(status({}, { key_ready: false, reason: 'secret_unverified', ready: false }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('consult-ai-state')).toHaveTextContent('管理者が鍵の有効性をまだ確かめていません'), { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('希望・事情'), { target: { value: '家族旅行' } });
    expect(screen.getByTestId('consult-ai-extract')).toBeDisabled();
    expect(screen.getByTestId('consult-ai-panel')).toHaveTextContent('AI を使わない読み取り');
    expect(operationBlocker(status({ class: 'free', class_label: 'Free' }, { included: false }), 'ai.generate'))
      .toBe('Free のクラスには含まれません');
    expect(operationBlocker(status({ class: 'guest' }), 'ai.generate')).toMatch(/ゲスト/);
  });

  it('同意が無い時は送らず、同意の印で同意を保存してから状態を読み直す', async () => {
    m.getConsultAiStatus.mockResolvedValueOnce(status({ consent: { ai_processing: false } }))
      .mockResolvedValue(status());
    m.updateConsents.mockResolvedValue({});
    renderPage();
    await waitFor(() => expect(screen.getByTestId('consult-ai-state')).toHaveTextContent('AI の利用に同意していません'), { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('希望・事情'), { target: { value: '家族旅行' } });
    expect(screen.getByTestId('consult-ai-extract')).toBeDisabled();
    fireEvent.click(screen.getByTestId('consult-ai-consent'));
    await waitFor(() => expect(m.updateConsents).toHaveBeenCalledWith({ ai_processing: true }));
    await waitFor(() => expect(screen.getByTestId('consult-ai-extract')).not.toBeDisabled(), { timeout: 5000 });
    expect(m.aiExtract).not.toHaveBeenCalled();
  });

  it('断られたら理由を出し、文章を残して AI を使わない道を案内する。模擬の提供元は帯で示す', async () => {
    m.getConsultAiStatus.mockResolvedValue(status({ stub: true }));
    m.aiExtract.mockRejectedValue({ response: { status: 429, data: { detail: {
      code: 'feature_quota_exceeded', message: 'この旅行の「AI の案の作成」の回数の上限(3)に達しました' } } } });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('consult-stub')).toHaveTextContent('模擬'), { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('希望・事情'), { target: { value: '家族旅行' } });
    fireEvent.click(screen.getByTestId('consult-ai-extract'));
    expect(await screen.findByRole('alert')).toHaveTextContent('回数の上限(3)に達しました');
    expect(screen.getByRole('alert')).toHaveTextContent('AI を使わずに続けられます');
    expect(screen.getByLabelText('希望・事情')).toHaveValue('家族旅行');
  });
});
