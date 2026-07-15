import { useState, useEffect, RefObject } from "react";

export function useHorizontalScrollFade(ref: RefObject<HTMLElement | null>): boolean {
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      const hasOverflow = el.scrollWidth > el.clientWidth;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setShowRightFade(hasOverflow && !atEnd);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });

    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [ref]);

  return showRightFade;
}
