import {
  currentRound,
  roundDone,
  validScramble,
  type ClientMessage,
  type RoomState,
  type Player,
} from '../shared/protocol';
// Hosts often background the app to share the invite, so the lobby waits longer.
export const LOBBY_GRACE = 5 * 60_000;
// During a match the others are blocked on a disconnected player.
export const MATCH_GRACE = 2 * 60_000;
export const IDLE_TTL = 5 * 60_000;
// Removal only unblocks players who are still online; with nobody online the room just waits.
export function expiredPlayers(room: RoomState, now: number) {
  if (!room.players.some((p) => p.connected)) return [];
  const grace = room.phase === 'playing' ? MATCH_GRACE : LOBBY_GRACE;
  return room.players
    .filter((p) => p.disconnectedAt !== null && now - p.disconnectedAt >= grace)
    .map((p) => p.id);
}
export const roomIdle = (room: RoomState, now: number) =>
  room.players.every((p) => p.disconnectedAt !== null && now - p.disconnectedAt >= IDLE_TTL);
// A socket is judged by its silence, not by its state: a client that vanished without
// a close frame holds a slot and keeps its player marked connected until this passes.
export const JOINED_TIMEOUT = 45_000;
export const UNJOINED_TIMEOUT = 10_000;
// Silence is the one deadline a live client keeps pushing forward, so it is checked at
// most once a minute: every alarm firing is billed and wakes an evicted object, while
// the sweep it delays only precedes timeouts that are minutes long anyway.
export const MIN_SWEEP_DELAY = 60_000;
// The alarm exists only to enforce the deadlines above, so it is aimed at the earliest
// one that can still do something and `null` means the room has nothing left to wake up
// for: the chain ends there instead of renewing itself. It cannot run away either. The
// socket deadlines are spaced a minute apart, and each of the others ends itself when it
// fires, by removing a player or by destroying the room, so at most one per player can
// still be waiting.
export function nextDeadline(
  room: RoomState | null,
  sockets: Iterable<{ joined: boolean; lastSeen: number }>,
  now: number,
): number | null {
  if (!room) return null;
  // An empty room is dissolved on sight; it only reaches here if a wake-up was missed.
  if (!room.players.length) return now;
  const due: number[] = [];
  for (const c of sockets)
    due.push(
      Math.max(c.lastSeen + (c.joined ? JOINED_TIMEOUT : UNJOINED_TIMEOUT), now + MIN_SWEEP_DELAY),
    );
  const away = room.players.flatMap((p) => (p.disconnectedAt === null ? [] : [p.disconnectedAt]));
  // With nobody online nobody is blocked, so only dissolution is pending and the last
  // player to drop sets its clock. Otherwise the first to drop sets the grace clock.
  if (away.length === room.players.length) due.push(Math.max(...away) + IDLE_TTL);
  else if (away.length)
    due.push(Math.min(...away) + (room.phase === 'playing' ? MATCH_GRACE : LOBBY_GRACE));
  // No socket and nobody away: unreachable while a room is live, since the constructor
  // marks every restored player away and a connected player always holds a socket.
  return due.length ? Math.min(...due) : null;
}
export function removePlayer(room: RoomState, id: string) {
  room.players = room.players.filter((p) => p.id !== id);
  const solve = currentRound(room)?.solves.find((s) => s.playerId === id);
  if (solve && solve.status !== 'done') {
    solve.status = 'done';
    solve.penalty = 'DNF';
    solve.ms = 0;
  }
  if (room.hostId === id) room.hostId = room.players[0]?.id ?? '';
}
export function applyMessage(room: RoomState, player: Player, msg: ClientMessage): boolean {
  const round = currentRound(room);
  const solve = round?.solves.find((s) => s.playerId === player.id);
  if ('round' in msg && msg.round !== (round?.number ?? 0))
    throw new Error('The round has changed. Please try again.');
  switch (msg.type) {
    case 'settings':
      if (room.hostId !== player.id || room.phase !== 'lobby')
        throw new Error('Only the host can change settings before the match.');
      if (room.event === msg.event && room.rounds === msg.rounds) return false;
      room.event = msg.event;
      room.rounds = msg.rounds;
      break;
    case 'next':
      if (room.hostId !== player.id) throw new Error('Only the host can start the next round.');
      if (room.phase === 'finished') throw new Error('This session has ended.');
      if (round && !roundDone(round)) throw new Error('Wait for all players to finish.');
      if (room.players.some((p) => !p.connected))
        throw new Error('Wait for disconnected players to reconnect or time out.');
      if (room.rounds && room.history.length >= room.rounds) {
        room.phase = 'finished';
        break;
      }
      if (room.history.length >= 1000)
        throw new Error('The 1,000-round limit has been reached. Create a new room.');
      if (!validScramble(msg.scramble, room.event))
        throw new Error('Invalid scramble. Please generate another.');
      room.history.push({
        number: room.history.length + 1,
        scramble: msg.scramble,
        solves: room.players.map((p) => ({
          playerId: p.id,
          name: p.name,
          color: p.color,
          status: 'ready',
          ms: null,
          penalty: 'none',
        })),
      });
      room.phase = 'playing';
      break;
    case 'restart':
      if (room.hostId !== player.id) throw new Error('Only the host can start a new session.');
      if (room.phase !== 'finished') throw new Error('Finish the current session first.');
      // Same code and players; the previous session's results are discarded.
      room.history = [];
      room.phase = 'lobby';
      break;
    case 'start':
      if (room.phase !== 'playing' || !solve) throw new Error('Cannot start this solve.');
      if (solve.status !== 'ready') return false; // Idempotent replay after reconnect.
      solve.status = 'solving';
      break;
    case 'finish':
      if (room.phase !== 'playing' || !solve || solve.status === 'ready')
        throw new Error('Start the timer first.');
      // A reconnect may replay the same finish. Never overwrite an accepted result.
      if (solve.status === 'done') return false;
      solve.status = 'done';
      solve.ms = msg.ms;
      break;
    case 'penalty':
      if (room.phase !== 'playing' || !solve || solve.status !== 'done')
        throw new Error('Only completed solves in the current round can be edited.');
      if (solve.penalty === msg.penalty) return false;
      solve.penalty = msg.penalty;
      break;
    case 'profile':
      if (
        player.name === msg.name &&
        player.color === msg.color &&
        (!solve || (solve.name === msg.name && solve.color === msg.color))
      )
        return false;
      player.name = msg.name;
      player.color = msg.color;
      if (solve) {
        solve.name = msg.name;
        solve.color = msg.color;
      }
      break;
    default:
      throw new Error('Unsupported action.');
  }
  return true;
}
