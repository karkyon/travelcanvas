import { describe, it, expect, beforeEach } from 'vitest';
import { rememberSearch, recallSearch, forgetSearch, SEARCH_MEMORY_TTL_MS } from './searchMemory';

describe('searchMemory', () => {
  beforeEach(() => forgetSearch());
  it('同じ持ち主には返し、別の持ち主・古い結果・消した後には返さない', () => {
    rememberSearch('u-1', '伊勢', [{ id: 'a' }], 1000);
    expect(recallSearch('u-1', 2000)).toEqual({ query: '伊勢', results: [{ id: 'a' }] });
    expect(recallSearch('u-2', 2000)).toBeNull();
    expect(recallSearch(null, 2000)).toBeNull();
    expect(recallSearch('u-1', 1000 + SEARCH_MEMORY_TTL_MS + 1)).toBeNull();
    forgetSearch();
    expect(recallSearch('u-1', 2000)).toBeNull();
  });
  it('端末(localStorage・sessionStorage)には書かない', () => {
    localStorage.clear(); sessionStorage.clear();
    rememberSearch('u-1', '伊勢', [{ id: 'a' }]);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});
