/** [Gate MapTools] 地図の最大化と Google マップのリンク */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MapTools from './MapTools';
import { googleMapLinks } from './mapToolsModel';

const p = (n: number) => ({ latitude: 35 + n / 100, longitude: 135 + n / 100 });

describe('Google マップのリンク', () => {
  it('2 か所以上は順番どおりの経路、場所の分からない予定は数えて除く', () => {
    const r = googleMapLinks([p(1), { latitude: undefined, longitude: undefined }, p(2), p(3)]);
    expect(r.used).toBe(3);
    expect(r.missing).toBe(1);
    expect(r.urls).toHaveLength(1);
    const u = new URL(r.urls[0]!);
    expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/');
    expect(u.searchParams.get('origin')).toBe('35.01,135.01');
    expect(u.searchParams.get('waypoints')).toBe('35.02,135.02');
    expect(u.searchParams.get('destination')).toBe('35.03,135.03');
  });

  it('1 か所はその場所、0 か所はリンク無し、多い日は続きに分ける', () => {
    expect(googleMapLinks([p(1)]).urls[0]).toBe('https://www.google.com/maps/search/?api=1&query=35.01%2C135.01');
    expect(googleMapLinks([]).urls).toEqual([]);
    expect(googleMapLinks(Array.from({ length: 15 }, (_, i) => p(i))).urls.length).toBe(2);
  });
});

describe('地図の操作', () => {
  it('最大化を切り替え、Google マップは新しいタブで開く', () => {
    const toggle = vi.fn();
    const { rerender } = render(<MapTools stops={[p(1), p(2)]} maximized={false} onToggleMax={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: '地図を最大化' }));
    expect(toggle).toHaveBeenCalledTimes(1);
    const link = screen.getByRole('link', { name: 'Google マップで表示' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    rerender(<MapTools stops={[]} maximized onToggleMax={toggle} />);
    expect(screen.getByRole('button', { name: '元の大きさ' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('map-google')).toBeDisabled();
  });
});
