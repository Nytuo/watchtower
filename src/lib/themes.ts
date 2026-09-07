export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent?: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

interface CoreColors {
  bg: string;
  surface: string;
  elevated: string;
  fg: string;
  fgMuted: string;
  border: string;
  primary: string;
  primaryFg: string;
  destructive: string;
  destructiveFg: string;
  ring: string;
  sidebarBg: string;
}

export interface ThemeDef {
  key: string;
  label: string;
  group: "Base" | "Popular" | "Pastel";
  dark: boolean;
  core: CoreColors;
  terminal: TerminalPalette;
}

function expand(c: CoreColors): Record<string, string> {
  return {
    background: c.bg,
    foreground: c.fg,
    card: c.surface,
    "card-foreground": c.fg,
    popover: c.surface,
    "popover-foreground": c.fg,
    primary: c.primary,
    "primary-foreground": c.primaryFg,
    secondary: c.elevated,
    "secondary-foreground": c.fg,
    muted: c.elevated,
    "muted-foreground": c.fgMuted,
    accent: c.elevated,
    "accent-foreground": c.fg,
    destructive: c.destructive,
    "destructive-foreground": c.destructiveFg,
    border: c.border,
    input: c.border,
    ring: c.ring,
    "sidebar-background": c.sidebarBg,
    "sidebar-foreground": c.fg,
    "sidebar-primary": c.primary,
    "sidebar-primary-foreground": c.primaryFg,
    "sidebar-accent": c.elevated,
    "sidebar-accent-foreground": c.fg,
    "sidebar-border": c.border,
    "sidebar-ring": c.ring,
  };
}

