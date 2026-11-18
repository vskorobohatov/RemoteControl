import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@shared/lib/clipboard";

/* A copy button that worked stays marked for a moment so the reader sees the value
   landed on the clipboard; a copy zone that is unchanged says nothing about it. */
const COPIED_FLASH_MS = 1_600;

export interface CopyFlash {
  copied: boolean;
  copy: (value: string) => Promise<boolean>;
}

/** One copy zone's state: the clipboard write, the flash that reports it, and its timer. */
export function useCopyFlash(): CopyFlash {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const copy = useCallback(
    async (value: string) => {
      const ok = await copyToClipboard(value);
      setCopied(ok);
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
      timer.current = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
      return ok;
    },
    [],
  );

  return { copied, copy };
}
