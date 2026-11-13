/** [Gate Remaining-1] public/tc-push-sw.js のアプリの殻: API を置かない・通信できない時は置いた画面を出す */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Handler = (event: Record<string, unknown>) => void;

function loadSw() {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (req: Request | string, res: Response) => { store.set(typeof req === 'string' ? req : new URL(req.url).pathname, res); }),
    keys: vi.fn(async () => [...store.keys()].map((k) => new Request(`https://tc.test${k}`))),
    delete: vi.fn(async () => true),
    addAll: vi.fn(async () => undefined),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ['tc-shell-v0', 'tc-shell-v1', 'other']),
    delete: vi.fn(async () => true),
    match: vi.fn(async (req: Request | string) => store.get(typeof req === 'string' ? req : new URL(req.url).pathname)),
  };
  const self = {
    location: { origin: 'https://tc.test' },
    addEventListener: (name: string, h: Handler) => { handlers[name] = h; },
    skipWaiting: vi.fn(), clients: { claim: vi.fn() }, registration: {},
  };
  const code = readFileSync(resolve(__dirname, '../../public/tc-push-sw.js'), 'utf-8');
  const fetchMock = vi.fn();
  new Function('self', 'caches', 'fetch', code)(self, caches, fetchMock);
  return { handlers, store, caches, fetchMock };
}

function fire(h: Handler, request: Request & { mode?: string }) {
  let responded: Promise<Response> | null = null;
  h({ request, respondWith: (p: Promise<Response>) => { responded = p; }, waitUntil: () => undefined });
  return responded as Promise<Response> | null;
}

describe('アプリの殻の Service Worker', () => {
  let sw: ReturnType<typeof loadSw>;
  beforeEach(() => { sw = loadSw(); });

  it('API・他のサイト・GET 以外には関わらない', () => {
    expect(fire(sw.handlers.fetch!, new Request('https://tc.test/api/v1/plans'))).toBeNull();
    expect(fire(sw.handlers.fetch!, new Request('https://other.test/assets/a.js'))).toBeNull();
    expect(fire(sw.handlers.fetch!, new Request('https://tc.test/assets/a.js', { method: 'POST' }))).toBeNull();
  });

  it('/assets/ は置いた物を優先し、無ければ取って置く', async () => {
    sw.fetchMock.mockResolvedValue(new Response('js', { status: 200 }));
    const r = await fire(sw.handlers.fetch!, new Request('https://tc.test/assets/a.js'))!;
    expect(await r.text()).toBe('js');
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('画面の移動は通信を優先し、通信できない時は置いた画面を出す', async () => {
    sw.store.set('/', new Response('<html>shell</html>', { headers: { 'content-type': 'text/html' } }));
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));
    const req = Object.assign(new Request('https://tc.test/planner/p1/today'), {});
    Object.defineProperty(req, 'mode', { value: 'navigate' });
    const r = await fire(sw.handlers.fetch!, req)!;
    expect(await r.text()).toBe('<html>shell</html>');
  });

  it('新しい版になったら古いアプリの殻だけを消す', async () => {
    let p: Promise<unknown> = Promise.resolve();
    sw.handlers.activate!({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
    expect(sw.caches.delete).toHaveBeenCalledWith('tc-shell-v0');
    expect(sw.caches.delete).not.toHaveBeenCalledWith('other');
  });
});
