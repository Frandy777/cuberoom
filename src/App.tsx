import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChartLine,
  Check,
  Copy,
  Crown,
  Flag,
  LogOut,
  MoreHorizontal,
  Plus,
  QrCode as QrIcon,
  RefreshCw,
  ScanQrCode,
  Share2,
  SlidersHorizontal,
  Swords,
  Timer as TimerIcon,
  Trophy,
  UserPen,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react';
import {
  currentRound,
  profileSchema,
  roundDone,
  type Profile,
  type Session,
  type Settings,
} from '../shared/protocol';
import { useRoom } from './hooks/useRoom';
import { SPLIT, useMediaQuery } from './hooks/useMediaQuery';
import { faceColors } from './cube';
import { generateScramble } from './scramble';
import { Setup } from './components/Setup';
import { PuzzleIcon } from './components/CubeNet';
import { Stats } from './components/Stats';
import { Timer } from './components/Timer';
import { Thumb } from './components/Thumb';
import { QrCode, Scanner, roomLink } from './components/Qr';
import { Presence, useEntrance, useExiting, usePop } from './motion';
import { useRegisterSW } from 'virtual:pwa-register/react';

function initialProfile(): Profile {
  try {
    return profileSchema.parse(JSON.parse(localStorage.getItem('cuberoom-profile') ?? ''));
  } catch {
    return { name: 'Alex', color: 1 };
  }
}
function Modal({
  title,
  onClose,
  children,
}: {
  title?: string;
  // Omit to make the dialog undismissable.
  onClose?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const exiting = useExiting();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      data-closing={exiting || undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      // Browsers may force-close on repeated Escape despite preventDefault.
      onClose={(e) => {
        if (!onClose) e.currentTarget.showModal();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {title && (
        <div className="section-heading">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-button" onClick={onClose} aria-label="Close">
              <X />
            </button>
          )}
        </div>
      )}
      {children}
    </dialog>
  );
}
function Badge({ done, total }: { done: number; total: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  usePop(ref, done);
  return (
    <span ref={ref} className={`nav-badge ${done === total ? 'done' : ''}`}>
      {done}/{total}
    </span>
  );
}
// Tells the host on the timer that everyone's done, so the next round is one tap away.
function RoundReady({
  round,
  label,
  disabled,
  onNext,
  onClose,
}: {
  round: number;
  label: string;
  disabled: boolean;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div className="round-ready" role="status" data-closing={useExiting() || undefined}>
      <div>
        <small>Round {round}</small>
        <strong>All done</strong>
      </div>
      <button className="round-ready-next" disabled={disabled} onClick={onNext}>
        {label}
        <ArrowRight size={18} />
      </button>
      <button className="round-ready-close" aria-label="Dismiss" onClick={onClose}>
        <X size={20} />
      </button>
    </div>
  );
}
function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status" data-closing={useExiting() || undefined}>
      <Check size={18} />
      {text}
    </div>
  );
}
function ProfileEditor({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
}) {
  return (
    <section className="card profile-editor">
      <div className="inline">
        <span className={`avatar color-${profile.color}`}>{profile.name.trim()[0] ?? '?'}</span>
        <input
          aria-label="Name"
          placeholder="Name"
          maxLength={16}
          value={profile.name}
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
        />
      </div>
      <div className="color-picker" aria-label="Color">
        {[1, 2, 3, 4].map((c) => (
          <button
            key={c}
            aria-label={`Color ${c}`}
            aria-pressed={profile.color === c}
            onClick={() => onChange({ ...profile, color: c })}
          >
            <span className={`color-${c}`}>{profile.color === c && <Check size={16} />}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
export default function App() {
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('cuberoom-theme') === 'volt' ? 'volt' : 'classic',
  );
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [page, setPage] = useState<'home' | 'create' | 'settings'>('home');
  const [roomCode, setRoomCode] = useState(
    () => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '',
  );
  const [tab, setTab] = useState<'timer' | 'round' | 'stats' | 'standings'>('timer');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'end' | null>(null);
  const [toast, setToast] = useState('');
  const [editProfile, setEditProfile] = useState(false);
  const [qr, setQr] = useState(false);
  const [scan, setScan] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [updating, setUpdating] = useState(false);
  // On wide screens the timer stays up and the other tabs share a side panel beside it.
  const split = useMediaQuery(SPLIT);
  const side = tab === 'timer' ? 'round' : tab;
  const timerShown = split || tab === 'timer';
  const game = useRoom(profile);
  const { room, session, status, error, setError, send } = game;
  const roomRef = useRef(room);
  roomRef.current = room;
  const round = room ? currentRound(room) : undefined;
  const host = room?.hostId === session?.playerId;
  const allDone = roundDone(round);
  const connected = status === 'connected';
  const canAdvance = host && connected && !busy && !!room && room.players.every((p) => p.connected);
  const nextLabel = busy
    ? 'Generating…'
    : room?.rounds && room.history.length >= room.rounds
      ? 'Finish session'
      : 'Next round';
  // The round whose ready prompt the host closed; a new round brings it back.
  const [dismissed, setDismissed] = useState<number>();
  const view = game.connecting
    ? 'connecting'
    : page === 'create' || (page === 'settings' && room)
      ? page
      : !room
        ? 'home'
        : room.phase === 'lobby'
          ? 'lobby'
          : 'room';
  const pageRef = useRef<HTMLDivElement>(null);
  useEntrance(pageRef, view);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // A standalone PWA can stay open for days; check whenever it's reopened.
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => {});
      });
    },
  });
  useLayoutEffect(() => {
    document.documentElement.className = `t-${theme}`;
    localStorage.setItem('cuberoom-theme', theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'volt' ? '#2B2A2D' : '#F0EEEA');
  }, [theme]);
  useEffect(() => {
    if (profileSchema.safeParse(profile).success)
      localStorage.setItem('cuberoom-profile', JSON.stringify(profile));
  }, [profile]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timeout);
  }, [toast]);
  // A new round no longer pulls players off whatever tab they're on; a splash announces it.
  useEffect(() => {
    setTab('timer');
  }, [room?.code]);
  const [splash, setSplash] = useState<number>();
  const seenRound = useRef<{ code?: string; number: number }>({ number: 0 });
  useEffect(() => {
    const number = round?.number ?? 0;
    const prev = seenRound.current;
    // Only rounds started while we watch; joining or reconnecting mid-session stays quiet.
    if (room && prev.code === room.code && number > prev.number) setSplash(number);
    seenRound.current = { code: room?.code, number };
  }, [room?.code, round?.number]);
  useEffect(() => {
    if (room?.phase === 'finished') setTab('standings');
  }, [room?.phase]);
  function validProfile() {
    const r = profileSchema.safeParse(profile);
    if (!r.success) {
      setError('Enter a name with 1–16 characters.');
      return false;
    }
    return true;
  }
  async function create(settings: Settings) {
    if (!validProfile()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, ...settings }),
      });
      const data = (await res.json()) as Session & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not create a room.');
      game.connect(data.code, data);
      setPage('home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function advance() {
    if (!room || busy) return;
    setBusy(true);
    setError('');
    try {
      let scramble = 'R';
      if (!(room.rounds && room.history.length >= room.rounds)) {
        scramble = await generateScramble(room.event);
      }
      if (roomRef.current?.code === room.code)
        send({ type: 'next', round: round?.number ?? 0, scramble });
    } catch {
      setError('Could not generate a scramble. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function copy(link = false) {
    try {
      await navigator.clipboard.writeText(link ? roomLink(room!.code) : room!.code);
      setToast(link ? 'Link copied' : 'Code copied');
    } catch {
      setError('Clipboard unavailable. Copy the room code manually.');
    }
  }
  async function share() {
    if (!room) return;
    try {
      if (navigator.share) await navigator.share({ url: roomLink(room.code) });
      else await copy(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError('Sharing unavailable. Copy the room code instead.');
    }
  }
  function changeTheme(t: string) {
    if (t === theme) return;
    const apply = () => flushSync(() => setTheme(t));
    // Crossfade the whole page instead of snapping every color at once.
    if (document.startViewTransition) document.startViewTransition(apply);
    else apply();
  }
  const themeSwitch = (
    <div className="theme-switch" role="group" aria-label="theme">
      <Thumb index={theme === 'volt' ? 1 : 0} count={2} pad={4} gap={2} />
      {['classic', 'volt'].map((t) => (
        <button
          key={t}
          aria-label={`${t === 'classic' ? 'Classic' : 'Volt'} theme`}
          aria-pressed={theme === t}
          onClick={() => changeTheme(t)}
        >
          <span className={`swatch ${t}`} />
        </button>
      ))}
    </div>
  );
  const tabs = (
    [
      { id: 'timer', label: 'Timer', Icon: TimerIcon },
      { id: 'round', label: 'Round', Icon: Swords },
      { id: 'stats', label: 'Stats', Icon: ChartLine },
      { id: 'standings', label: 'Standings', Icon: Trophy },
    ] as const
  ).filter((t) => !split || t.id !== 'timer');
  let content: ReactNode;
  if (game.connecting)
    content = (
      <div className="connecting card">
        <div className="spinner" />
        <h2>Connecting…</h2>
        <p className="mono">{roomCode || session?.code}</p>

        <button className="secondary" onClick={() => game.clear('')}>
          Cancel
        </button>
      </div>
    );
  else if (page === 'create' || (page === 'settings' && room))
    content = (
      <Setup
        initial={room ?? { event: '333', rounds: 12 }}
        editing={page === 'settings'}
        busy={busy}
        onBack={() => setPage('home')}
        onSubmit={(settings) => {
          if (room) {
            send({ type: 'settings', ...settings });
            setPage('home');
          } else void create(settings);
        }}
      />
    );
  else if (!room)
    content = (
      <>
        <header className="header">
          <div className="brand">
            <span className="brand-mark">
              {(['R', 'B', 'D', 'F'] as const).map((f) => (
                <i key={f} style={{ background: faceColors[f] }} />
              ))}
            </span>
            <span>CubeRoom</span>
          </div>
          {themeSwitch}
        </header>
        {game.ended && (
          <section className="ended card">
            <div className="section-heading">
              <span>{game.ended}</span>
              <button
                className="icon-button"
                onClick={() => game.setEnded('')}
                aria-label="Dismiss"
              >
                <X size={18} />
              </button>
            </div>
          </section>
        )}
        <section className="hero">
          <div className="hero-cube" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} style={{ '--d': Math.floor(i / 3) + (i % 3) } as CSSProperties} />
            ))}
          </div>
          <div className="puzzle-tags">
            <span>2×2</span>
            <span>3×3</span>
            <span>4×4</span>
          </div>
          <h1>
            Same scramble.
            <br />
            Fastest
            <br />
            hands win.
          </h1>
        </section>
        <ProfileEditor profile={profile} onChange={setProfile} />
        <form
          className="card join-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validProfile()) return;
            if (!/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode)) {
              setError('Enter a 6-character room code.');
              return;
            }
            game.connect(roomCode);
          }}
        >
          <input
            aria-label="Room code"
            placeholder="CODE"
            value={roomCode}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
          />
          <button
            type="button"
            className="scan-button"
            aria-label="Scan room QR code"
            onClick={() => {
              setError('');
              setScan(true);
            }}
          >
            <ScanQrCode size={24} />
          </button>
          <button type="submit" className="join-button">
            Join
            <ArrowRight size={20} />
          </button>
        </form>
        <button
          className="create-card"
          onClick={() => {
            if (validProfile()) {
              setError('');
              setPage('create');
            }
          }}
        >
          <span>Create room</span>
          <i>
            <Plus size={28} />
          </i>
        </button>
      </>
    );
  else if (room.phase === 'lobby')
    content = (
      <>
        <header className="header">
          <button
            className="icon-button"
            onClick={() => setConfirm('leave')}
            aria-label="Leave room"
          >
            <ArrowLeft />
          </button>

          <button className="icon-button" aria-label="Room menu" onClick={() => setMenu(true)}>
            <SlidersHorizontal />
          </button>
        </header>
        <section className="room-code-card">
          <div className="section-heading">
            <div>
              <strong className="room-code">{room.code}</strong>
            </div>
            <span className="pill dark">
              <UserRound size={15} />
              {room.players.length}/4
            </span>
          </div>
          <div className="share-buttons">
            <button onClick={() => copy()}>
              <Copy size={17} />
              Copy
            </button>
            <button onClick={() => setQr(true)}>
              <QrIcon size={17} />
              QR
            </button>
            <button onClick={share}>
              <Share2 size={17} />
              Share
            </button>
          </div>
        </section>
        <div className="seats">
          {room.players.map((p) => (
            <div key={p.id} className={`seat color-${p.color}`}>
              <div className="section-heading">
                <span className="avatar inverse">{p.name[0]}</span>
                {p.id === room.hostId && (
                  <span className="avatar inverse" title="host">
                    <Crown size={22} />
                  </span>
                )}
              </div>
              <div>
                <b>{p.id === session?.playerId ? 'You' : p.name}</b>
                {!p.connected && <small>Reconnecting…</small>}
              </div>
            </div>
          ))}
          {Array.from({ length: 4 - room.players.length }, (_, i) => (
            <button
              className="empty-seat"
              key={`empty-${i}`}
              onClick={share}
              aria-label="Invite to open seat"
            >
              <Plus size={27} />
            </button>
          ))}
        </div>
        <section className="card room-settings">
          <div>
            <PuzzleIcon n={Number(room.event[0])} />
            <b>
              {room.event[0]}×{room.event[0]}
            </b>
          </div>
          <div>
            <strong className="mono">{room.rounds ?? '∞'}</strong>
            <small>rounds</small>
          </div>
          {host && (
            <button aria-label="Edit room settings" onClick={() => setPage('settings')}>
              <SlidersHorizontal size={20} />
            </button>
          )}
        </section>

        <button
          className="primary"
          disabled={!host || !connected || busy || room.players.some((p) => !p.connected)}
          onClick={advance}
        >
          {busy ? 'Generating…' : host ? 'Start' : 'Waiting for host'}
          <ArrowRight size={20} />
        </button>
      </>
    );
  else
    content = (
      <>
        <header className="header room-header">
          <span className="header-spacer" />
          <h2>{room.phase === 'finished' ? 'Finished' : `Round ${round?.number}`}</h2>
          <button className="icon-button" aria-label="Room menu" onClick={() => setMenu(true)}>
            <MoreHorizontal />
          </button>
        </header>
        <Timer
          key={`${room.code}:${round?.number}`}
          room={room}
          playerId={session!.playerId}
          connected={connected}
          send={send}
          visible={timerShown}
          active={timerShown && !menu && !confirm && !editProfile && !qr && !needRefresh}
        />
        {(split || tab !== 'timer') && (
          <Stats
            room={room}
            playerId={session!.playerId}
            view={side}
            action={
              allDone &&
              room.phase !== 'finished' && (
                <div className="next-round">
                  <button className="primary" disabled={!canAdvance} onClick={advance}>
                    {host ? nextLabel : 'Waiting for host'}
                    {host && <ArrowRight size={26} />}
                  </button>
                </div>
              )
            }
          />
        )}
        <nav className="room-nav" aria-label="Room">
          <Thumb
            index={tabs.findIndex((t) => t.id === (split ? side : tab))}
            count={tabs.length}
            pad={8}
            gap={6}
          />
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-current={(split ? side : tab) === id ? 'page' : undefined}
              onClick={(e) => {
                setTab(id);
                // A clicked tab keeps focus, which would swallow Space meant for the timer.
                if (split && e.detail) e.currentTarget.blur();
              }}
            >
              <Icon size={22} />
              {label}
              {id === 'round' && round && (
                <Badge
                  done={round.solves.filter((s) => s.status === 'done').length}
                  total={round.solves.length}
                />
              )}
            </button>
          ))}
        </nav>
      </>
    );
  return (
    <main className={`app ${room ? 'in-room' : ''}`}>
      {room && !connected && (
        <div className="connection-banner" role="status">
          <WifiOff size={16} />
          Connection lost. Reconnecting…
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={18} />
          </button>
        </div>
      )}
      <div className={`page view-${view}`} ref={pageRef}>
        {content}
      </div>
      {splash !== undefined && (
        <div
          key={splash}
          className="round-splash"
          role="status"
          data-accent={room?.players.find((p) => p.id === session?.playerId)?.color}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setSplash(undefined);
          }}
        >
          <small>Round</small>
          <strong className="mono">{splash}</strong>
        </div>
      )}
      <Presence ms={400}>{toast && <Toast text={toast} />}</Presence>
      <Presence>
        {host &&
          (split ? side !== 'round' : tab === 'timer') &&
          allDone &&
          room?.phase !== 'finished' &&
          round &&
          dismissed !== round.number && (
            <RoundReady
              round={round.number}
              label={nextLabel}
              disabled={!canAdvance}
              onNext={advance}
              onClose={() => setDismissed(round.number)}
            />
          )}
      </Presence>
      <Presence>
        {menu && room && (
          <Modal onClose={() => setMenu(false)}>
            <section className="menu-code">
              <div>
                <strong className="mono">{room.code}</strong>
                <small>
                  {room.event[0]}×{room.event[0]} ·{' '}
                  {room.phase === 'lobby'
                    ? 'Lobby'
                    : room.phase === 'finished'
                      ? 'Finished'
                      : `Round ${round?.number}${room.rounds ? `/${room.rounds}` : ''}`}
                </small>
              </div>
              <button aria-label="Copy room code" onClick={() => copy()}>
                <Copy size={22} />
              </button>
              <button
                aria-label="Show room QR code"
                onClick={() => {
                  setMenu(false);
                  setQr(true);
                }}
              >
                <QrIcon size={22} />
              </button>
              <button aria-label="Share room link" onClick={share}>
                <Share2 size={22} />
              </button>
            </section>
            <div className="menu-theme">
              <b>Theme</b>
              {themeSwitch}
            </div>
            <button
              className="menu-item"
              onClick={() => {
                setDraft(profile);
                setEditProfile(true);
                setMenu(false);
              }}
            >
              <UserPen size={22} />
              <b>Edit profile</b>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setMenu(false);
                setConfirm('leave');
              }}
            >
              <LogOut size={22} />
              <b>Leave room</b>
            </button>
            {host && (
              <button
                className="menu-item danger"
                onClick={() => {
                  setMenu(false);
                  setConfirm('end');
                }}
              >
                <Flag size={22} />
                <b>End room</b>
              </button>
            )}
          </Modal>
        )}
      </Presence>
      <Presence>
        {confirm && (
          <Modal
            title={confirm === 'end' ? 'End room?' : 'Leave room?'}
            onClose={() => setConfirm(null)}
          >
            <p>
              {confirm === 'end'
                ? 'All players will leave and all results will be cleared.'
                : 'An unfinished solve will be marked DNF.'}
            </p>
            <button
              className={confirm === 'end' ? 'danger-button' : 'primary'}
              onClick={() => {
                if (connected) send({ type: confirm });
                else if (confirm === 'leave') game.clear('');
                setConfirm(null);
                setPage('home');
              }}
              disabled={confirm === 'end' && !connected}
            >
              {confirm === 'end' ? 'End room' : 'Leave room'}
            </button>
            <button className="secondary" onClick={() => setConfirm(null)}>
              Keep playing
            </button>
          </Modal>
        )}
      </Presence>
      <Presence>
        {qr && room && (
          <Modal title="Scan to join" onClose={() => setQr(false)}>
            <div className="qr-card">
              <QrCode text={roomLink(room.code)} />
              <strong className="mono">{room.code}</strong>
            </div>
          </Modal>
        )}
      </Presence>
      <Presence>
        {scan && !room && (
          <Modal title="Scan to join" onClose={() => setScan(false)}>
            <Scanner
              onCode={(code) => {
                setScan(false);
                setRoomCode(code);
                if (validProfile()) game.connect(code);
              }}
            />
          </Modal>
        )}
      </Presence>
      <Presence>
        {editProfile && (
          <Modal title="Profile" onClose={() => setEditProfile(false)}>
            <ProfileEditor profile={draft} onChange={setDraft} />
            {!profileSchema.safeParse(draft).success && (
              <p className="hint">Enter a name with 1–16 characters.</p>
            )}
            <button
              className="primary"
              disabled={!connected || !profileSchema.safeParse(draft).success}
              onClick={() => {
                const p = profileSchema.safeParse(draft);
                if (!p.success) {
                  setError('Enter a name with 1–16 characters.');
                  return;
                }
                setProfile(p.data);
                send({ type: 'profile', ...p.data });
                setEditProfile(false);
              }}
            >
              Save
            </button>
          </Modal>
        )}
      </Presence>
      {needRefresh && (
        <Modal title="Update available">
          <p>
            A new version of CubeRoom is ready. Update to keep playing — you'll stay in your room.
          </p>
          <button
            className="primary"
            disabled={updating}
            onClick={() => {
              setUpdating(true);
              void updateServiceWorker(true);
            }}
          >
            {updating ? 'Updating…' : 'Update now'}
            {!updating && <RefreshCw size={19} />}
          </button>
        </Modal>
      )}
    </main>
  );
}
