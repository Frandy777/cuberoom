import { useState } from 'react';
import { Crown } from 'lucide-react';
import type { RoomState } from '../../shared/protocol';
import { currentRound, roundDone } from '../../shared/protocol';
import { solveTime, statistics, time, value, winners } from '../../shared/stats';

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
  const showSession = personal || view === 'session' || room.phase === 'finished';
  const ranked = [...(current?.solves ?? [])].sort((a, b) => value(a) - value(b));
  const doneCount = current?.solves.filter((s) => s.status === 'done').length ?? 0;
  return (
    <div className="stats-content">
      {!personal && room.phase !== 'finished' && (
        <div className="segmented battle-switch">
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
              className={`personal-metric ${i === 0 ? 'color-4' : i === 3 ? 'color-3' : 'card'}`}
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
          <div className="live-round">
            {ranked.map((s, i) => {
              const p = room.players.find((p) => p.id === s.playerId);
              const win = winners(current).includes(s.playerId);
              const note = !p
                ? 'Left'
                : !p.connected
                  ? 'Offline'
                  : s.status === 'done' && s.penalty !== 'none'
                    ? s.penalty
                    : '';
              return (
                <div className={`live-player ${win ? 'round-winner' : ''}`} key={s.playerId}>
                  <span className="rank mono">
                    {s.status === 'done' && Number.isFinite(value(s)) ? i + 1 : ''}
                  </span>
                  <span className={`avatar color-${s.color}`}>{s.name[0]}</span>
                  <b>{s.playerId === playerId ? 'You' : s.name}</b>
                  {win && <Crown size={18} aria-label="Round winner" />}
                  {note && <span className="tag">{note}</span>}
                  {s.status === 'solving' && (
                    <SpinnerArc className="solving" size={22} aria-label="Solving" />
                  )}
                  {s.status === 'done' && <strong className="mono">{time(value(s))}</strong>}
                </div>
              );
            })}
          </div>
          {!roundDone(current) && (
            <p className="waiting-label">
              <SpinnerArc size={18} />
              Waiting for{' '}
              {current.solves
                .filter((s) => s.status !== 'done')
                .map((s) => (s.playerId === playerId ? 'you' : s.name))
                .join(', ')}
            </p>
          )}
        </>
      )}
      {showSession && (
        <>
          {!personal && (
            <>
              <div className="session-summary">
                <div className="card">
                  <small>Rounds</small>
                  <strong>
                    {room.history.filter(roundDone).length}
                    <span className="faint">{room.rounds ? `/${room.rounds}` : ''}</span>
                  </strong>
                </div>
                <div className="color-4">
                  <small>Best single</small>
                  <strong>{best ? solveTime(best) : '—'}</strong>
                  {best && (
                    <small>
                      {best.name} · R{best.round}
                    </small>
                  )}
                </div>
              </div>
              {leader && leader.wins > 0 && (
                <section className={`wins-summary color-${leader.color}`}>
                  <small>Most wins</small>
                  <strong>{leader.id === playerId ? 'You' : leader.name}</strong>
                  <b className="mono">
                    {leader.wins}/{room.history.filter(roundDone).length}
                  </b>
                </section>
              )}
              {allStats.map((p) => (
                <section key={p.id} className={`stat-player color-${p.color}`}>
                  <div className="section-heading">
                    <div className="inline">
                      <span className="avatar inverse">{p.name[0]}</span>
                      <b>{p.id === playerId ? 'You' : p.name}</b>
                    </div>
                    <span className="wins">Wins {p.wins}</span>
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
          {!personal && (
            <section className="card history">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Round</th>
                      {players.map((p) => (
                        <th key={p.id}>{p.id === playerId ? 'You' : p.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...room.history].reverse().map((r) => (
                      <tr key={r.number}>
                        <th>R{r.number}</th>
                        {players.map((p) => {
                          const solve = r.solves.find((s) => s.playerId === p.id);
                          return (
                            <td key={p.id}>
                              <span
                                className={
                                  winners(r).includes(p.id) ? `winner color-${p.color}` : ''
                                }
                              >
                                {solveTime(solve)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SolveLog({ room, player }: { room: RoomState; player?: { id: string; color: number } }) {
  if (!player) return null;
  const rows = room.history
    .map((r) => ({ round: r, solve: r.solves.find((s) => s.playerId === player.id) }))
    .filter((r) => r.solve)
    .reverse();
  if (!rows.length) return null;
  const best = Math.min(...rows.map((r) => value(r.solve!)));
  return (
    <section className="solve-log" aria-label="Your solves">
      <div className="section-heading">
        <b>Solves</b>
        <small className="mono">{rows.filter((r) => r.solve!.status === 'done').length}</small>
      </div>
      {rows.map(({ round, solve }) => {
        const s = solve!;
        const win = winners(round).includes(player.id);
        const pb = Number.isFinite(best) && value(s) === best;
        return (
          <div className="solve-row" key={round.number}>
            <span
              className={`solve-round mono ${win ? `color-${player.color}` : ''}`}
              aria-label={`Round ${round.number}`}
            >
              {round.number}
            </span>
            <span className="solve-tags">
              {win && <Crown size={18} aria-label="Round winner" />}
              {pb && <span className="tag color-4">Best</span>}
              {s.status === 'done' && s.penalty !== 'none' && (
                <span className="tag penalty">{s.penalty}</span>
              )}
            </span>
            {s.status === 'solving' ? (
              <SpinnerArc className="solving" size={22} aria-label="Solving" />
            ) : (
              <strong className={`mono ${s.status === 'done' ? '' : 'faint'}`}>
                {s.status === 'done' ? time(value(s)) : '—'}
              </strong>
            )}
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
