import { describe, it, expect } from 'vitest';
import { safeInternalPath } from './safeNavigation';

describe('safeInternalPath (Gate S1)', () => {
  it('アプリ内のパスはそのまま返す', () => {
    expect(safeInternalPath('/planner/abc/preparation')).toBe('/planner/abc/preparation');
    expect(safeInternalPath('/planner?tab=1#x')).toBe('/planner?tab=1#x');
  });

  it.each([
    'https://evil.example/', '//evil.example', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)',
    'planner', '', '   ', '/a\u0000b', '/\tevil', null, undefined, 42,
  ])('外部・危険な移動先は拒否する: %s', (target) => {
    expect(safeInternalPath(target)).toBeNull();
  });
});
