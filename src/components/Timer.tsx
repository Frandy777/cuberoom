import { useEffect, useRef } from 'react';
import type { ClientMessage, RoomState } from '../../shared/protocol';
import { currentRound } from '../../shared/protocol';
import { solveTime, statistics, time } from '../../shared/stats';
import { CubeNet } from './CubeNet';
import { useTimer } from '../hooks/useTimer';
import { enter } from '../motion';
import { Thumb } from './Thumb';
export function Timer({
  room,
  playerId,
  connected,
  send,
  active,
}: {
  room: RoomState;
  playerId: string;
  connected: boolean;
  send: (m: ClientMessage) => boolean;
  active: boolean;
}) {
  const round = currentRound(room)!;
  const solve = round.solves.find((s) => s.playerId === playerId);
  const timer = useTimer(room.code, round.number, solve, connected, send);
  const stats = statistics(room.history, playerId);
  const scrambleRef = useRef<HTMLParagraphElement>(null);
  const netRef = useRef<HTMLElement>(null);
  // Timer is keyed by round, so this marks each new scramble arriving.
  useEffect(() => {
    if (scrambleRef.current) enter(scrambleRef.current, 0, 250);
    const net = netRef.current?.firstElementChild;
    if (net) enter(net, 40, 250);
  }, []);
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      if (
        e.code !== 'Space' ||
        e.repeat ||
        (e.target as HTMLElement).closest('input,textarea,select,button,a,[role="dialog"]')
      )
        return;
      e.preventDefault();
      timer.down();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if ((e.target as HTMLElement).closest('input,textarea,select,button,a,[role="dialog"]'))
        return;
      e.preventDefault();
      timer.up();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      timer.cancel();
    };
  }, [active, timer.down, timer.up, timer.cancel]);
  const finished = solve?.status === 'done';
  const display = finished ? solveTime(solve) : time(timer.ms);
  return (
    <div className="timer-page" hidden={!active}>
      <section className={`card scramble ${finished ? 'solved' : ''}`}>
        <p ref={scrambleRef}>{round.scramble}</p>
      </section>
      <div className="preview-row">
        <section className="card net-card" ref={netRef}>
          <CubeNet event={room.event} scramble={round.scramble} />
        </section>
        <div className="mini-stats">
          <div className="mini-stat accent-light">
            <small>Ao5</small>
            <strong>{time(stats.ao5)}</strong>
          </div>
          <div className="mini-stat card">
            <small>Best</small>
            <strong>{time(stats.best)}</strong>
          </div>
        </div>
      </div>
      {!solve ? (
        <section className="timer-pad spectator">
          <strong>Joining next round</strong>
        </section>
      ) : timer.lost ? (
        <section className="timer-pad">
          <p>Timer could not be restored.</p>
          <button
            className="primary"
            disabled={!connected}
            onClick={() => {
              send({ type: 'finish', round: round.number, ms: 0 });
              send({ type: 'penalty', round: round.number, penalty: 'DNF' });
            }}
          >
            Mark DNF
          </button>
        </section>
      ) : finished ? (
        <section className="timer-pad solved" aria-label="Your time">
          <div className="solved-time">
            <strong className={`timer-value ${display.length > 6 ? 'long-time' : ''}`}>
              {display.replace(/\+$/, '')}
            </strong>
            {solve.penalty === '+2' && <span className="plus">+</span>}
          </div>
          {room.phase === 'playing' && (
            <div className="penalties" role="group" aria-label="Penalty">
              <Thumb
                index={['none', '+2', 'DNF'].indexOf(solve.penalty)}
                count={3}
                pad={6}
                gap={6}
              />
              {(['none', '+2', 'DNF'] as const).map((p) => (
                <button
                  key={p}
                  disabled={!connected}
                  aria-pressed={solve.penalty === p}
                  onClick={() => send({ type: 'penalty', round: round.number, penalty: p })}
                >
                  {p === 'none' ? 'OK' : p}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <button
          className={`timer-pad ${timer.mode}`}
          aria-label={
            timer.mode === 'running' ? 'Stop timer' : 'Timer. Hold, then release to start'
          }
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            timer.down();
          }}
          onPointerUp={timer.up}
          onPointerCancel={timer.cancel}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
              e.preventDefault();
              timer.down();
            }
          }}
          onKeyUp={(e) => {
            if (e.code === 'Space' || e.code === 'Enter') {
              e.preventDefault();
              timer.up();
            }
          }}
        >
          <strong className={`timer-value ${display.length > 6 ? 'long-time' : ''}`}>
            {display}
          </strong>
          {timer.mode !== 'running' && (
            <span>
              {timer.mode === 'armed'
                ? 'Release to start'
                : timer.mode === 'holding'
                  ? 'Hold…'
                  : timer.mode === 'stopped'
                    ? 'Saving…'
                    : !connected
                      ? 'Reconnecting…'
                      : 'Hold to start'}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
