import { useEffect, useState } from "react";
import { isMobile } from "@/lib/platform";

export function useViewportHeight() {
  useEffect(() => {
    if (!isMobile) return;
    document.documentElement.classList.add("is-mobile");
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
      window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
}

export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!isMobile || !vv) return;
    const check = () =>
      setOpen(window.screen.height - vv.height > 220 && vv.height < window.innerHeight + 1);
    check();
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, []);
  return open;
}
