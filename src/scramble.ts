import type { Event } from '../shared/protocol';
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
function reset(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const job of pending.values()) {
    clearTimeout(job.timeout);
    job.reject(error);
  }
  pending.clear();
}
export function generateScramble(event: Event): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL('./scramble.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      message: MessageEvent<{ id: number; scramble?: string; error?: string }>,
    ) => {
      const job = pending.get(message.data.id);
      if (!job) return;
      clearTimeout(job.timeout);
      pending.delete(message.data.id);
      if (message.data.error) {
        job.reject(new Error(message.data.error));
        reset(new Error('Scramble worker reset.'));
      } else job.resolve(message.data.scramble!);
    };
    worker.onerror = () => reset(new Error('Could not load the scramble worker.'));
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reset(new Error('Scramble generation timed out. Please try again.')),
      45_000,
    );
    pending.set(id, { resolve, reject, timeout });
    worker!.postMessage({ id, event });
  });
}
