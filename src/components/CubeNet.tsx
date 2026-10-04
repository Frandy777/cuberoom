import { useMemo } from 'react';
import type { Event } from '../../shared/protocol';
import { cubeNet, faces } from '../cube';
const layout = { U: [2, 1], L: [1, 2], F: [2, 2], R: [3, 2], B: [4, 2], D: [2, 3] };
export function CubeNet({ event, scramble }: { event: Event; scramble: string }) {
  const net = useMemo(() => cubeNet(event, scramble), [event, scramble]);
  return (
    <div className="cube-net" role="img" aria-label="Scrambled cube net, white top, green front">
      {faces.map((face) => (
        <div
          key={face}
          title={face}
          className="cube-face"
          style={{
            gridColumn: layout[face][0],
            gridRow: layout[face][1],
            gridTemplateColumns: `repeat(${event[0]},1fr)`,
            gridTemplateRows: `repeat(${event[0]},1fr)`,
          }}
        >
          {net[face].map((color, i) => (
            <span key={i} style={{ background: color }} />
          ))}
        </div>
      ))}
    </div>
  );
}
export function PuzzleIcon({ n = 3 }: { n?: number }) {
  return (
    <div className="puzzle-icon" style={{ gridTemplateColumns: `repeat(${n},1fr)` }}>
      {Array.from({ length: n * n }, (_, i) => (
        <i
          key={i}
          style={{
            background: ['#1E5BFF', '#FFFFFF', '#E5322D', '#FFD500', '#19A04B', '#FF8A00'][i % 6],
          }}
        />
      ))}
    </div>
  );
}
