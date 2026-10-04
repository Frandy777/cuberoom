import { useState, type CSSProperties } from 'react';
import { Check, Crown, Eye, LogOut, WifiOff } from 'lucide-react';
import type { Player, RoomState, Solve } from '../../shared/protocol';
import { currentRound, roundDone } from '../../shared/protocol';
import { solveTime, statistics, time, value, winners } from '../../shared/stats';
import { Thumb } from './Thumb';

export function Stats({
  room,
  playerId,
  personal = false,
}: {
  room: RoomState;
  playerId: string;
  personal?: boolean;
}) {
  const [view, setView] = useState<'round' | 'session'>('round');
  const current = currentRound(room);
  const roster = new Map(
    room.history.flatMap((r) =>
      r.solves.map((s) => [s.playerId, { id: s.playerId, name: s.name, color: s.color }] as const),
    ),
  );
  for (const p of room.players) roster.set(p.id, p);
  const players = [...roster.values()].filter((p) => !personal || p.id === playerId);
  const stats = statistics(room.history, playerId);
  const allStats = players.map((p) => ({ ...p, ...statistics(room.history, p.id) }));
  const best = room.history
    .flatMap((r) => r.solves.map((s) => ({ ...s, round: r.number })))
    .filter((s) => Number.isFinite(value(s)))
    .sort((a, b) => value(a) - value(b))[0];
  const leader = [...allStats].sort((a, b) => b.wins - a.wins)[0];
  const maxWins = Math.max(0, ...allStats.map((p) => p.wins));
  const completed = room.history.filter(roundDone).length;
  const showSession = personal || view === 'session' || room.phase === 'finished';
  const doneCount = current?.solves.filter((s) => s.status === 'done').length ?? 0;
  return (
    <div className="stats-content">
      {!personal && room.phase !== 'finished' && (
        <div className="segmented battle-switch">
          <Thumb index={view === 'session' ? 1 : 0} count={2} pad={4} gap={4} />
          <button aria-pressed={view === 'round'} onClick={() => setView('round')}>
            This round
          </button>
          <button aria-pressed={view === 'session'} onClick={() => setView('session')}>
            Session
          </button>
        </div>
      )}
      {personal && (
        <div className="personal-metrics">
          {[
            ['Ao5', time(stats.ao5)],
            ['Best', time(stats.best)],
            ['Mean', time(stats.mean)],
            ['Wins', `${stats.wins}/${room.history.filter(roundDone).length}`],
          ].map(([label, v], i) => (
            <div
              className={`personal-metric ${i === 0 || i === 3 ? 'accent' : 'card'}`}
              key={label}
            >
              <small>{label}</small>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
      )}
      {!showSession && current && (
        <>
          <section className="round-progress" aria-label="Round progress">
            <div className="round-tally mono">
              <strong>{doneCount}</strong>
              <span>/{current.solves.length}</span>
            </div>
            <div
              className="round-bars"
              style={{ gridTemplateColumns: `repeat(${current.solves.length}, minmax(0, 1fr))` }}
            >
              {current.solves.map((s, i) => (
                <i key={s.playerId} className={i < doneCount ? 'filled' : ''} />
              ))}
            </div>
          </section>
          <div className="round-bento" data-count={current.solves.length}>
            {[...current.solves]
              .sort((a, b) => Number(b.playerId === playerId) - Number(a.playerId === playerId))
              .map((s) => (
                <PlayerTile
                  key={s.playerId}
                  solve={s}
                  player={room.players.find((p) => p.id === s.playerId)}
                  you={s.playerId === playerId}
                  win={winners(current).includes(s.playerId)}
                />
              ))}
          </div>
        </>
      )}
      {showSession && (
        <>
          {!personal && (
            <>
              <div className="session-summary">
                <div className="session-rounds">
                  <small>Rounds</small>
                  <strong
                    style={fit(
                      String(completed).length * 0.48 +
                        (room.rounds ? (`/${room.rounds}`.length + 0.5) * 0.48 * 0.4 : 0),
                    )}
                  >
                    {completed}
                    {!!room.rounds && <span>/{room.rounds}</span>}
                  </strong>
                </div>
                <div className={best ? `color-${best.color}` : 'card'}>
                  <small>Best single</small>
                  <strong
                    className="mono"
                    style={fit((best ? solveTime(best) : '—').length * 0.55)}
                  >
                    {best ? solveTime(best) : '—'}
                  </strong>
                  {best && (
                    <small>
                      {best.name} · R{best.round}
                    </small>
                  )}
                </div>
                <div className={leader && leader.wins > 0 ? `color-${leader.color}` : 'card'}>
                  <small>Most wins</small>
                  <strong className="session-leader">
                    {leader && leader.wins > 0
                      ? leader.id === playerId
                        ? 'You'
                        : leader.name
                      : '—'}
                  </strong>
                </div>
              </div>
              {allStats.length > 0 && (
                <section className="card wins-table" aria-label="Wins">
                  <small>Wins</small>
                  {allStats.map((p) => (
                    <div className="wins-row" key={p.id}>
                      <b>{p.id === playerId ? 'You' : p.name}</b>
                      <span className="wins-bar">
                        <i
                          className={`color-${p.color}`}
                          style={
                            {
                              '--pct': `${maxWins ? (p.wins / maxWins) * 100 : 0}%`,
                            } as CSSProperties
                          }
                        />
                      </span>
                      <strong className="mono">{p.wins}</strong>
                    </div>
                  ))}
                </section>
              )}
              {allStats.map((p) => (
                <section key={p.id} className={`stat-player color-${p.color}`}>
                  <div className="section-heading">
                    <div className="inline">
                      <span className="avatar inverse">{p.name[0]}</span>
                      <b>{p.id === playerId ? 'You' : p.name}</b>
                    </div>
                  </div>
                  <div className="metrics">
                    {[
                      ['Best', time(p.best)],
                      ['Mean', time(p.mean)],
                      ['Ao5', time(p.ao5)],
                      ['DNF', p.dnf],
                    ].map(([label, v]) => (
                      <div key={label}>
                        <small>{label}</small>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
          {personal && <SolveLog room={room} player={players.find((p) => p.id === playerId)} />}
          {!personal && <RoundLog room={room} players={players} playerId={playerId} />}
        </>
      )}
    </div>
  );
}

const STATES = {
  inspecting: { label: 'Inspecting', icon: <Eye size={22} aria-hidden /> },
  solving: { label: 'Solving', icon: <SpinnerArc size={22} /> },
  done: { label: 'Done', icon: <Check size={22} strokeWidth={3} aria-hidden /> },
  offline: { label: 'Offline', icon: <WifiOff size={22} aria-hidden /> },
  left: { label: 'Left', icon: <LogOut size={22} aria-hidden /> },
};

// A player who left is closed out as a DNF, so "left" wins over "done".
function liveState(solve: Solve, player?: Player): keyof typeof STATES {
  if (!player) return 'left';
  if (solve.status === 'done') return 'done';
  if (!player.connected) return 'offline';
  return solve.status === 'solving' ? 'solving' : 'inspecting';
}

function PlayerTile({
  solve,
  player,
  you,
  win,
}: {
  solve: Solve;
  player?: Player;
  you: boolean;
  win: boolean;
}) {
  const state = liveState(solve, player);
  const { label, icon } = STATES[state];
  return (
    <div className={`bento-player is-${state} ${state === 'done' ? `color-${solve.color}` : ''}`}>
      <div className="bento-who">
        <span className={`avatar ${state === 'done' ? 'inverse' : `color-${solve.color}`}`}>
          {solve.name[0]}
        </span>
        <b>{you ? 'You' : solve.name}</b>
        {win && <Crown className="bento-crown" size={20} aria-label="Round winner" />}
      </div>
      <div className="bento-status">
        {icon}
        <div className="bento-label">
          <strong>{label}</strong>
          {solve.status === 'done' && <small className="mono">{solveTime(solve)}</small>}
        </div>
      </div>
    </div>
  );
}

// Scales a number down so it fits its card; `ems` is the text width at 1em.
function fit(ems: number) {
  return { '--fit-em': ems } as CSSProperties;
}

function SolveLog({ room, player }: { room: RoomState; player?: { id: string } }) {
  if (!player) return null;
  const rows = room.history
    .map((r) => ({ round: r, solve: r.solves.find((s) => s.playerId === player.id) }))
    .filter((r) => r.solve)
    .reverse();
  if (!rows.length) return null;
  // Best/Worst only rank finished times; a DNF already reads as the worst.
  const times = rows.map((r) => value(r.solve!)).filter(Number.isFinite);
  const best = Math.min(...times);
  const worst = Math.max(...times);
  return (
    <section className="solve-log" aria-label="Your solves">
      <div className="section-heading">
        <b>Solves</b>
      </div>
      <div className="solve-list">
        {rows.map(({ round, solve }) => {
          const s = solve!;
          const v = value(s);
          const pb = times.length > 0 && v === best;
          const pw = times.length > 1 && best !== worst && v === worst;
          return (
            <div className="solve-item" key={round.number}>
              <span className="solve-no mono" aria-label={`Round ${round.number}`}>
                {round.number}
              </span>
              <span className="solve-tags">
                {pb && <span className="tag accent">Best</span>}
                {pw && <span className="tag worst">Worst</span>}
              </span>
              {s.status === 'solving' ? (
                <SpinnerArc className="solving" size={20} aria-label="Solving" />
              ) : (
                <strong className={`mono ${s.status === 'done' ? '' : 'faint'}`}>
                  {solveTime(s)}
                </strong>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RoundLog({
  room,
  players,
  playerId,
}: {
  room: RoomState;
  players: { id: string; name: string; color: number }[];
  playerId: string;
}) {
  if (!room.history.length || !players.length) return null;
  const columns = { gridTemplateColumns: `repeat(${players.length}, minmax(0, 1fr))` };
  return (
    <section className="solve-log" aria-label="Round results">
      <div className="section-heading">
        <b>Rounds</b>
      </div>
      <div className="solve-row log-head">
        <span className="solve-round" aria-hidden />
        <div className="log-cells" style={columns}>
          {players.map((p) => (
            <span
              key={p.id}
              className={`avatar color-${p.color}`}
              title={p.id === playerId ? 'You' : p.name}
              aria-label={p.id === playerId ? 'You' : p.name}
            >
              {p.name[0]}
            </span>
          ))}
        </div>
      </div>
      {[...room.history].reverse().map((r) => {
        const won = winners(r);
        return (
          <div className="solve-row" key={r.number}>
            <span className="solve-round mono" aria-label={`Round ${r.number}`}>
              {r.number}
            </span>
            <div className="log-cells" style={columns}>
              {players.map((p) => {
                const solve = r.solves.find((s) => s.playerId === p.id);
                return (
                  <span key={p.id} className="log-cell">
                    {solve?.status === 'solving' ? (
                      <SpinnerArc className="solving" size={18} aria-label="Solving" />
                    ) : (
                      <strong
                        className={`mono ${won.includes(p.id) ? `winner color-${p.color}` : ''} ${
                          solve?.status === 'done' ? '' : 'faint'
                        }`}
                      >
                        {solveTime(solve)}
                      </strong>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function SpinnerArc({
  size,
  className = '',
  ...rest
}: {
  size: number;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <svg
      className={`spinner-arc ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      role={rest['aria-label'] ? 'img' : undefined}
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
