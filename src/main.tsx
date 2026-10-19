import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initAnalytics } from "@/lib/analytics";
import { applyTheme, readStoredTheme } from "@/lib/themes";

applyTheme(readStoredTheme());
initAnalytics();

if (window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      const requested = readStoredTheme();
      if (requested === "system") applyTheme("system");
    });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
