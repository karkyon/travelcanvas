/**
 * [Gate ConsultAI / 監査 A06〜A08・A11] 音声で入力・その他の希望・追加の相談の重ね合わせ・予算の意味・確かめていない値。
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FollowUp, NotesEditor, VoiceInput } from './ConsultInputs';
import { speechSupport } from './speech';
import { initReview, intentOf, mergeReview } from './consultModel';
import type { IntentExtraction } from '@/services/api/types/tripIntent';

const item = (key: string, over: Record<string, unknown>) => ({
  key, label: key, value: null, display: '', source: 'ai', strength: 'undecided', evidence: null, question: null,
  needs_answer: false, note: null, sensitive: false, ...over,
});
const ex = (party: number, prefs: string[], budget: Record<string, unknown> | null, notes: string[] = []): IntentExtraction => ({
  extractor: 'openai_responses', ai_connected: true, nights: 1, areas: [],
  items: [
    item('origin', { source: 'unspecified' }), item('party_size', { value: party }), item('nights', { value: 1 }),
    item('transport', { source: 'unspecified' }), item('one_way', { source: 'unspecified' }),
    item('room', { source: 'unspecified' }), item('budget', budget ? { value: budget } : { source: 'unspecified' }),
    item('dates', { value: { status: 'undecided' }, source: 'unspecified' }), item('preferences', { value: prefs }),
  ] as IntentExtraction['items'],
  ...({ notes } as object),
});

describe('追加の相談の重ね合わせ(mergeReview)', () => {
  it('確かめた行は消さず、違う値は変更案にする。確かめていない行は新しい値にする。その他の希望は足し合わせる', () => {
    const first = initReview(ex(4, ['onsen', 'scenery'], null, ['何もしない時間']));
    const confirmed = { ...first, confirmed: { ...first.confirmed, party_size: true, preferences: true } };
    const next = initReview(ex(3, ['onsen'], { min: 80000, max: 80000, scope: null, target: 'trip_total' }, ['地元の市場']));
    const merged = mergeReview(confirmed, next);
    expect(merged.values.party_size).toBe(4); // 確かめた値は残る
    expect(merged.proposals?.party_size).toMatchObject({ from: '4', to: '3' });
    expect(merged.proposals?.preferences?.to).toBe('onsen');
    expect(merged.values.budget_min_man).toBe(8); // 確かめていない行は新しい値
    expect(merged.values.budget_target).toBe('trip_total');
    expect(merged.notes).toEqual(['何もしない時間', '地元の市場']);
  });

  it('旅行全体の予算は宿泊費にならず、確かめた時だけ下書きへ渡る。確かめていない日数は使わない', () => {
    const r = initReview(ex(4, [], { min: 80000, max: 80000, scope: null, target: 'trip_total' }));
    expect(intentOf(r)).toMatchObject({ budget_target: 'undecided', budget_min: null, nights: 0 });
    const ok = intentOf({ ...r, confirmed: { ...r.confirmed, budget: true, nights: true } });
    expect(ok).toMatchObject({ budget_target: 'trip_total', budget_min: 80000, nights: 1 });
  });
});

describe('音声で入力', () => {
  it('安全な接続でない・対応していないブラウザでは理由を出し、文字で続けられる', () => {
    expect(speechSupport({ isSecureContext: false, webkitSpeechRecognition: function R() {} } as unknown as Window).reason)
      .toMatch(/安全な接続/);
    expect(speechSupport({ isSecureContext: true } as unknown as Window).reason).toMatch(/対応していません/);
    render(<VoiceInput onAdd={vi.fn()} support={{ ctor: null, reason: '理由の文' }} />);
    expect(screen.getByTestId('consult-voice-unavailable')).toHaveTextContent('理由の文');
  });

  it('録音 → 停止(自動では送らない)→ 文字起こしを直して「相談に追加」', () => {
    let inst: { onresult: (e: unknown) => void; onend: () => void } | null = null;
    function FakeRec(this: Record<string, unknown>) {
      this.start = () => undefined;
      this.stop = () => undefined;
      this.abort = () => undefined;
      inst = this as unknown as typeof inst;
    }
    const onAdd = vi.fn();
    render(<VoiceInput onAdd={onAdd} support={{ ctor: FakeRec as never, reason: null }} />);
    fireEvent.click(screen.getByTestId('consult-voice-start'));
    expect(screen.getByRole('status')).toHaveTextContent('聞き取っています');
    const res = Object.assign([{ transcript: '温泉に行きたい' }], { isFinal: true });
    act(() => inst!.onresult({ resultIndex: 0, results: [res] }));
    fireEvent.click(screen.getByTestId('consult-voice-stop'));
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('consult-voice-text'), { target: { value: '温泉と市場に行きたい' } });
    fireEvent.click(screen.getByTestId('consult-voice-add'));
    expect(onAdd).toHaveBeenCalledWith('温泉と市場に行きたい');
  });
});

describe('[Gate InputMode] 音声の声の大きさ', () => {
  it('録音中は onLevels へ棒を渡し(マイクを測れない時は [] = 飾りの棒)、止めると null', () => {
    let inst: { onresult: (e: unknown) => void } | null = null;
    function FakeRec(this: Record<string, unknown>) {
      this.start = () => undefined; this.stop = () => undefined; this.abort = () => undefined;
      inst = this as unknown as typeof inst;
    }
    const onLevels = vi.fn();
    render(<VoiceInput onAdd={vi.fn()} support={{ ctor: FakeRec as never, reason: null }} onLevels={onLevels} />);
    expect(onLevels).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByTestId('consult-voice-start'));
    expect(inst).not.toBeNull();
    expect(onLevels).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByTestId('consult-voice-stop'));
    expect(onLevels).toHaveBeenLastCalledWith(null);
  });
});

describe('その他の希望', () => {
  it('足す・直す・消す', () => {
    const onChange = vi.fn();
    const { rerender } = render(<NotesEditor notes={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('その他の希望を足す'), { target: { value: '何もしない時間' } });
    fireEvent.click(screen.getByRole('button', { name: '足す' }));
    expect(onChange).toHaveBeenLastCalledWith(['何もしない時間']);
    rerender(<NotesEditor notes={['何もしない時間']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '消す' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('[Gate AdminUAT U05] 食い違う希望', () => {
  it('AI が見つけた食い違いを、片方に決めずに「確かめてほしいこと」として出す', async () => {
    const { SuggestedAreasPanel } = await import('./ConsultAiPanels');
    render(<SuggestedAreasPanel suggestions={[]} unknowns={[]} areaNames={[]} onToggle={vi.fn()}
      contradictions={['日帰りと泊まりが食い違っています。どちらですか']} />);
    expect(screen.getByTestId('consult-ai-contradictions')).toHaveTextContent('日帰りと泊まりが食い違っています');
    expect(screen.getByRole('heading', { name: /確かめてほしいこと/ })).toBeInTheDocument();
    expect(screen.queryByTestId('consult-ai-suggestions')).toBeNull();
  });
});

describe('[F07-3] 追加の相談を黙って切り捨てない', () => {
  it('反映を断られた時は理由を示し、入力した文章を消さない。反映した時だけ消す', () => {
    const onSend = vi.fn().mockReturnValueOnce('相談の文章が上限の 3000 文字を越えます').mockReturnValueOnce(null);
    render(<FollowUp busy={false} aiReady canUndo={false} onSend={onSend} onUndo={vi.fn()} />);
    const box = screen.getByTestId('consult-followup-text');
    fireEvent.change(box, { target: { value: 'やっぱり3人に変更' } });
    fireEvent.click(screen.getByTestId('consult-followup-ai'));
    expect(onSend).toHaveBeenLastCalledWith('やっぱり3人に変更', true);
    expect(screen.getByTestId('consult-followup-refused')).toHaveTextContent('上限の 3000 文字');
    expect(box).toHaveValue('やっぱり3人に変更');
    fireEvent.click(screen.getByTestId('consult-followup-rules'));
    expect(box).toHaveValue('');
    expect(screen.queryByTestId('consult-followup-refused')).toBeNull();
  });
});
