const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isAndroid = /Android/i.test(ua);
export const isIOS =
  /iPhone|iPad|iPod/i.test(ua) ||
  (/Macintosh/i.test(ua) &&
    typeof navigator !== "undefined" &&
    navigator.maxTouchPoints > 1);
export const isMobile = isAndroid || isIOS;
