import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ClientMessage, RoomState } from '../../shared/protocol';
import { currentRound } from '../../shared/protocol';
import { solveTime, statistics, time } from '../../shared/stats';
import { CubeNet } from './CubeNet';
import { useTimer } from '../hooks/useTimer';
import { easeDrawer, easeOut, enter, reducedMotion } from '../motion';
import { Thumb } from './Thumb';

type Box = { pad: DOMRect; text: DOMRect; font: number };

// The pad and its time, measured without in-flight transforms.
function measure(pad: HTMLElement): Box | undefined {
  const text = pad.querySelector('.timer-value');
  if (!text) return;
  return {
    pad: pad.getBoundingClientRect(),
    text: text.getBoundingClientRect(),
    font: parseFloat(getComputedStyle(text).fontSize),
  };
}

const FULL = 'inset(0px round 0px)';
// Clips the full-screen pad (`box`) down to the pad's in-place rect `r`, or `k` of the way there.
const slotClip = (r: DOMRect, box: DOMRect, k = 1) =>
  `inset(${(r.top - box.top) * k}px ${(box.right - r.right) * k}px ${(box.bottom - r.bottom) * k}px ${(r.left - box.left) * k}px round 32px)`;
// Between the slot and full screen, keeping the corners round for all but the quarter of the
// way nearest full screen. Offsets are in eased progress, so growing squares the corners off
// over the curve's slow tail, and shrinking rounds them right away.
const morphClip = (r: DOMRect, box: DOMRect, grow: boolean) => {
  const frames = [
    { clipPath: slotClip(r, box) },
    { clipPath: slotClip(r, box, 0.25), offset: grow ? 0.75 : 0.25 },
    { clipPath: FULL },
  ];
  return grow ? frames : frames.reverse();
};
// Moves the time from where it sits in `from` to where it sits in `to`.
const flyTo = (from: Box, to: Box) =>
  `translate(${to.text.x + to.text.width / 2 - from.text.x - from.text.width / 2}px, ${
    to.text.y + to.text.height / 2 - from.text.y - from.text.height / 2
  }px) scale(${to.font / from.font})`;

