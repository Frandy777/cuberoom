import { DurableObject } from 'cloudflare:workers';
import {
  codeSchema,
  createSchema,
  messageSchema,
  type Player,
  type RoomState,
  type ServerMessage,
} from '../shared/protocol';
import { applyMessage, removePlayer } from './room-state';
interface Env {
  ROOMS: DurableObjectNamespace<CubeRoom>;
  ASSETS: Fetcher;
  CREATE_LIMIT: RateLimit;
  CONNECT_LIMIT: RateLimit;
}
const GRACE = 60_000;
const MAX_BYTES = 4096;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))]
    .map((n) => alphabet[n % alphabet.length])
    .join('');
}
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const isProbe = req.method === 'GET' && /^\/api\/rooms\/[A-HJ-NP-Z2-9]{6}$/.test(url.pathname);
    if ((!isProbe || req.headers.has('Origin')) && req.headers.get('Origin') !== url.origin)
      return json({ error: 'Invalid origin.' }, 403);
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (!(await env.CREATE_LIMIT.limit({ key: ip })).success)
        return json({ error: 'Too many rooms. Try again in a minute.' }, 429);
      // Read a bounded stream; Content-Length alone is not a reliable limit.
      const reader = req.body?.getReader();
      let body = '';
      let bytes = 0;
      if (!reader) return json({ error: 'Missing room settings.' }, 400);
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          return json({ error: 'Request too large.' }, 413);
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      let data;
      try {
        data = createSchema.parse(JSON.parse(body));
      } catch {
        return json({ error: 'Check your name and room settings.' }, 400);
      }
      for (let i = 0; i < 5; i++) {
        const roomCode = code();
        const result = await env.ROOMS.get(env.ROOMS.idFromName(roomCode)).fetch(
          new Request('https://room/create', {
            method: 'POST',
            body: JSON.stringify({ ...data, code: roomCode }),
          }),
        );
        if (result.status !== 409) return result;
      }
      return json({ error: 'Could not create a room. Please try again.' }, 503);
    }
    if (isProbe) {
      if (!(await env.CONNECT_LIMIT.limit({ key: ip })).success)
        return json({ error: 'Too many requests.' }, 429);
      return env.ROOMS.get(env.ROOMS.idFromName(url.pathname.split('/').at(-1)!)).fetch(
        new Request('https://room/exists'),
      );
    }
    const match = /^\/api\/rooms\/([^/]+)\/ws$/.exec(url.pathname);
    if (
      match &&
      req.method === 'GET' &&
      req.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    ) {
      if (!codeSchema.safeParse(match[1]).success)
        return json({ error: 'Invalid room code.' }, 400);
      if (!(await env.CONNECT_LIMIT.limit({ key: ip })).success)
        return json({ error: 'Too many connections. Please try again later.' }, 429);
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(req);
    }
    return json({ error: 'Not found.' }, 404);
  },
} satisfies ExportedHandler<Env>;

