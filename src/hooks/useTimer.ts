import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, Solve } from '../../shared/protocol';
export function useTimer(
  code: string,
  round: number,
  solve: Solve | undefined,
  connected: boolean,
  send: (m: ClientMessage) => boolean,
) {
  const key = `timer:${code}:${round}`;
  const initial = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
        start: number;
        ms?: number;
      } | null;
    } catch {
      return null;
    }
  };
  const data = useRef(initial());
  const [ms, setMs] = useState(data.current?.ms ?? 0);
  const [mode, setMode] = useState<'idle' | 'holding' | 'armed' | 'running' | 'stopped'>(
    data.current ? (data.current.ms !== undefined ? 'stopped' : 'running') : 'idle',
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (mode !== 'running') return;
    let frame: number;
    const tick = () => {
      setMs(Math.max(0, performance.timeOrigin + performance.now() - (data.current?.start ?? 0)));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  useEffect(() => {
    if (solve?.status === 'done') {
      setMode('stopped');
      setMs(solve.ms ?? 0);
      sessionStorage.removeItem(key);
    }
  }, [solve?.status, solve?.ms, key]);
  useEffect(() => () => clearTimeout(hold.current), []);
  const stop = useCallback(() => {
    const elapsed = Math.max(
      0,
      Math.floor(performance.timeOrigin + performance.now() - data.current!.start),
    );
    data.current = { ...data.current!, ms: elapsed };
    sessionStorage.setItem(key, JSON.stringify(data.current));
    setMs(elapsed);
    setMode('stopped');
    modeRef.current = 'stopped';
    send({ type: 'finish', round, ms: elapsed });
  }, [key, round, send]);
  const down = useCallback(() => {
    if (modeRef.current === 'running') {
      stop();
      return;
    }
    if (modeRef.current !== 'idle' || !connected || solve?.status !== 'ready') return;
    modeRef.current = 'holding';
    setMode('holding');
    hold.current = setTimeout(() => {
      modeRef.current = 'armed';
      setMode('armed');
      navigator.vibrate?.(25);
    }, 350);
  }, [connected, solve?.status, stop]);
  const cancel = useCallback(() => {
    clearTimeout(hold.current);
    if (modeRef.current === 'holding' || modeRef.current === 'armed') {
      modeRef.current = 'idle';
      setMode('idle');
    }
  }, []);
  const up = useCallback(() => {
    clearTimeout(hold.current);
    if (modeRef.current === 'armed' && connected) {
      data.current = { start: performance.timeOrigin + performance.now() };
      sessionStorage.setItem(key, JSON.stringify(data.current));
      send({ type: 'start', round });
      modeRef.current = 'running';
      setMode('running');
    } else if (modeRef.current === 'holding' || modeRef.current === 'armed') {
      modeRef.current = 'idle';
      setMode('idle');
    }
  }, [connected, key, round, send]);
  useEffect(() => {
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [cancel]);
  return { ms, mode, down, up, cancel, lost: solve?.status === 'solving' && !data.current };
}
