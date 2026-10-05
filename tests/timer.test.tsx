// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimer } from '../src/hooks/useTimer';
import type { Solve } from '../shared/protocol';
let root: Root,
  container: HTMLDivElement,
  timer: ReturnType<typeof useTimer>,
  now: number,
  connected: boolean;
const send = vi.fn(() => true);
const solve: Solve = {
  playerId: 'a',
  name: 'A',
  color: 1,
  status: 'ready',
  ms: null,
  penalty: 'none',
};
function Harness() {
  timer = useTimer('ABC234', 1, solve, connected, send);
  return null;
}
function render() {
  act(() => root.render(<Harness />));
}
beforeEach(() => {
  vi.useFakeTimers();
  now = 1000;
  connected = true;
  send.mockClear();
  sessionStorage.clear();
  solve.status = 'ready';
  solve.ms = null;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('client performance timer', () => {
  it('ignores a short touch and starts only on release after 350ms', () => {
    act(() => timer.down());
    act(() => vi.advanceTimersByTime(200));
    act(() => timer.up());
    expect(timer.mode).toBe('idle');
    expect(send).not.toHaveBeenCalled();
    act(() => timer.down());
    act(() => vi.advanceTimersByTime(350));
    expect(timer.mode).toBe('armed');
    expect(send).not.toHaveBeenCalled();
    now = 1350;
    act(() => timer.up());
    expect(timer.mode).toBe('running');
    expect(send).toHaveBeenCalledWith({ type: 'start', round: 1 });
    now = 14350;
    act(() => timer.down());
    expect(timer.getMs()).toBe(13000);
    expect(timer.mode).toBe('stopped');
    expect(send).toHaveBeenLastCalledWith({ type: 'finish', round: 1, ms: 13000 });
  });
  it('allows an active timer to stop while offline but blocks offline starts', () => {
    connected = false;
    render();
    act(() => timer.down());
    act(() => vi.advanceTimersByTime(400));
    act(() => timer.up());
    expect(timer.mode).toBe('idle');
    connected = true;
    render();
    act(() => timer.down());
    act(() => vi.advanceTimersByTime(400));
    act(() => timer.up());
    connected = false;
    render();
    now = 6000;
    act(() => timer.down());
    expect(send).toHaveBeenLastCalledWith({ type: 'finish', round: 1, ms: 5000 });
    expect(JSON.parse(sessionStorage.getItem('timer:ABC234:1')!).ms).toBe(5000);
  });
  it('cancels the armed state on focus loss', () => {
    act(() => timer.down());
    act(() => vi.advanceTimersByTime(400));
    act(() => window.dispatchEvent(new Event('blur')));
    act(() => timer.up());
    expect(timer.mode).toBe('idle');
    expect(send).not.toHaveBeenCalled();
  });
  it('restores an in-progress timer on remount, and clears the pending time after acknowledgment', () => {
    act(() => timer.down());
    act(() => vi.advanceTimersByTime(400));
    act(() => timer.up());
    act(() => root.unmount());
    root = createRoot(container);
    now = 9000;
    render();
    expect(timer.mode).toBe('running');
    act(() => timer.down());
    expect(timer.getMs()).toBe(8000);
    solve.status = 'done';
    solve.ms = 8000;
    render();
    expect(sessionStorage.getItem('timer:ABC234:1')).toBeNull();
    expect(timer.mode).toBe('stopped');
  });
});