type Connection = { id?: string; window: number; count: number; lastSeen: number; joined: boolean };
export class CubeRoom extends DurableObject<Env> {
  // Intentionally memory-only: no room, result, or token is written to storage.
  // Standard WebSockets keep the object awake. Deployment/restart ends the room.
  private room: RoomState | null = null;
  private tokens = new Map<string, string>();
  private sockets = new Map<WebSocket, Connection>();
  private async schedule() {
    await this.ctx.storage.setAlarm(Date.now() + 15_000);
  }
  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      this.disconnect(ws);
    }
  }
  private broadcast() {
    if (this.room)
      for (const [ws, c] of this.sockets)
        if (c.joined) this.send(ws, { type: 'state', room: this.room });
  }
  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname === '/create') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);
      const data = (await req.json()) as ReturnType<typeof createSchema.parse> & { code: string };
      const id = crypto.randomUUID(),
        token = crypto.randomUUID();
      this.room = {
        code: data.code,
        event: data.event,
        rounds: data.rounds,
        hostId: id,
        createdAt: Date.now(),
        history: [],
        phase: 'lobby',
        players: [
          { id, name: data.name, color: data.color, connected: false, disconnectedAt: Date.now() },
        ],
      };
      this.tokens.set(token, id);
      await this.schedule();
      return json({ code: data.code, token, playerId: id });
    }
    if (!this.room) return json({ error: 'Room not found or no longer available.' }, 404);
    if (new URL(req.url).pathname === '/exists') return json({ exists: true });
    if (this.sockets.size >= 12)
      return json({ error: 'Too many connections. Please try again later.' }, 429);
    const pair = new WebSocketPair();
    const client = pair[0],
      server = pair[1];
    server.accept();
    this.sockets.set(server, { window: Date.now(), count: 0, lastSeen: Date.now(), joined: false });
    server.addEventListener('message', (event) => this.message(server, event.data));
    server.addEventListener('close', () => this.disconnect(server));
    server.addEventListener('error', () => this.disconnect(server));
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }
  private message(ws: WebSocket, raw: string | ArrayBuffer) {
    const c = this.sockets.get(ws),
      room = this.room;
    if (!c || !room) return;
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
      ws.close(1009, 'Message too large');
      this.disconnect(ws);
      return;
    }
    if (Date.now() - c.window >= 10_000) {
      c.window = Date.now();
      c.count = 0;
    }
    if (++c.count > 40) {
      ws.close(1008, 'Too many messages');
      this.disconnect(ws);
      return;
    }
    try {
      const msg = messageSchema.parse(JSON.parse(raw));
      c.lastSeen = Date.now();
      if (msg.type === 'join') {
        if (c.joined) throw new Error('Already in this room.');
        let player: Player | undefined;
        let token = msg.token;
        if (token) {
          player = room.players.find((p) => p.id === this.tokens.get(token!));
          if (
            !player ||
            (player.disconnectedAt !== null && Date.now() - player.disconnectedAt >= GRACE)
          ) {
            this.send(ws, {
              type: 'error',
              message: 'Session expired. Please rejoin the room.',
              fatal: true,
            });
            ws.close(4001, 'Session expired');
            return;
          }
          for (const [old, state] of this.sockets)
            if (state.id === player.id) {
              this.sockets.delete(old);
              old.close(4002, 'Connected elsewhere');
            }
        } else {
          if (room.players.length >= 4) {
            this.send(ws, {
              type: 'error',
              message: 'Room is full (4 players maximum).',
              fatal: true,
            });
            ws.close(4003, 'Room full');
            return;
          }
          if (room.phase === 'finished') {
            this.send(ws, { type: 'error', message: 'Session ended.', fatal: true });
            ws.close(4004, 'Finished');
            return;
          }
          player = {
            id: crypto.randomUUID(),
            name: msg.name,
            color: msg.color,
            connected: true,
            disconnectedAt: null,
          };
          token = crypto.randomUUID();
          this.tokens.set(token, player.id);
          room.players.push(player);
        }
        player.connected = true;
        player.disconnectedAt = null;
        c.id = player.id;
        c.joined = true;
        this.send(ws, {
          type: 'welcome',
          session: { code: room.code, playerId: player.id, token: token! },
        });
        this.broadcast();
        return;
      }
      if (!c.joined) throw new Error('Join the room first.');
      const player = room.players.find((p) => p.id === c.id);
      if (!player) throw new Error('Player not found.');
      if (msg.type === 'ping') {
        this.send(ws, { type: 'pong' });
        return;
      }
      if (msg.type === 'leave') {
        this.remove(player.id);
        this.sockets.delete(ws);
        this.send(ws, { type: 'ended', reason: '' });
        ws.close(1000, 'Left');
        if (!room.players.length) this.destroy('All players have left.');
        else this.broadcast();
        return;
      }
      if (msg.type === 'end') {
        if (room.hostId !== player.id) throw new Error('Only the host can end the room.');
        this.destroy('The host ended the room. All results cleared.');
        return;
      }
      applyMessage(room, player, msg);
      this.broadcast();
    } catch (error) {
      this.send(ws, {
        type: 'error',
        message:
          error instanceof Error && error.name !== 'ZodError' ? error.message : 'Invalid message.',
      });
    }
  }
  private remove(id: string) {
    if (this.room) removePlayer(this.room, id);
    for (const [token, playerId] of this.tokens) if (playerId === id) this.tokens.delete(token);
  }
  private disconnect(ws: WebSocket) {
    const c = this.sockets.get(ws);
    this.sockets.delete(ws);
    const player = this.room?.players.find((p) => p.id === c?.id);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      this.broadcast();
    }
  }
  private destroy(reason: string) {
    this.room = null;
    this.tokens.clear();
    for (const ws of this.sockets.keys()) {
      this.send(ws, { type: 'ended', reason });
      ws.close(1000, 'Room ended');
    }
    this.sockets.clear();
    this.ctx.waitUntil(this.ctx.storage.deleteAlarm());
  }
  async alarm() {
    if (!this.room) return;
    for (const [ws, c] of this.sockets)
      if (Date.now() - c.lastSeen > (c.joined ? 45_000 : 10_000)) {
        ws.close(4000, 'Heartbeat timeout');
        this.disconnect(ws);
      }
    for (const p of [...this.room.players])
      if (p.disconnectedAt !== null && Date.now() - p.disconnectedAt >= GRACE) this.remove(p.id);
    if (!this.room.players.length) {
      this.destroy('Room ended.');
      return;
    }
    this.broadcast();
    await this.schedule();
  }
}
