import { useState, useEffect, RefObject } from "react";

interface ScrollFadeState {
  showRightFade: boolean;
  showLeftFade: boolean;
}

export function useHorizontalScrollFade(ref: RefObject<HTMLElement | null>): ScrollFadeState {
  const [state, setState] = useState<ScrollFadeState>({ showRightFade: false, showLeftFade: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      const hasOverflow = el.scrollWidth > el.clientWidth;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setState({
        showRightFade: hasOverflow && !atEnd,
        showLeftFade: el.scrollLeft > 0,
      });
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

  return state;
}
