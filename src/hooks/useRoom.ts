import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  Profile,
  RoomState,
  ServerMessage,
  Session,
} from '../../shared/protocol';
const KEY = 'cuberoom-session';
// Survives the OS killing a backgrounded PWA, which wipes sessionStorage.
const RESUME = 'cuberoom-resume';
// Matches the server's longest reconnect grace; older sessions are already gone.
const RESUME_TTL = 5 * 60_000;
const PING = JSON.stringify({ type: 'ping' });
function saved<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function restore(): Session | null {
  try {
    const resume = JSON.parse(localStorage.getItem(RESUME) ?? 'null') as {
      session: Session;
      savedAt: number;
    } | null;
    return (
      saved<Session>(KEY) ??
      (resume && Date.now() - resume.savedAt < RESUME_TTL ? resume.session : null)
    );
  } catch {
    return null;
  }
}
function remember(session: Session) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
  localStorage.setItem(RESUME, JSON.stringify({ session, savedAt: Date.now() }));
}
export function useRoom(profile: Profile) {
  const [session, setSession] = useState<Session | null>(restore);
  const [target, setTarget] = useState<string | null>(() => session?.code ?? null);
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
  // `forget: false` keeps the resumable session for the tab that took it over.
  const clear = useCallback((reason: string, forget = true) => {
    sessionRef.current = null;
    setSession(null);
    setTarget(null);
    setRoom(null);
    setStatus('offline');
    sessionStorage.removeItem(KEY);
    if (forget) localStorage.removeItem(RESUME);
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('timer:')) sessionStorage.removeItem(key);
    outbox.current = [];
    sessionStorage.removeItem('cuberoom-outbox');
    setEnded(reason);
  }, []);
  const connect = useCallback((code: string, credentials?: Session) => {
    sessionRef.current = credentials ?? null;
    setSession(credentials ?? null);
    if (credentials) remember(credentials);
    else {
      sessionStorage.removeItem(KEY);
      localStorage.removeItem(RESUME);
    }
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
      opening = false,
      retries = 0;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let timeout: ReturnType<typeof setTimeout>;
    let probe: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;
    let lastMessage = Date.now(),
      received = 0;
    const stopped = () => disposed || terminal;
    // Drop a socket without waiting for its close event: a socket killed while the
    // page was frozen may take a long time to report it, or never do.
    function retire() {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      clearTimeout(probe);
      if (!ws) return;
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      ws = socket.current = null;
    }
    function reconnect() {
      retire();
      clearTimeout(retry);
      if (stopped()) return;
      setStatus('connecting');
      // Only explicit server answers end the session. Network failures retry forever,
      // and a hidden page waits for `wake` instead of burning attempts while frozen.
      if (!document.hidden) retry = setTimeout(open, Math.min(1000 * 2 ** retries++, 10_000));
    }
    // The user is looking at the page now: reconnect immediately, not after a backoff.
    function restart() {
      retire();
      clearTimeout(retry);
      retries = 0;
      open();
    }
    function wake() {
      if (stopped() || document.hidden) return;
      if (ws?.readyState === WebSocket.OPEN) {
        const seen = received;
        ws.send(PING);
        clearTimeout(probe);
        probe = setTimeout(() => {
          if (received === seen) restart();
        }, 4000);
      } else if (!ws) restart();
    }
    async function open() {
      if (stopped() || opening || ws) return;
      opening = true;
      setStatus('connecting');
      try {
        const response = await fetch(`/api/rooms/${target}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (stopped()) return;
        if (response.status === 404) {
          terminal = true;
          clear('Room not found or no longer available.');
          return;
        }
      } catch {
        /* The WebSocket retry below handles temporary offline states. */
      } finally {
        opening = false;
      }
      if (stopped() || ws) return;
      const current = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${target}/ws`,
      );
      ws = socket.current = current;
      timeout = setTimeout(reconnect, 10_000);
      current.onopen = () => {
        clearTimeout(timeout);
        lastMessage = Date.now();
        current.send(
          JSON.stringify({ type: 'join', ...profileRef.current, token: sessionRef.current?.token }),
        );
        heartbeat = setInterval(() => {
          if (Date.now() - lastMessage > 35_000) reconnect();
          else current.send(PING);
        }, 10_000);
      };
      current.onmessage = (e) => {
        lastMessage = Date.now();
        received++;
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'welcome') {
          retries = 0;
          sessionRef.current = msg.session;
          setSession(msg.session);
          remember(msg.session);
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
          for (const m of outbox.current) current.send(JSON.stringify(m));
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
      current.onclose = (e) => {
        if (e.code === 4002) {
          terminal = true;
          clear('Connected in another tab.', false);
          return;
        }
        reconnect();
      };
      current.onerror = reconnect;
    }
    open();
    const visibility = () => {
      // Refresh the resume window: the OS may kill the app any time it is hidden.
      if (document.hidden) {
        if (sessionRef.current) remember(sessionRef.current);
      } else wake();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    return () => {
      disposed = true;
      clearTimeout(retry);
      retire();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', wake);
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
