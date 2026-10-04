import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  Profile,
  RoomState,
  ServerMessage,
  Session,
} from '../../shared/protocol';
const KEY = 'cuberoom-session';
function saved<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
export function useRoom(profile: Profile) {
  const [session, setSession] = useState<Session | null>(() => saved(KEY));
  const [target, setTarget] = useState<string | null>(() => saved<Session>(KEY)?.code ?? null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<'offline' | 'connecting' | 'connected'>('offline');
  const [error, setError] = useState('');
  const [ended, setEnded] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const sessionRef = useRef(session);
  const profileRef = useRef(profile);
  const outbox = useRef<ClientMessage[]>(saved('cuberoom-outbox') ?? []);
  profileRef.current = profile;
  const saveOutbox = () =>
    sessionStorage.setItem('cuberoom-outbox', JSON.stringify(outbox.current));
  const clear = useCallback((reason: string) => {
    sessionRef.current = null;
    setSession(null);
    setTarget(null);
    setRoom(null);
    setStatus('offline');
    sessionStorage.removeItem(KEY);
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('timer:')) sessionStorage.removeItem(key);
    outbox.current = [];
    sessionStorage.removeItem('cuberoom-outbox');
    setEnded(reason);
  }, []);
  const connect = useCallback((code: string, credentials?: Session) => {
    sessionRef.current = credentials ?? null;
    setSession(credentials ?? null);
    if (credentials) sessionStorage.setItem(KEY, JSON.stringify(credentials));
    else sessionStorage.removeItem(KEY);
    outbox.current = [];
    sessionStorage.removeItem('cuberoom-outbox');
    setEnded('');
    setError('');
    setTarget(code);
  }, []);
  useEffect(() => {
    if (!target) return;
    let disposed = false,
      terminal = false,
      retries = 0;
    let retry: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;
    let lastMessage = Date.now();
    async function open() {
      if (disposed || terminal) return;
      setStatus('connecting');
      try {
        const response = await fetch(`/api/rooms/${target}`);
        if (disposed || terminal) return;
        if (response.status === 404) {
          terminal = true;
          clear('Room not found or no longer available.');
          return;
        }
      } catch {
        /* The WebSocket retry below handles temporary offline states. */
      }
      if (disposed || terminal) return;
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${target}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        lastMessage = Date.now();
        ws.send(
          JSON.stringify({ type: 'join', ...profileRef.current, token: sessionRef.current?.token }),
        );
        heartbeat = setInterval(() => {
          if (Date.now() - lastMessage > 35_000) {
            ws.close();
            return;
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 10_000);
      };
      ws.onmessage = (e) => {
        lastMessage = Date.now();
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'welcome') {
          retries = 0;
          sessionRef.current = msg.session;
          setSession(msg.session);
          sessionStorage.setItem(KEY, JSON.stringify(msg.session));
          setStatus('connected');
          setError('');
        }
        if (msg.type === 'state') {
          setRoom(msg.room);
          const round = msg.room.history.at(-1),
            solve = round?.solves.find((s) => s.playerId === sessionRef.current?.playerId);
          outbox.current = outbox.current.filter(
            (m) =>
              'round' in m &&
              m.round === round?.number &&
              ((m.type === 'start' && solve?.status === 'ready') ||
                (m.type === 'finish' && solve?.status !== 'done')),
          );
          saveOutbox();
          for (const m of outbox.current) ws.send(JSON.stringify(m));
        }
        if (msg.type === 'error') {
          setError(msg.message);
          if (msg.fatal) {
            terminal = true;
            clear('');
          }
        }
        if (msg.type === 'ended') {
          terminal = true;
          clear(msg.reason);
        }
      };
      ws.onclose = (e) => {
        clearInterval(heartbeat);
        if (disposed || terminal) return;
        if (e.code === 4002) {
          terminal = true;
          clear('Connected in another tab.');
          return;
        }
        setStatus('connecting');
        if (++retries > 6) {
          terminal = true;
          clear('Could not connect. Check your network or room code.');
          return;
        }
        retry = setTimeout(open, Math.min(1000 * 2 ** (retries - 1), 8000));
      };
      ws.onerror = () => ws.close();
    }
    open();
    const online = () => {
      if (socket.current?.readyState === WebSocket.CLOSED) {
        clearTimeout(retry);
        open();
      }
    };
    window.addEventListener('online', online);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      window.removeEventListener('online', online);
      socket.current?.close();
      socket.current = null;
    };
  }, [target, clear]);
  const send = useCallback((msg: ClientMessage) => {
    if (msg.type === 'start' || msg.type === 'finish') {
      outbox.current = outbox.current.filter((m) => m.type !== msg.type);
      outbox.current.push(msg);
      saveOutbox();
    }
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(msg));
      return true;
    }
    if (msg.type !== 'finish') setError('Connection lost. Reconnecting…');
    return false;
  }, []);
  return {
    room,
    session,
    status,
    error,
    setError,
    ended,
    setEnded,
    connect,
    send,
    clear,
    connecting: !!target && !room,
  };
}
