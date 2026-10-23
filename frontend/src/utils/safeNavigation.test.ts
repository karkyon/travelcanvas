import { describe, it, expect } from 'vitest';
import { safeExternalUrl, safeInternalPath, safeTelHref } from './safeNavigation';

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

describe('移動先・外へ開く URL の安全化 (Gate G3 DEP-02)', () => {
  it.each([
    '/%2F%2Fevil.example', '/%2f%2fevil.example', '/%5Cevil.example', '/%255Cevil.example', '/%2F%2F%2Fevil',
    '/a%00b', '/a%09b', '/%E0%A4%A', '/ x'.replace(' ', '%0A'),
  ])('符号化した区切り・制御文字を拒否する: %s', (target) => {
    expect(safeInternalPath(target)).toBeNull();
  });

  it('符号化した普通の文字は通す', () => {
    expect(safeInternalPath('/search?q=%E4%BA%AC%E9%83%BD')).toBe('/search?q=%E4%BA%AC%E9%83%BD');
    expect(safeInternalPath('/planner/a%2Db')).toBe('/planner/a%2Db');
  });

  it('外へ開く URL は http・https だけ', () => {
    expect(safeExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeExternalUrl(' http://example.com ')).toBe('http://example.com/');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x',
      'file:///etc/passwd', '//evil.example', '/relative', 'https://user:pass@example.com/', 'https://exa mple.com',
      'https://example.com/\u0000', 'https:\\\\evil.example', '', null, undefined, 1, 'x'.repeat(3000)]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });

  it('電話のリンクは数字と + だけ', () => {
    expect(safeTelHref('03-1234-5678')).toBe('tel:0312345678');
    expect(safeTelHref('+81 (3) 1234')).toBe('tel:+8131234');
    expect(safeTelHref('javascript:alert(1)')).toBe('tel:1');
    expect(safeTelHref('なし')).toBeNull();
    expect(safeTelHref(undefined)).toBeNull();
  });
});