export const THEMES: Record<string, ThemeDef> = {
  dark: {
    key: "dark",
    label: "Watchtower Dark",
    group: "Base",
    dark: true,
    core: {
      bg: "#0a0a0a",
      surface: "#0a0a0a",
      elevated: "#262626",
      fg: "#fafafa",
      fgMuted: "#a3a3a3",
      border: "#262626",
      primary: "#fafafa",
      primaryFg: "#171717",
      destructive: "#7f1d1d",
      destructiveFg: "#fafafa",
      ring: "#d4d4d4",
      sidebarBg: "#0f0f0f",
    },
    terminal: {
      background: "#0a0a0a",
      foreground: "#fafafa",
      cursor: "#fafafa",
      selectionBackground: "#264f78",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    },
  },
  light: {
    key: "light",
    label: "Watchtower Light",
    group: "Base",
    dark: false,
    core: {
      bg: "#ffffff",
      surface: "#ffffff",
      elevated: "#f4f4f5",
      fg: "#09090b",
      fgMuted: "#71717a",
      border: "#e4e4e7",
      primary: "#18181b",
      primaryFg: "#fafafa",
      destructive: "#ef4444",
      destructiveFg: "#fafafa",
      ring: "#a1a1aa",
      sidebarBg: "#fafafa",
    },
    terminal: {
      background: "#ffffff",
      foreground: "#24292e",
      cursor: "#24292e",
      selectionBackground: "#add6ff",
      black: "#24292e",
      red: "#d73a49",
      green: "#22863a",
      yellow: "#b08800",
      blue: "#0366d6",
      magenta: "#6f42c1",
      cyan: "#1b7c83",
      white: "#6a737d",
      brightBlack: "#959da5",
      brightRed: "#cb2431",
      brightGreen: "#28a745",
      brightYellow: "#dbab09",
      brightBlue: "#2188ff",
      brightMagenta: "#8a63d2",
      brightCyan: "#3192aa",
      brightWhite: "#d1d5da",
    },
  },
  "one-dark": {
    key: "one-dark",
    label: "One Dark",
    group: "Popular",
    dark: true,
    core: {
      bg: "#282c34",
      surface: "#21252b",
      elevated: "#3b4048",
      fg: "#abb2bf",
      fgMuted: "#828997",
      border: "#3b4048",
      primary: "#61afef",
      primaryFg: "#282c34",
      destructive: "#e06c75",
      destructiveFg: "#282c34",
      ring: "#61afef",
      sidebarBg: "#21252b",
    },
    terminal: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },
  dracula: {
    key: "dracula",
    label: "Dracula",
    group: "Popular",
    dark: true,
    core: {
      bg: "#282a36",
      surface: "#21222c",
      elevated: "#44475a",
      fg: "#f8f8f2",
      fgMuted: "#a3a5b8",
      border: "#44475a",
      primary: "#bd93f9",
      primaryFg: "#282a36",
      destructive: "#ff5555",
      destructiveFg: "#282a36",
      ring: "#bd93f9",
      sidebarBg: "#191a21",
    },
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  nord: {
    key: "nord",
    label: "Nord",
    group: "Popular",
    dark: true,
    core: {
      bg: "#2e3440",
      surface: "#2b303b",
      elevated: "#3b4252",
      fg: "#eceff4",
      fgMuted: "#a9b1c2",
      border: "#3b4252",
      primary: "#88c0d0",
      primaryFg: "#2e3440",
      destructive: "#bf616a",
      destructiveFg: "#eceff4",
      ring: "#88c0d0",
      sidebarBg: "#272c36",
    },
    terminal: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  "gruvbox-dark": {
    key: "gruvbox-dark",
    label: "Gruvbox Dark",
    group: "Popular",
    dark: true,
    core: {
      bg: "#282828",
      surface: "#1d2021",
      elevated: "#3c3836",
      fg: "#ebdbb2",
      fgMuted: "#a89984",
      border: "#3c3836",
      primary: "#fabd2f",
      primaryFg: "#282828",
      destructive: "#fb4934",
      destructiveFg: "#282828",
      ring: "#fabd2f",
      sidebarBg: "#1d2021",
    },
    terminal: {
      background: "#282828",
      foreground: "#ebdbb2",
      cursor: "#ebdbb2",
      selectionBackground: "#504945",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  "tokyo-night": {
    key: "tokyo-night",
    label: "Tokyo Night",
    group: "Popular",
    dark: true,
    core: {
      bg: "#1a1b26",
      surface: "#16161e",
      elevated: "#292e42",
      fg: "#c0caf5",
      fgMuted: "#9aa5ce",
      border: "#292e42",
      primary: "#7aa2f7",
      primaryFg: "#1a1b26",
      destructive: "#f7768e",
      destructiveFg: "#1a1b26",
      ring: "#7aa2f7",
      sidebarBg: "#16161e",
    },
    terminal: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  "solarized-dark": {
    key: "solarized-dark",
    label: "Solarized Dark",
    group: "Popular",
    dark: true,
    core: {
      bg: "#002b36",
      surface: "#073642",
      elevated: "#094a58",
      fg: "#93a1a1",
      fgMuted: "#657b83",
      border: "#094a58",
      primary: "#268bd2",
      primaryFg: "#002b36",
      destructive: "#dc322f",
      destructiveFg: "#fdf6e3",
      ring: "#268bd2",
      sidebarBg: "#00252e",
    },
    terminal: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#839496",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  "catppuccin-mocha": {
    key: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    group: "Pastel",
    dark: true,
    core: {
      bg: "#1e1e2e",
      surface: "#181825",
      elevated: "#313244",
      fg: "#cdd6f4",
      fgMuted: "#a6adc8",
      border: "#313244",
      primary: "#cba6f7",
      primaryFg: "#1e1e2e",
      destructive: "#f38ba8",
      destructiveFg: "#1e1e2e",
      ring: "#cba6f7",
      sidebarBg: "#11111b",
    },
    terminal: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      selectionBackground: "#585b70",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
  "catppuccin-latte": {
    key: "catppuccin-latte",
    label: "Catppuccin Latte",
    group: "Pastel",
    dark: false,
    core: {
      bg: "#eff1f5",
      surface: "#e6e9ef",
      elevated: "#ccd0da",
      fg: "#4c4f69",
      fgMuted: "#6c6f85",
      border: "#ccd0da",
      primary: "#8839ef",
      primaryFg: "#eff1f5",
      destructive: "#d20f39",
      destructiveFg: "#eff1f5",
      ring: "#8839ef",
      sidebarBg: "#dce0e8",
    },
    terminal: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      cursor: "#dc8a78",
      selectionBackground: "#acb0be",
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#acb0be",
      brightBlack: "#6c6f85",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#ea76cb",
      brightCyan: "#179299",
      brightWhite: "#bcc0cc",
    },
  },
  "rose-pine": {
    key: "rose-pine",
    label: "Rosé Pine",
    group: "Pastel",
    dark: true,
    core: {
      bg: "#191724",
      surface: "#1f1d2e",
      elevated: "#26233a",
      fg: "#e0def4",
      fgMuted: "#908caa",
      border: "#26233a",
      primary: "#c4a7e7",
      primaryFg: "#191724",
      destructive: "#eb6f92",
      destructiveFg: "#191724",
      ring: "#c4a7e7",
      sidebarBg: "#16141f",
    },
    terminal: {
      background: "#191724",
      foreground: "#e0def4",
      cursor: "#524f67",
      selectionBackground: "#403d52",
      black: "#26233a",
      red: "#eb6f92",
      green: "#31748f",
      yellow: "#f6c177",
      blue: "#9ccfd8",
      magenta: "#c4a7e7",
      cyan: "#ebbcba",
      white: "#e0def4",
      brightBlack: "#6e6a86",
      brightRed: "#eb6f92",
      brightGreen: "#31748f",
      brightYellow: "#f6c177",
      brightBlue: "#9ccfd8",
      brightMagenta: "#c4a7e7",
      brightCyan: "#ebbcba",
      brightWhite: "#e0def4",
    },
  },
};

export const DEFAULT_THEME_KEY = "dark";
export const THEME_STORAGE_KEY = "watchtower:theme";

export function resolveThemeKey(key: string | null | undefined): string {
  if (!key || key === "system") {
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }
  return THEMES[key] ? key : DEFAULT_THEME_KEY;
}

export function terminalPalette(
  key: string | null | undefined,
): TerminalPalette {
  return (THEMES[resolveThemeKey(key)] ?? THEMES[DEFAULT_THEME_KEY]).terminal;
}

export function applyTheme(key: string | null | undefined) {
  if (typeof document === "undefined") return;
  const resolved = resolveThemeKey(key);
  const theme = THEMES[resolved] ?? THEMES[DEFAULT_THEME_KEY];
  const root = document.documentElement;
  const vars = expand(theme.core);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(`--color-${name}`, value);
  }
  root.style.colorScheme = theme.dark ? "dark" : "light";
  root.dataset.theme = resolved;
  root.dataset.themeRequested = key || "system";
}

export function readStoredTheme(): string {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "system";
  } catch {
    return "system";
  }
}

export function storeTheme(key: string) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, key);
  } catch {
    /* ignore */
  }
}
