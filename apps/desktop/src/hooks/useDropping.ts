import { useEffect, useRef, useState } from 'react';

/**
 * Returns true for `durationMs` after `isDragging` transitions from true to false.
 * Use to keep drag appearance during the drop animation so the item does not lose
 * its highlighted style while the FLIP animation is still playing.
 */
export function useDropping(isDragging: boolean, durationMs = 220): boolean {
  const [dropping, setDropping] = useState(false);
  const wasDragging = useRef(false);

  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
      return;
    }
    if (!wasDragging.current) return;
    // Don't reset wasDragging here — keep it true so StrictMode's second effect
    // invocation (after cleanup) can also schedule the timeout.

    setDropping(true);
    const id = setTimeout(() => {
      setDropping(false);
      wasDragging.current = false;
    }, durationMs);
    return () => clearTimeout(id);
  }, [isDragging, durationMs]);

  return dropping;
}
