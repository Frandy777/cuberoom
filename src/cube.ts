import type { Event } from '../shared/protocol';
type Vec = [number, number, number];
export const faces = ['U', 'L', 'F', 'R', 'B', 'D'] as const;
export type Face = (typeof faces)[number];
export const faceColors: Record<Face, string> = {
  U: '#FFFFFF',
  D: '#FFD500',
  F: '#19A04B',
  B: '#1E5BFF',
  R: '#E5322D',
  L: '#FF8A00',
};
const normals: Record<Face, Vec> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};
function position(face: Face, r: number, c: number, n: number): Vec {
  switch (face) {
    case 'U':
      return [c, n - 1, r];
    case 'D':
      return [c, 0, n - 1 - r];
    case 'F':
      return [c, n - 1 - r, n - 1];
    case 'B':
      return [n - 1 - c, n - 1 - r, 0];
    case 'R':
      return [n - 1, n - 1 - r, n - 1 - c];
    case 'L':
      return [0, n - 1 - r, c];
  }
}
// Rotate a sticker and its outward normal, then project onto the six 2D faces.
export function cubeNet(event: Event, scramble: string): Record<Face, string[]> {
  const n = Number(event[0]);
  const stickers = faces.flatMap((face) =>
    Array.from({ length: n * n }, (_, i) => ({
      p: position(face, Math.floor(i / n), i % n, n),
      normal: [...normals[face]] as Vec,
      color: faceColors[face],
    })),
  );
  for (const move of scramble.trim().split(/\s+/).filter(Boolean)) {
    const parsed = /^([URFDLB])(w)?(2|')?$/.exec(move);
    if (!parsed) throw new Error('Unsupported scramble move.');
    const face = parsed[1] as Face,
      axis = normals[face].findIndex((v) => v !== 0),
      sign = normals[face][axis];
    const width = parsed[2] ? 2 : 1;
    const count = ((sign === 1 ? 3 : 1) * (parsed[3] === '2' ? 2 : parsed[3] === "'" ? 3 : 1)) % 4;
    for (const s of stickers) {
      if (!(sign === 1 ? s.p[axis] >= n - width : s.p[axis] < width)) continue;
      for (let k = 0; k < count; k++) {
        const a = (axis + 1) % 3,
          b = (axis + 2) % 3;
        [s.p[a], s.p[b]] = [n - 1 - s.p[b], s.p[a]];
        [s.normal[a], s.normal[b]] = [-s.normal[b], s.normal[a]];
      }
    }
  }
  return Object.fromEntries(
    faces.map((face) => [
      face,
      Array.from({ length: n * n }, (_, i) => {
        const p = position(face, Math.floor(i / n), i % n, n),
          normal = normals[face];
        return stickers.find(
          (s) => s.p.every((v, j) => v === p[j]) && s.normal.every((v, j) => v === normal[j]),
        )!.color;
      }),
    ]),
  ) as Record<Face, string[]>;
}
