import { describe, expect, it } from 'vitest';
import { applyMessage, removePlayer } from '../worker/room-state';
import {
  currentRound,
  messageSchema,
  roundDone,
  validScramble,
  type RoomState,
} from '../shared/protocol';
import { average, statistics, time, value, winners } from '../shared/stats';
import { cubeNet, faceColors, faces } from '../src/cube';
function room(): RoomState {
  return {
    code: 'ABC234',
    event: '333',
    rounds: 5,
    hostId: 'a',
    phase: 'lobby',
    createdAt: 0,
    history: [],
    players: [
      { id: 'a', name: 'A', color: 1, connected: true, disconnectedAt: null },
      { id: 'b', name: 'B', color: 2, connected: true, disconnectedAt: null },
    ],
  };
}
function next(r: RoomState) {
  applyMessage(r, r.players[0], { type: 'next', round: r.history.length, scramble: 'R U F2' });
}
describe('room state and authority', () => {
  it('only the host advances and everyone shares one scramble', () => {
    const r = room();
    expect(() =>
      applyMessage(r, r.players[1], { type: 'next', round: 0, scramble: 'R U' }),
    ).toThrow('host');
    next(r);
    expect(currentRound(r)?.scramble).toBe('R U F2');
    expect(currentRound(r)?.solves).toHaveLength(2);
  });
  it('allows independent starts, waits for all finishes, and freezes past penalties', () => {
    const r = room();
    next(r);
    const [a, b] = r.players;
    applyMessage(r, a, { type: 'start', round: 1 });
    applyMessage(r, a, { type: 'finish', round: 1, ms: 12345 });
    expect(currentRound(r)?.solves[1].status).toBe('ready');
    expect(() => next(r)).toThrow('all players');
    applyMessage(r, a, { type: 'penalty', round: 1, penalty: '+2' });
    expect(value(currentRound(r)!.solves[0])).toBe(14345);
    applyMessage(r, b, { type: 'start', round: 1 });
    applyMessage(r, b, { type: 'finish', round: 1, ms: 13000 });
    next(r);
    expect(() => applyMessage(r, a, { type: 'penalty', round: 1, penalty: 'DNF' })).toThrow(
      'round',
    );
  });
  it('rejects finishes without starts, stale rounds, and edits of others', () => {
    const r = room();
    next(r);
    expect(() => applyMessage(r, r.players[0], { type: 'finish', round: 1, ms: 1 })).toThrow(
      'Start the timer',
    );
    expect(() => applyMessage(r, r.players[0], { type: 'start', round: 2 })).toThrow('round');
    expect(() =>
      applyMessage(r, r.players[1], { type: 'settings', event: '222', rounds: null }),
    ).toThrow();
  });
  it('records unfinished departures as DNF and transfers the host in join order', () => {
    const r = room();
    next(r);
    removePlayer(r, 'a');
    expect(r.hostId).toBe('b');
    expect(currentRound(r)?.solves[0].penalty).toBe('DNF');
    removePlayer(r, 'b');
    expect(r.hostId).toBe('');
    expect(roundDone(currentRound(r))).toBe(true);
  });
  it('keeps accepted results immutable during finish replay', () => {
    const r = room();
    next(r);
    applyMessage(r, r.players[0], { type: 'start', round: 1 });
    applyMessage(r, r.players[0], { type: 'finish', round: 1, ms: 12345 });
    applyMessage(r, r.players[0], { type: 'finish', round: 1, ms: 2 });
    expect(currentRound(r)?.solves[0].ms).toBe(12345);
  });
  it('late joiners participate starting with the next round', () => {
    const r = room();
    next(r);
    r.players.push({ id: 'c', name: 'C', color: 3, connected: true, disconnectedAt: null });
    expect(currentRound(r)?.solves).toHaveLength(2);
    expect(() => applyMessage(r, r.players[2], { type: 'start', round: 1 })).toThrow();
    for (const p of r.players.slice(0, 2)) {
      applyMessage(r, p, { type: 'start', round: 1 });
      applyMessage(r, p, { type: 'finish', round: 1, ms: 1000 });
    }
    next(r);
    expect(currentRound(r)?.solves).toHaveLength(3);
  });
  it('finishes a fixed session only after its final round completes', () => {
    const r = room();
    r.rounds = 1;
    next(r);
    for (const p of r.players) {
      applyMessage(r, p, { type: 'start', round: 1 });
      applyMessage(r, p, { type: 'finish', round: 1, ms: 1000 });
    }
    next(r);
    expect(r.phase).toBe('finished');
    expect(r.history).toHaveLength(1);
    expect(() => next(r)).toThrow('ended');
  });
  it('does not advance while a player is disconnected', () => {
    const r = room();
    r.players[1].connected = false;
    expect(() => next(r)).toThrow('reconnect');
  });
});
describe('validation and statistics', () => {
  it('rejects oversized names, invalid times, unexpected event notation', () => {
    expect(messageSchema.safeParse({ type: 'join', name: 'a'.repeat(17), color: 1 }).success).toBe(
      false,
    );
    expect(messageSchema.safeParse({ type: 'finish', round: 1, ms: -1 }).success).toBe(false);
    expect(validScramble('Rw U F2', '333')).toBe(false);
    expect(validScramble("Rw U F2 Rw'", '444')).toBe(true);
    expect(validScramble('<script>', '444')).toBe(false);
  });
  it('uses WCA trimmed averages with one or two DNFs', () => {
    const solves = Array.from({ length: 5 }, (_, i) => ({
      playerId: 'a',
      name: 'a',
      color: 1,
      status: 'done' as const,
      ms: (i + 1) * 1000,
      penalty: 'none' as const,
    }));
    expect(average(solves, 5)).toBe(3000);
    expect(average(solves, 12)).toBeNull();
    const one = solves.map((s, i) => ({ ...s, penalty: i === 0 ? ('DNF' as const) : s.penalty }));
    expect(average(one, 5)).toBe(4000);
    one[1].penalty = 'DNF';
    expect(average(one, 5)).toBe(Infinity);
  });
  it('does not award DNF wins and counts tied finite winners', () => {
    const r = room();
    next(r);
    for (const p of r.players) {
      applyMessage(r, p, { type: 'start', round: 1 });
      applyMessage(r, p, { type: 'finish', round: 1, ms: 1000 });
    }
    expect(winners(currentRound(r)!)).toEqual(['a', 'b']);
    for (const p of r.players) applyMessage(r, p, { type: 'penalty', round: 1, penalty: 'DNF' });
    expect(winners(currentRound(r)!)).toEqual([]);
    expect(statistics(r.history, 'a').best).toBeNull();
    expect(statistics(r.history, 'a').dnf).toBe(1);
  });
  it('formats centiseconds and minutes without rounding up', () => {
    expect(time(59999)).toBe('59.99');
    expect(time(60001)).toBe('1:00.00');
    expect(time(null)).toBe('—');
    expect(time(Infinity)).toBe('DNF');
  });
});
describe('2D cube model', () => {
  for (const event of ['222', '333', '444'] as const) {
    it(`${event}: inverse moves and four turns restore all six faces`, () => {
      const solved = cubeNet(event, '');
      for (const move of [
        'U',
        'D',
        'F',
        'B',
        'L',
        'R',
        ...(event === '444' ? ['Uw', 'Rw', 'Fw', 'Lw', 'Dw', 'Bw'] : []),
      ]) {
        expect(cubeNet(event, `${move} ${move}'`)).toEqual(solved);
        expect(cubeNet(event, Array(4).fill(move).join(' '))).toEqual(solved);
      }
      const seq = "R U2 F' D L2 B R'";
      const inverse = "R B' L2 D' F U2 R'";
      expect(cubeNet(event, seq + ' ' + inverse)).toEqual(solved);
    });
    it(`${event}: preserves sticker counts under mixed turns`, () => {
      const net = cubeNet(event, "R U2 F' D L2 B R'");
      const all = Object.values(net).flat();
      for (const face of faces)
        expect(all.filter((c) => c === faceColors[face])).toHaveLength(Number(event[0]) ** 2);
    });
  }
  it('clockwise R puts the front right column on the upper right column', () => {
    expect(cubeNet('333', 'R').U.filter((_, i) => i % 3 === 2)).toEqual(
      Array(3).fill(faceColors.F),
    );
  });
  it('4x4 wide R rotates exactly two layers', () => {
    const u = cubeNet('444', 'Rw').U;
    expect(u.filter((_, i) => i % 4 < 2)).toEqual(Array(8).fill(faceColors.U));
    expect(u.filter((_, i) => i % 4 >= 2)).toEqual(Array(8).fill(faceColors.F));
  });
});
