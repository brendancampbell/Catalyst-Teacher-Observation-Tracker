import { useRef } from "react";
import { useHorizontalScrollFade } from "@/hooks/useHorizontalScrollFade";
import { cn } from "@/lib/utils";

interface ScrollFadeContainerProps {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function ScrollFadeContainer({ className, style, children }: ScrollFadeContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const showRightFade = useHorizontalScrollFade(scrollRef);

  return (
    <div className="relative h-full min-h-0">
      <div ref={scrollRef} className={cn(className)} style={style}>
        {children}
      </div>
      {showRightFade && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 48,
            pointerEvents: "none",
            background: "linear-gradient(to left, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0) 100%)",
            borderRadius: "0 6px 6px 0",
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}
