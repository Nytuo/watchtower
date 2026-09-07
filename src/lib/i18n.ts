import { create } from "zustand";

export type Lang = "en" | "fr" | "de" | "es";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
];

const KEY = "watchtower:lang";

type Dict = Record<string, string>;

// English is the source of truth; other locales fall back to it per-key.
const en: Dict = {
  "nav.servers": "Servers",
  "nav.groups": "Groups",
  "nav.tags": "Tags",
  "nav.snippets": "Snippets",
  "nav.keychains": "Keychains",
  "nav.portForwarding": "Port forwarding",
  "nav.knownHosts": "Known hosts",
  "nav.import": "Import",
  "nav.settings": "Settings",

  "action.connect": "Connect",
  "action.edit": "Edit",
  "action.delete": "Delete",
  "action.duplicate": "Duplicate",
  "action.cancel": "Cancel",
  "action.save": "Save",
  "action.import": "Import",
  "action.export": "Export",
  "action.close": "Close",
  "action.newFolder": "New folder",
  "action.rename": "Rename",
  "action.refresh": "Refresh",
  "action.upload": "Upload",
  "action.download": "Download",

  "home.searchPlaceholder": "Search servers…",
  "home.pinned": "Pinned",
  "home.recent": "Recent",
  "home.ungrouped": "Ungrouped",
  "home.newServer": "New server",
  "home.empty": "No servers yet",

  "term.connecting": "Connecting…",
  "term.connected": "Connected",
  "term.connectionFailed": "Connection failed",
  "term.reconnect": "Reconnect",
  "term.splitRight": "Split right",
  "term.splitDown": "Split down",
  "term.closePane": "Close pane",

  "settings.language": "Language",
  "settings.appearance": "Appearance",
  "settings.terminal": "Terminal",

  "import.title": "Import servers",
  "import.subtitle":
    "Bring in hosts from other tools. Credentials are never imported.",
};

const fr: Dict = {
  "nav.servers": "Serveurs",
  "nav.groups": "Groupes",
  "nav.tags": "Étiquettes",
  "nav.snippets": "Extraits",
  "nav.keychains": "Trousseaux",
  "nav.portForwarding": "Redirection de ports",
  "nav.knownHosts": "Hôtes connus",
  "nav.import": "Importer",
  "nav.settings": "Paramètres",
  "action.connect": "Connecter",
  "action.edit": "Modifier",
  "action.delete": "Supprimer",
  "action.duplicate": "Dupliquer",
  "action.cancel": "Annuler",
  "action.save": "Enregistrer",
  "action.import": "Importer",
  "action.export": "Exporter",
  "action.close": "Fermer",
  "action.newFolder": "Nouveau dossier",
  "action.rename": "Renommer",
  "action.refresh": "Actualiser",
  "action.upload": "Envoyer",
  "action.download": "Télécharger",
  "home.searchPlaceholder": "Rechercher des serveurs…",
  "home.pinned": "Épinglés",
  "home.recent": "Récents",
  "home.ungrouped": "Sans groupe",
  "home.newServer": "Nouveau serveur",
  "home.empty": "Aucun serveur",
  "term.connecting": "Connexion…",
  "term.connected": "Connecté",
  "term.connectionFailed": "Échec de la connexion",
  "term.reconnect": "Reconnecter",
  "term.splitRight": "Diviser à droite",
  "term.splitDown": "Diviser en bas",
  "term.closePane": "Fermer le panneau",
  "settings.language": "Langue",
  "settings.appearance": "Apparence",
  "settings.terminal": "Terminal",
  "import.title": "Importer des serveurs",
  "import.subtitle":
    "Importez des hôtes depuis d'autres outils. Les identifiants ne sont jamais importés.",
};

const de: Dict = {
  "nav.servers": "Server",
  "nav.groups": "Gruppen",
  "nav.tags": "Tags",
  "nav.snippets": "Snippets",
  "nav.keychains": "Schlüsselbunde",
  "nav.portForwarding": "Portweiterleitung",
  "nav.knownHosts": "Bekannte Hosts",
  "nav.import": "Importieren",
  "nav.settings": "Einstellungen",
  "action.connect": "Verbinden",
  "action.edit": "Bearbeiten",
  "action.delete": "Löschen",
  "action.cancel": "Abbrechen",
  "action.save": "Speichern",
  "home.searchPlaceholder": "Server suchen…",
  "term.connected": "Verbunden",
  "term.reconnect": "Erneut verbinden",
  "settings.language": "Sprache",
};

const es: Dict = {
  "nav.servers": "Servidores",
  "nav.groups": "Grupos",
  "nav.tags": "Etiquetas",
  "nav.snippets": "Fragmentos",
  "nav.keychains": "Llaveros",
  "nav.portForwarding": "Reenvío de puertos",
  "nav.knownHosts": "Hosts conocidos",
  "nav.import": "Importar",
  "nav.settings": "Ajustes",
  "action.connect": "Conectar",
  "action.edit": "Editar",
  "action.delete": "Eliminar",
  "action.cancel": "Cancelar",
  "action.save": "Guardar",
  "home.searchPlaceholder": "Buscar servidores…",
  "term.connected": "Conectado",
  "term.reconnect": "Reconectar",
  "settings.language": "Idioma",
};

const DICTS: Record<Lang, Dict> = { en, fr, de, es };

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v && v in DICTS) return v as Lang;
  } catch {
    /* ignore */
  }
  return "en";
}

interface LangStore {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const useLangStore = create<LangStore>((set) => ({
  lang: read(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* ignore */
    }
    set({ lang });
  },
}));

export function getLang(): Lang {
  return useLangStore.getState().lang;
}

export function setLang(l: Lang) {
  useLangStore.getState().setLang(l);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[getLang()];
  let s = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

// Re-renders on language change; returns a translator bound to the current lang.
export function useT(): (
  key: string,
  vars?: Record<string, string | number>,
) => string {
  const lang = useLangStore((s) => s.lang);
  return (key, vars) => {
    const dict = DICTS[lang];
    let s = dict[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  };
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useLangStore((s) => s.lang);
  const set = useLangStore((s) => s.setLang);
  return [lang, set];
}
