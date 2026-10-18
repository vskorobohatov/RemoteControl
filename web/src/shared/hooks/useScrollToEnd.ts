import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

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
