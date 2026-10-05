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
export function applyMessage(room: RoomState, player: Player, msg: ClientMessage) {
  const round = currentRound(room);
  const solve = round?.solves.find((s) => s.playerId === player.id);
  if ('round' in msg && msg.round !== (round?.number ?? 0))
    throw new Error('The round has changed. Please try again.');
  switch (msg.type) {
    case 'settings':
      if (room.hostId !== player.id || room.phase !== 'lobby')
        throw new Error('Only the host can change settings before the match.');
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
      if (solve.status !== 'ready') break; // Idempotent replay after reconnect.
      solve.status = 'solving';
      break;
    case 'finish':
      if (room.phase !== 'playing' || !solve || solve.status === 'ready')
        throw new Error('Start the timer first.');
      // A reconnect may replay the same finish. Never overwrite an accepted result.
      if (solve.status === 'done') break;
      solve.status = 'done';
      solve.ms = msg.ms;
      break;
    case 'penalty':
      if (room.phase !== 'playing' || !solve || solve.status !== 'done')
        throw new Error('Only completed solves in the current round can be edited.');
      solve.penalty = msg.penalty;
      break;
    case 'profile':
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
}
