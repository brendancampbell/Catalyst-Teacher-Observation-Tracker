import { useState, useEffect } from "react";

export function useViewportHeight(): number {
  const getHeight = () => {
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    return window.innerHeight / zoom;
  };

  const [height, setHeight] = useState(getHeight);

  useEffect(() => {
    const update = () => setHeight(getHeight());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return height;
}
