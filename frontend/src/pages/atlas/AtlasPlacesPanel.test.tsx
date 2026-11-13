/** [Gate Remaining-2] FR-052 Atlas の地名のまとめ(押した時だけ調べる・続きを調べる・訪問の数) */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ getAtlasPlaces: vi.fn() }));
vi.mock('@/services/api/remaining2', () => ({ getAtlasPlaces: m.getAtlasPlaces }));

import AtlasPlacesPanel from './AtlasPlacesPanel';

describe('AtlasPlacesPanel', () => {
  it('国・都道府県・市区町村にまとめ、残りがあれば続きを調べる', async () => {
    m.getAtlasPlaces.mockResolvedValueOnce({
      year: 2026, pending: 3, unresolved: 1, enabled: true, sources: '国土地理院',
      visited: { countries: 1, regions: 1, municipalities: 2 },
      countries: [{ country_code: 'JP', country: '日本', state: 'STAYED', cells: 4, regions: [
        { name: '京都府', state: 'STAYED', cells: 4, municipalities: [
          { name: '京都市', state: 'STAYED', cells: 3 }, { name: '宇治市', state: 'VISITED', cells: 1 }] }] }],
    });
    render(<AtlasPlacesPanel year={2026} />);
    fireEvent.click(screen.getByRole('button', { name: '地名でまとめる' }));
    expect(await screen.findByText('◆ 日本(滞在・4区画)')).toBeInTheDocument();
    expect(screen.getByText(/京都市\(滞在\)、宇治市\(訪問\)/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('訪れた国 1 ・ 都道府県(州) 1 ・ 市区町村 2 ・ 地名の分からない区画 1');
    expect(m.getAtlasPlaces).toHaveBeenCalledWith(2026);
    expect(screen.getByRole('button', { name: '続きを調べる(残り3区画)' })).toBeInTheDocument();
  });
});
