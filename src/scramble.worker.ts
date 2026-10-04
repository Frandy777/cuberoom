import { randomScrambleForEvent } from 'cubing/scramble';
import { setSearchDebug } from 'cubing/search';
import type { Event } from '../shared/protocol';

// An explicit Vite worker entry keeps cubing's dynamic worker imports out of
// the browser UI chunks (which may contain document-based preload helpers).
setSearchDebug({ logPerf: false, prioritizeEsbuildWorkaroundForWorkerInstantiation: true });
self.onmessage = async (message: MessageEvent<{ id: number; event: Event }>) => {
  const { id, event } = message.data;
  try {
    const scramble = (await randomScrambleForEvent(event)).toString();
    self.postMessage({ id, scramble });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Scramble generation failed.',
    });
  }
};
