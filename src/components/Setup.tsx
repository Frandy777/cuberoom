import { ArrowLeft, ArrowRight, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Event, Settings } from '../../shared/protocol';
import { PuzzleIcon } from './CubeNet';
import { Thumb } from './Thumb';
export function Setup({
  initial,
  onBack,
  onSubmit,
  busy,
  editing = false,
}: {
  initial: Settings;
  onBack: () => void;
  onSubmit: (s: Settings) => void;
  busy: boolean;
  editing?: boolean;
}) {
  const [event, setEvent] = useState(initial.event);
  const [rounds, setRounds] = useState(initial.rounds ?? 12);
  const [endless, setEndless] = useState(initial.rounds === null);
  return (
    <>
      <header className="header">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </button>
        <h2>{editing ? 'Room settings' : 'New room'}</h2>
        <span className="header-spacer" />
      </header>
      <div className="puzzle-picker card">
        {(['222', '333', '444'] as Event[]).map((e) => (
          <button
            key={e}
            onClick={() => setEvent(e)}
            aria-pressed={event === e}
            className={event === e ? 'selected' : ''}
          >
            <PuzzleIcon n={Number(e[0])} />
            <b>
              {e[0]}×{e[0]}
            </b>
          </button>
        ))}
      </div>
      <section className="round-picker">
        <div className="segmented">
          <Thumb index={endless ? 1 : 0} count={2} pad={4} gap={4} />
          <button aria-pressed={!endless} onClick={() => setEndless(false)}>
            Fixed
          </button>
          <button aria-pressed={endless} onClick={() => setEndless(true)}>
            Endless
          </button>
        </div>
        {endless ? (
          <div className="endless">
            <span>∞</span>
            <b>Until the host ends it</b>
          </div>
        ) : (
          <>
            <div className="round-count">
              <button
                className="icon-button"
                aria-label="Fewer rounds"
                disabled={rounds === 1}
                onClick={() => setRounds((r) => r - 1)}
              >
                <Minus />
              </button>
              <div>
                <strong>{rounds}</strong>
                <b>rounds</b>
              </div>
              <button
                className="icon-button"
                aria-label="More rounds"
                disabled={rounds === 99}
                onClick={() => setRounds((r) => r + 1)}
              >
                <Plus />
              </button>
            </div>
            <div className="presets">
              {[5, 12, 25, 50].map((n) => (
                <button key={n} aria-pressed={n === rounds} onClick={() => setRounds(n)}>
                  {n}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <button
        className="primary"
        disabled={busy}
        onClick={() => onSubmit({ event, rounds: endless ? null : rounds })}
      >
        {busy ? 'Creating…' : editing ? 'Save settings' : 'Create room'}
        <ArrowRight size={20} />
      </button>
    </>
  );
}
