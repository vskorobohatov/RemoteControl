import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Give a scrollable log a way to its newest line, and use it exactly twice: once when
 * the viewer mounts, because mounting the viewer is opening the log, and once per
 * explicit jump. A refresh changes the text without changing anything this hook watches,
 * so it leaves the reader wherever they had scrolled to.
 *
 * The jump is armed rather than performed at open: the fetch that follows an open is
 * async, and scrolling the placeholder is a jump that silently misses. `ready` says the
 * real content is in the DOM, and that is when the armed jump is carried out.
 *
 * `useLayoutEffect` rather than `useEffect` - it runs after the DOM mutation but before
 * the paint, so the panel appears already at the bottom instead of flashing the top.
 */
export function useScrollToEnd(ref: RefObject<HTMLElement | null>, ready: boolean): () => void {
  const armed = useRef(true);

  useLayoutEffect(() => {
    if (!ready || !armed.current) {
      return;
    }
    const element = ref.current;
    if (element === null) {
      return;
    }
    armed.current = false;
    element.scrollTop = element.scrollHeight;
  }, [ready]);

  return useCallback(() => {
    armed.current = true;
    const element = ref.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, []);
}
