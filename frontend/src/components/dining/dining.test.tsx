/** [Gate SpotInfo] 食事の情報: 空を除く・空だけ埋める・要約・表示。 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiningSummary from './DiningSummary';
import { cleanDining, diningBadges, mergeEmptyDining } from './diningModel';

describe('diningModel', () => {
  it('空の項目を除き、全て空なら null', () => {
    expect(cleanDining({ genres: [], signature: '  ', hours: null })).toBeNull();
    expect(cleanDining({ genres: ['sushi'], signature: ' 握り ' })).toEqual({ genres: ['sushi'], signature: '握り' });
  });
  it('今の値が空の項目だけを埋める', () => {
    expect(mergeEmptyDining({ genres: ['ramen'] }, { genres: ['sushi'], hours: '11-21' })).toEqual({ genres: ['ramen'], hours: '11-21' });
    expect(mergeEmptyDining(null, null)).toBeNull();
  });
  it('短い印', () => {
    expect(diningBadges({ budget_lunch: 'u1000', budget_dinner: '3000_5000', reservation: 'required', parking: 'none', private_room: true }))
      .toEqual(['昼 〜1,000円', '夜 3,000〜5,000円', '予約が必要', '駐車場なし', '個室あり']);
  });
});

describe('DiningSummary', () => {
  it('ジャンル・名物・予算・予約・駐車場・支払い・営業時間・特徴を出す', () => {
    render(<DiningSummary dining={{ genres: ['yakiniku'], signature: '黒毛和牛', budget_dinner: '5000_10000', reservation: 'recommended',
      parking: 'yes', parking_note: '10 台', payment: ['card', 'emoney'], hours: '17:00-23:00', closed: '火曜', seats: 40,
      features: ['kids', 'tatami'], moods: ['family'], smoking: 'no', access: '駅から徒歩 3 分', wait_note: '週末は混む' }} />);
    const el = screen.getByTestId('dining-summary');
    for (const t of ['焼肉', '黒毛和牛', '5,000〜10,000円', '予約がおすすめ', '駐車場あり(10 台)', 'カード・電子マネー',
      '17:00-23:00 / 定休 火曜', '40 席', '全席禁煙', '子ども連れ歓迎', '座敷', '家族で', '駅から徒歩 3 分', '週末は混む']) {
      expect(el).toHaveTextContent(t);
    }
  });
  it('無ければ出さない', () => {
    const { container } = render(<DiningSummary dining={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
