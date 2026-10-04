import type { Round, Solve } from './protocol';
export function value(s: Solve) {
  return s.status !== 'done' || s.penalty === 'DNF' || s.ms === null
    ? Infinity
    : s.ms + (s.penalty === '+2' ? 2000 : 0);
}
export function time(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (!Number.isFinite(ms)) return 'DNF';
  const cs = Math.floor(ms / 10);
  const secs = Math.floor(cs / 100);
  return (
    (secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : String(secs)) +
    '.' +
    String(cs % 100).padStart(2, '0')
  );
}
export function solveTime(s?: Solve) {
  return !s || s.status !== 'done' ? '—' : time(value(s)) + (s.penalty === '+2' ? '+' : '');
}
export function average(solves: Solve[], n: number) {
  if (solves.length < n) return null;
  const a = solves
    .slice(-n)
    .map(value)
    .sort((a, b) => a - b)
    .slice(1, -1);
  return a.reduce((a, b) => a + b, 0) / a.length;
}
export function winners(round: Round) {
  if (!round.solves.every((s) => s.status === 'done')) return [];
  const best = Math.min(...round.solves.map(value));
  return Number.isFinite(best)
    ? round.solves.filter((s) => value(s) === best).map((s) => s.playerId)
    : [];
}
export function statistics(rounds: Round[], playerId: string) {
  const solves = rounds.flatMap((r) =>
    r.solves.filter((s) => s.playerId === playerId && s.status === 'done'),
  );
  const good = solves.map(value).filter(Number.isFinite);
  return {
    count: solves.length,
    best: good.length ? Math.min(...good) : null,
    mean: good.length ? good.reduce((a, b) => a + b, 0) / good.length : null,
    ao5: average(solves, 5),
    ao12: average(solves, 12),
    dnf: solves.filter((s) => s.penalty === 'DNF').length,
    wins: rounds.filter((r) => winners(r).includes(playerId)).length,
  };
}
