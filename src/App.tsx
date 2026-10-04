import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Crown,
  Flag,
  LogOut,
  MoreHorizontal,
  Plus,
  Share2,
  SlidersHorizontal,
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
import { faceColors } from './cube';
import { generateScramble } from './scramble';
import { Setup } from './components/Setup';
import { PuzzleIcon } from './components/CubeNet';
import { Stats } from './components/Stats';
import { Timer } from './components/Timer';
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
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {title && (
        <div className="section-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
      )}
      {children}
    </dialog>
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
  const [tab, setTab] = useState<'timer' | 'me' | 'battle'>('timer');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'end' | null>(null);
  const [toast, setToast] = useState('');
  const [editProfile, setEditProfile] = useState(false);
  const [draft, setDraft] = useState(profile);
  const game = useRoom(profile);
  const { room, session, status, error, setError, send } = game;
  const roomRef = useRef(room);
  roomRef.current = room;
  const round = room ? currentRound(room) : undefined;
  const host = room?.hostId === session?.playerId;
  const allDone = roundDone(round);
  const connected = status === 'connected';
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
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
  useEffect(() => {
    setTab('timer');
  }, [round?.number]);
  useEffect(() => {
    if (room?.phase === 'finished') setTab('battle');
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
      await navigator.clipboard.writeText(
        link ? `${location.origin}/?room=${room!.code}` : room!.code,
      );
      setToast(link ? 'Link copied' : 'Code copied');
    } catch {
      setError('Clipboard unavailable. Copy the room code manually.');
    }
  }
  async function share() {
    if (!room) return;
    try {
      if (navigator.share)
        await navigator.share({
          url: `${location.origin}/?room=${room.code}`,
        });
      else await copy(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError('Sharing unavailable. Copy the room code instead.');
    }
  }
  const themeSwitch = (
    <div className="theme-switch" role="group" aria-label="theme">
      {['classic', 'volt'].map((t) => (
        <button
          key={t}
          aria-label={`${t === 'classic' ? 'Classic' : 'Volt'} theme`}
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
        >
          <span className={`swatch ${t}`} />
        </button>
      ))}
    </div>
  );
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
              <i key={i} />
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
        {needRefresh && (
          <button className="secondary" onClick={() => updateServiceWorker(true)}>
            Update app
          </button>
        )}
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
          active={tab === 'timer' && !menu && !confirm && !editProfile}
        />
        {tab === 'me' && <Stats room={room} playerId={session!.playerId} personal />}
        {tab === 'battle' && <Stats room={room} playerId={session!.playerId} />}
        {allDone && room.phase !== 'finished' && (
          <div className="next-round">
            <button
              className="primary"
              disabled={!host || !connected || busy || room.players.some((p) => !p.connected)}
              onClick={advance}
            >
              {busy
                ? 'Generating…'
                : host
                  ? room.rounds && room.history.length >= room.rounds
                    ? 'Finish session'
                    : 'Next round'
                  : 'Waiting for host'}
              {host && <ArrowRight size={19} />}
            </button>
          </div>
        )}
        <nav className="room-nav" aria-label="Room">
          {(
            [
              { id: 'timer', label: 'Timer', Icon: TimerIcon },
              { id: 'me', label: 'Me', Icon: UserRound },
              { id: 'battle', label: 'Battle', Icon: Trophy },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={22} />
              {label}
              {id === 'battle' && round && (
                <span className={`nav-badge ${allDone ? 'done' : ''}`}>
                  {round.solves.filter((s) => s.status === 'done').length}/{round.solves.length}
                </span>
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
      {content}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
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
    </main>
  );
}
