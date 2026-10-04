// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoom } from '../src/hooks/useRoom';
import type { RoomState, ServerMessage, Session } from '../shared/protocol';
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: { type: string; token?: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
const session: Session = { code: 'ABC234', token: crypto.randomUUID(), playerId: 'a' };
const room: RoomState = {
  code: 'ABC234',
  event: '333',
  rounds: 5,
  hostId: 'a',
  phase: 'lobby',
  createdAt: 0,
  history: [],
  players: [{ id: 'a', name: 'A', color: 1, connected: true, disconnectedAt: null }],
};
let root: Root, container: HTMLDivElement, game: ReturnType<typeof useRoom>, hidden: boolean;
function Harness() {
  game = useRoom({ name: 'A', color: 1 });
  return null;
}
const last = () => FakeSocket.all.at(-1)!;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
async function render() {
  act(() => root.render(<Harness />));
  await flush();
}
async function join() {
  act(() => game.connect(session.code, session));
  await flush();
  act(() => {
    last().open();
    last().receive({ type: 'welcome', session });
    last().receive({ type: 'state', room });
  });
}
async function setHidden(value: boolean) {
  hidden = value;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  hidden = false;
  sessionStorage.clear();
  // Node's own localStorage global shadows jsdom's and is unusable without a file.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { OPEN: 1, CLOSED: 3 }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status: 200 })),
  );
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('room connection lifecycle', () => {
  it('keeps the session through any number of network failures', async () => {
    await render();
    await join();
    for (let i = 0; i < 12; i++) {
      act(() => last().drop());
      await advance(10_000);
    }
    expect(FakeSocket.all).toHaveLength(13);
    expect(game.session).toEqual(session);
    expect(game.status).toBe('connecting');
    expect(game.room).toEqual(room);
  });
  it('pauses retries while hidden and reconnects as soon as the page returns', async () => {
    await render();
    await join();
    await setHidden(true);
    act(() => last().drop());
    await advance(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    await setHidden(false);
    expect(FakeSocket.all).toHaveLength(2);
    act(() => last().open());
    expect(last().sent[0]).toMatchObject({ type: 'join', token: session.token });
  });
  it('replaces a socket that looks open but died while frozen', async () => {
    await render();
    await join();
    await setHidden(true);
    await setHidden(false);
    expect(last().sent.at(-1)).toEqual({ type: 'ping' });
    await advance(4000);
    expect(FakeSocket.all).toHaveLength(2);
  });
  it('keeps a socket that answers the probe', async () => {
    await render();
    await join();
    await setHidden(true);
    await setHidden(false);
    act(() => last().receive({ type: 'pong' }));
    await advance(4000);
    expect(FakeSocket.all).toHaveLength(1);
  });
  it('resumes a recent session after the app was killed', async () => {
    localStorage.setItem('cuberoom-resume', JSON.stringify({ session, savedAt: Date.now() }));
    await render();
    act(() => last().open());
    expect(last().url).toContain('/api/rooms/ABC234/ws');
    expect(last().sent[0]).toMatchObject({ type: 'join', token: session.token });
  });
  it('does not resume a stale session', async () => {
    localStorage.setItem(
      'cuberoom-resume',
      JSON.stringify({ session, savedAt: Date.now() - 6 * 60_000 }),
    );
    await render();
    expect(FakeSocket.all).toHaveLength(0);
    expect(game.session).toBeNull();
  });
  it('ends only on explicit server answers', async () => {
    await render();
    await join();
    act(() => last().drop(4002));
    expect(game.session).toBeNull();
    expect(game.ended).toBe('Connected in another tab.');
    expect(localStorage.getItem('cuberoom-resume')).not.toBeNull();
    await join();
    act(() => last().receive({ type: 'ended', reason: 'The host ended the room.' }));
    expect(localStorage.getItem('cuberoom-resume')).toBeNull();
  });
});