// Morphs the pad between its place and full screen as the timer starts and stops: the color
// grows out of (and back into) the pad with clip-path while the time flies between the two
// spots. On stop the pad stays fixed until it lands, so `exiting` holds back the solved view.
function useFullscreen(
  padRef: RefObject<HTMLElement | null>,
  mode: ReturnType<typeof useTimer>['mode'],
  finished: boolean,
) {
  const running = mode === 'running';
  const [exiting, setExiting] = useState(false);
  const [wasRunning, setWasRunning] = useState(running);
  if (running !== wasRunning) {
    setWasRunning(running);
    setExiting(!running);
  }
  const slot = useRef<Box>(undefined);
  const landed = useRef<Box>(undefined);
  const flying = useRef<Animation[]>([]);
  const fly = (...anims: (Animation | undefined)[]) => (flying.current = anims.filter((a) => !!a));
  useLayoutEffect(() => {
    // The last frame before the timer starts, so the start morphs from exactly here.
    if (mode === 'armed' && padRef.current) slot.current = measure(padRef.current);
  }, [mode]);
  useLayoutEffect(() => {
    const pad = padRef.current;
    const text = pad?.querySelector('.timer-value');
    const from = slot.current;
    if (!running || !pad || !text || !from) return;
    if (reducedMotion()) {
      fly(pad.animate?.([{ opacity: 0 }, { opacity: 1 }], 200));
      return;
    }
    const full = measure(pad)!;
    const timing = { duration: 400, easing: easeDrawer };
    fly(
      pad.animate?.(morphClip(from.pad, full.pad, true), timing),
      text.animate?.({ transform: [flyTo(full, from), 'none'] }, timing),
    );
  }, [running]);
  useLayoutEffect(() => {
    const pad = padRef.current;
    const text = pad?.querySelector('.timer-value');
    if (!pad || !text) return;
    if (!exiting) {
      if (landed.current && reducedMotion()) pad.animate?.([{ opacity: 0 }, { opacity: 1 }], 200);
      return;
    }
    // A stop during the start morph reverses from wherever it got to; both are `none` at rest.
    const clip = getComputedStyle(pad).clipPath;
    const transform = getComputedStyle(text).transform;
    flying.current.forEach((a) => a.cancel());
    const full = measure(pad)!;
    pad.classList.remove('exiting');
    const to = (landed.current = measure(pad)!);
    pad.classList.add('exiting');
    // Filled until React drops `exiting`, so the pad never flashes full screen in between.
    const timing = { duration: 400, easing: easeDrawer, fill: 'forwards' as const };
    const anims = reducedMotion()
      ? fly(pad.animate?.([{ opacity: 1 }, { opacity: 0 }], { ...timing, duration: 200 }))
      : fly(
          pad.animate?.(
            clip === 'none'
              ? morphClip(to.pad, full.pad, false)
              : { clipPath: [clip, slotClip(to.pad, full.pad)] },
            timing,
          ),
          text.animate?.({ transform: [transform, flyTo(full, to)] }, timing),
        );
    if (anims[0])
      anims[0].finished.then(
        () => setExiting(false),
        () => {},
      );
    else setExiting(false);
    return () => anims.forEach((a) => a.cancel());
  }, [exiting]);
  const solved = finished && !exiting;
  useLayoutEffect(() => {
    // The saved time moves up to make room for the penalties.
    const from = landed.current;
    const pad = padRef.current;
    if (!solved || !from || !pad) return;
    landed.current = undefined;
    const to = measure(pad);
    const penalties = pad.querySelector('.penalties');
    if (penalties) enter(penalties, 0, 250);
    if (!to || reducedMotion()) return;
    pad.querySelector('.timer-value')?.animate?.(
      { transform: [flyTo(to, { ...from, font: to.font }), 'none'] },
      {
        duration: 300,
        easing: easeOut,
      },
    );
  }, [solved]);
  return exiting;
}
export function Timer({
  room,
  playerId,
  connected,
  send,
  visible,
  active,
}: {
  room: RoomState;
  playerId: string;
  connected: boolean;
  send: (m: ClientMessage) => boolean;
  /** Timer tab is shown; stays true behind dialogs so the backdrop blurs it. */
  visible: boolean;
  /** Visible and not covered by a dialog, so keyboard input should drive the timer. */
  active: boolean;
}) {
  const round = currentRound(room)!;
  const solve = round.solves.find((s) => s.playerId === playerId);
  const timer = useTimer(room.code, round.number, solve, connected, send);
  const stats = statistics(room.history, playerId);
  const scrambleRef = useRef<HTMLParagraphElement>(null);
  const netRef = useRef<HTMLElement>(null);
  const padRef = useRef<HTMLElement>(null);
  const exiting = useFullscreen(padRef, timer.mode, solve?.status === 'done');
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
  const finished = solve?.status === 'done' && !exiting;
  const display = finished ? solveTime(solve) : time(timer.ms);
  return (
    <div
      className="timer-page"
      hidden={!visible}
      data-accent={room.players.find((p) => p.id === playerId)?.color}
    >
      <section className={`card scramble ${finished ? 'solved' : ''}`}>
        <p ref={scrambleRef}>{round.scramble}</p>
      </section>
      <div className="preview-row">
        <section className="card net-card" ref={netRef}>
          <CubeNet event={room.event} scramble={round.scramble} />
        </section>
        <div className="mini-stats">
          <div className="mini-stat accent">
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
        <section className="timer-pad solved" aria-label="Your time" ref={padRef}>
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
          ref={(el) => {
            padRef.current = el;
          }}
          className={`timer-pad ${timer.mode} ${exiting ? 'exiting' : ''}`}
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
          {/* Shown only with a keyboard-and-mouse layout; see style.css. */}
          {timer.mode !== 'running' && <kbd className="key-hint">Space</kbd>}
        </button>
      )}
    </div>
  );
}
