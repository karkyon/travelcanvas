/** [Gate SpotLinks] 電話は tel: のリンク、URL は新しいタブ(http/https だけ)。入力の確かめ。 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpotLinks from './SpotLinks';
import { cleanUrls, isHttpUrl, linkText, sameUrls } from './spotLinksModel';

describe('spotLinksModel', () => {
  it('http/https だけ・空の行は捨てる・同じ URL は 1 件・5 件まで', () => {
    expect(isHttpUrl('https://a.example/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('a.example')).toBe(false);
    expect(cleanUrls(['', ' https://a.example ', 'https://a.example'])).toEqual({ urls: [{ url: 'https://a.example', label: null }], error: null });
    expect(cleanUrls(['ftp://x.example']).error).toMatch('URL の形ではありません');
    expect(cleanUrls(Array.from({ length: 7 }, (_, i) => `https://e${i}.example/`)).urls).toHaveLength(5);
    expect(sameUrls([{ url: 'https://a.example' }], [{ url: 'https://a.example', label: 'x' }])).toBe(true);
    expect(linkText({ url: 'https://www.kiyomizudera.or.jp/' })).toBe('kiyomizudera.or.jp');
    expect(linkText({ url: 'https://x.example', label: '公式' })).toBe('公式');
  });
});

describe('SpotLinks', () => {
  it('電話は tel: で、URL は新しいタブで開く', () => {
    render(<SpotLinks phone="075-551-1234" urls={[{ url: 'https://www.kiyomizudera.or.jp/' }, { url: 'javascript:alert(1)' }]} />);
    expect(screen.getByRole('link', { name: '電話をかける 075-551-1234' })).toHaveAttribute('href', 'tel:0755511234');
    const site = screen.getByRole('link', { name: /kiyomizudera\.or\.jp/ });
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('何も無ければ出さない', () => {
    const { container } = render(<SpotLinks phone={null} urls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
