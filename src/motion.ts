import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

// Mirrors --ease-out in style.css; WAAPI can't read CSS variables.
export const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Fades and lifts an element in; with reduced motion it only fades.
export function enter(el: Element, delay = 0, duration = 300) {
  el.animate?.(
    reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
    { duration, delay, easing: easeOut, fill: 'backwards' },
  );
}

// Staggers the children of `ref` in whenever `key` changes, and on mount. A WAAPI one-shot
// rather than a CSS animation so `hidden` toggles (e.g. switching tabs) don't replay it.
export function useEntrance(ref: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    [...(ref.current?.children ?? [])].forEach((el, i) => enter(el, Math.min(i, 6) * 40));
  }, [key]);
}

// A brief scale bump when `value` increases.
export function usePop(ref: RefObject<HTMLElement | null>, value: number) {
  const prev = useRef(value);
  useEffect(() => {
    const grew = value > prev.current;
    prev.current = value;
    if (grew && !reducedMotion())
      ref.current?.animate?.(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }],
        { duration: 300, easing: easeOut },
      );
  }, [value]);
}

const Exiting = createContext(false);
export const useExiting = () => useContext(Exiting);

// Keeps its last child mounted for `ms` after it's removed, with useExiting() true, so it
// can animate out. If the child returns mid-exit it's reused and animates back in.
export function Presence({ children, ms = 250 }: { children: ReactNode; ms?: number }) {
  const present = !!children;
  const last = useRef<ReactNode>(null);
  if (present) last.current = children;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (present || !last.current) return;
    const t = setTimeout(() => {
      last.current = null;
      rerender();
    }, ms);
    return () => clearTimeout(t);
  }, [present, ms]);
  if (!present && !last.current) return null;
  return createElement(Exiting.Provider, { value: !present }, last.current);
}
