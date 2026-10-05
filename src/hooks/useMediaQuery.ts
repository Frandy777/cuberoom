import { useSyncExternalStore } from 'react';

// Wide enough to keep the timer up beside the round and stats; mirrors the split layout in
// style.css. The height guard keeps phones in landscape on the tabbed mobile layout.
export const SPLIT = '(min-width: 1000px) and (min-height: 600px)';

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
  );
}
