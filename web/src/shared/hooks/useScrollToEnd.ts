import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/* How close to the bottom still counts as being at the end. */
const FOLLOW_EPSILON_PX = 24;

function isAtEnd(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_EPSILON_PX;
}

/**
 * Keeps a scrollable box pinned to its end while its content grows, and hands over the
 * moment the reader takes over: scrolling away from the bottom stops the following, and
 * the returned function resumes it. `followKey` must change whenever the content changes,
 * because that is what re-runs the pin.
 */
export function useScrollToEnd(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
  followKey: unknown,
): () => void {
  const following = useRef(true);

  const scrollToTheEnd = useCallback(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    following.current = true;
    element.scrollTop = element.scrollHeight;
  }, [ref]);

  /* Only the reader decides. A pin lands at the end, so the scroll event it causes reads
     back as "still at the end" and keeps following on; scrolling up breaks it. */
  useEffect(() => {
    if (!ready) {
      return;
    }
    const element = ref.current;
    if (element === null) {
      return;
    }
    const onScroll = () => {
      following.current = isAtEnd(element);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
    };
  }, [ready, ref]);

  useLayoutEffect(() => {
    if (!ready || !following.current) {
      return;
    }
    scrollToTheEnd();
  }, [ready, followKey, scrollToTheEnd]);

  return scrollToTheEnd;
}
