import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RoomState, ServerMessage, Session } from '../shared/protocol';
const base = process.env.CUBEROOM_URL;
const clients: Client[] = [];
class Client {
  ws: WebSocket;
  room?: RoomState;
  session?: Session;
  messages: ServerMessage[] = [];
  closeCode?: number;
  tick: ReturnType<typeof setInterval>;
  listeners = new Set<() => void>();
  constructor(code: string, name: string, token?: string) {
    this.ws = new WebSocket(`${base!.replace('http', 'ws')}/api/rooms/${code}/ws`, {
      headers: { Origin: base! },
    });
    this.ws.on('open', () => this.send({ type: 'join', name, color: 1, token }));
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(msg);
      if (msg.type === 'state') this.room = msg.room;
      if (msg.type === 'welcome') this.session = msg.session;
      for (const fn of this.listeners) fn();
    });
    this.ws.on('close', (code) => {
      this.closeCode = code;
      clearInterval(this.tick);
      for (const fn of this.listeners) fn();
    });
    this.ws.on('error', () => {});
    this.tick = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.send({ type: 'ping' });
    }, 10_000);
    clients.push(this);
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async until(predicate: () => boolean, timeout = 5000) {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (predicate()) {
          clearTimeout(t);
          this.listeners.delete(check);
          resolve();
        }
      };
      const t = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error('Timed out waiting for room condition'));
      }, timeout);
      this.listeners.add(check);
    });
  }
  async ready() {
    await this.until(() => !!this.session && !!this.room);
    return this;
  }
  async errorFor(m: unknown) {
    const n = this.messages.length;
    this.send(m);
    await this.until(() => this.messages.slice(n).some((m) => m.type === 'error'));
    return this.messages.slice(n).find((m) => m.type === 'error');
  }
  close() {
    clearInterval(this.tick);
    this.ws.close();
  }
}
async function create(rounds: number | null = 2) {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { Origin: base!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Host', color: 1, event: '333', rounds }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Session;
}
afterEach(() => {
  for (const c of clients) c.close();
  clients.length = 0;
});
describe.skipIf(!base)('real Workers + Durable Object protocol', () => {
  it('enforces origin, validation, and bounded request bodies', async () => {
    const noOrigin = await fetch(`${base}/api/rooms`, { method: 'POST', body: '{}' });
    expect(noOrigin.status).toBe(403);
    const bad = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { Origin: base! },
      body: JSON.stringify({ name: '', color: 1, event: '333', rounds: 2 }),
    });
    expect(bad.status).toBe(400);
    const large = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { Origin: base! },
      body: 'x'.repeat(5000),
    });
    expect(large.status).toBe(413);
  });
  it('runs a four-player match, reconnects without duplicates, isolates rooms, and clears on last leave', async () => {
    const session = await create();
    const host = await new Client(session.code, 'Host', session.token).ready();
    const b = await new Client(session.code, 'B').ready(),
      c = await new Client(session.code, 'C').ready(),
      d = await new Client(session.code, 'D').ready();
    await host.until(() => host.room?.players.length === 4);
    const fifth = new Client(session.code, 'Fifth');
    await fifth.until(() => fifth.messages.some((m) => m.type === 'error'));
    expect(fifth.messages).toContainEqual(
      expect.objectContaining({
        type: 'error',
        fatal: true,
        message: expect.stringContaining('full'),
      }),
    );
    const invalid = new Client(session.code, 'Imposter', crypto.randomUUID());
    await invalid.until(() => invalid.messages.some((m) => m.type === 'error'));
    expect(invalid.session).toBeUndefined();
    expect(await b.errorFor({ type: 'next', round: 0, scramble: 'R U F2' })).toMatchObject({
      message: expect.stringContaining('host'),
    });
    host.send({ type: 'next', round: 0, scramble: 'R U F2' });
    for (const player of [host, b, c, d]) {
      await player.until(() => player.room?.history.length === 1);
      expect(player.room!.history[0].scramble).toBe('R U F2');
    }
    expect(JSON.stringify(b.room)).not.toContain(session.token);
    const separate = await create();
    const other = await new Client(separate.code, 'Other', separate.token).ready();
    expect(other.room!.history).toHaveLength(0);
    other.send({ type: 'leave' });
    await other.until(() => other.messages.some((m) => m.type === 'ended'));
    expect(await b.errorFor({ type: 'end' })).toMatchObject({
      message: expect.stringContaining('host'),
    });
    host.send({ type: 'start', round: 1 });
    host.send({ type: 'finish', round: 1, ms: 10000 });
    expect(await host.errorFor({ type: 'next', round: 1, scramble: 'U R' })).toMatchObject({
      message: expect.stringContaining('all players'),
    });
    b.send({ type: 'start', round: 1 });
    b.send({ type: 'finish', round: 1, ms: 11000 });
    b.send({ type: 'penalty', round: 1, penalty: '+2' });
    c.send({ type: 'start', round: 1 });
    await c.until(() => c.room?.history[0].solves[2].status === 'solving');
    const cs = c.session!;
    c.close();
    await host.until(() => host.room?.players[2].connected === false);
    const recovered = await new Client(session.code, 'C', cs.token).ready();
    expect(recovered.session!.playerId).toBe(cs.playerId);
    expect(recovered.room!.players).toHaveLength(4);
    recovered.send({ type: 'start', round: 1 });
    recovered.send({ type: 'finish', round: 1, ms: 12000 });
    recovered.send({ type: 'finish', round: 1, ms: 1 });
    d.send({ type: 'start', round: 1 });
    d.send({ type: 'finish', round: 1, ms: 13000 });
    d.send({ type: 'penalty', round: 1, penalty: 'DNF' });
    await host.until(
      () =>
        host.room?.history[0].solves.every((s) => s.status === 'done') === true &&
        host.room?.history[0].solves[3].penalty === 'DNF',
    );
    expect(host.room!.history[0].solves[2].ms).toBe(12000);
    expect(host.room!.history[0].solves[1].penalty).toBe('+2');
    host.send({ type: 'next', round: 1, scramble: "U2 R' F" });
    await b.until(() => b.room?.history.length === 2);
    expect(await b.errorFor({ type: 'penalty', round: 1, penalty: 'DNF' })).toMatchObject({
      message: expect.stringContaining('round'),
    });
    host.send({ type: 'leave' });
    await b.until(() => b.room?.hostId === b.session!.playerId);
    expect(b.room!.history[1].solves[0].penalty).toBe('DNF');
    b.send({ type: 'leave' });
    recovered.send({ type: 'leave' });
    d.send({ type: 'leave' });
    await d.until(() => d.messages.some((m) => m.type === 'ended'));
    const deleted = await fetch(`${base}/api/rooms/${session.code}`);
    expect(deleted.status).toBe(404);
  });
  it('closes oversized and flooding connections', async () => {
    const session = await create();
    const host = await new Client(session.code, 'Host', session.token).ready();
    const oversized = await new Client(session.code, 'Large').ready();
    oversized.ws.send('x'.repeat(5000));
    await oversized.until(() => !!oversized.closeCode);
    expect(oversized.closeCode).toBe(1009);
    const spam = await new Client(session.code, 'Spam').ready();
    for (let i = 0; i < 45; i++) spam.send({ type: 'ping' });
    await spam.until(() => !!spam.closeCode);
    expect(spam.closeCode).toBe(1008);
    host.send({ type: 'end' });
    await host.until(() => host.messages.some((m) => m.type === 'ended'));
  });
  it('expires a disconnected host, transfers ownership, and keeps round data until dissolution', async () => {
    const session = await create();
    const host = await new Client(session.code, 'Host', session.token).ready();
    const guest = await new Client(session.code, 'Guest').ready();
    host.send({ type: 'next', round: 0, scramble: 'R U' });
    await guest.until(() => guest.room?.history.length === 1);
    host.close();
    await guest.until(() => guest.room?.players[0].connected === false);
    expect(guest.room!.hostId).toBe(session.playerId);
    await guest.until(() => guest.room?.players.length === 1, 85_000);
    expect(guest.room!.hostId).toBe(guest.session!.playerId);
    expect(guest.room!.history[0].solves[0].penalty).toBe('DNF');
    guest.send({ type: 'end' });
    await guest.until(() => guest.messages.some((m) => m.type === 'ended'));
  }, 95_000);
});
