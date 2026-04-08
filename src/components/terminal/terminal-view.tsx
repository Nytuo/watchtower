import { useEffect, useRef } from "react";
import { useTerminal } from "@/hooks/use-terminal";
import type { ServerInfo } from "@/lib/tauri";

interface TerminalViewProps {
  sessionId: string;
  server: ServerInfo;
  active: boolean;
}

export function TerminalView({ sessionId, server, active }: TerminalViewProps) {
  const { containerRef, safeFit } = useTerminal({ sessionId, server });
  const prevActiveRef = useRef(active);

  useEffect(() => {
    if (active && !prevActiveRef.current) {
      requestAnimationFrame(() => {
        safeFit();
      });
    }
    prevActiveRef.current = active;
  }, [active, safeFit]);

  return (
    <div
      className="h-full w-full"
      style={
        active
          ? { padding: 0 }
          : {
              padding: 0,
              visibility: "hidden",
              position: "absolute",
              top: 0,
              left: 0,
            }
      }
      ref={containerRef}
    />
  );
}
