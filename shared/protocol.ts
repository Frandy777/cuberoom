import { z } from 'zod';
export const eventSchema = z.enum(['222', '333', '444']);
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/^[^\p{C}]+$/u, 'Names cannot contain control characters.');
export const profileSchema = z.object({ name: nameSchema, color: z.number().int().min(1).max(4) });
export const settingsSchema = z.object({
  event: eventSchema,
  rounds: z.number().int().min(1).max(99).nullable(),
});
export const createSchema = profileSchema.extend(settingsSchema.shape);
export const codeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);
export const penaltySchema = z.enum(['none', '+2', 'DNF']);
export const messageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    ...profileSchema.shape,
    token: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('next'),
    scramble: z.string().min(1).max(1500),
    round: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('start'), round: z.number().int().positive() }),
  z.object({
    type: z.literal('finish'),
    round: z.number().int().positive(),
    ms: z.number().int().min(0).max(86_400_000),
  }),
  z.object({
    type: z.literal('penalty'),
    round: z.number().int().positive(),
    penalty: penaltySchema,
  }),
  z.object({ type: z.literal('profile'), ...profileSchema.shape }),
  z.object({ type: z.literal('settings'), ...settingsSchema.shape }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('restart') }),
  z.object({ type: z.literal('ping') }),
]);
export type Event = z.infer<typeof eventSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ClientMessage = z.infer<typeof messageSchema>;
export type Penalty = z.infer<typeof penaltySchema>;
export interface Player extends Profile {
  id: string;
  connected: boolean;
  disconnectedAt: number | null;
}
export interface Solve {
  playerId: string;
  name: string;
  color: number;
  status: 'ready' | 'solving' | 'done';
  ms: number | null;
  penalty: Penalty;
}
export interface Round {
  number: number;
  scramble: string;
  solves: Solve[];
}
export interface RoomState extends Settings {
  code: string;
  hostId: string;
  players: Player[];
  history: Round[];
  phase: 'lobby' | 'playing' | 'finished';
  createdAt: number;
}
export interface Session {
  code: string;
  token: string;
  playerId: string;
}
export type ServerMessage =
  | { type: 'state'; room: RoomState }
  | { type: 'welcome'; session: Session }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'ended'; reason: string }
  | { type: 'pong' };
export const currentRound = (room: RoomState) => room.history.at(-1);
export const roundDone = (round?: Round) =>
  !!round && round.solves.every((s) => s.status === 'done');
export function validScramble(scramble: string, event: Event) {
  const moves = scramble.trim().split(/\s+/);
  return (
    moves.length >= 1 &&
    moves.length <= 100 &&
    moves.every((m) => (event === '444' ? /^[URFDLB]w?(2|')?$/ : /^[URFDLB](2|')?$/).test(m))
  );
}
