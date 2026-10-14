import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { logUi } from "./ipc";

// UI errors go to the log file too (at most 50 a session, so a loop can't fill it).
let logged = 0;
const logError = (what: string) => {
  if (logged++ < 50) void logUi(what).catch(() => {});
};
window.addEventListener("error", (e) => logError(`${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener("unhandledrejection", (e) => logError(`unhandled rejection: ${String(e.reason)}`));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
