import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { isElectron } from "./env";
import { readBootstrapCache } from "./bootstrapCache";
import { initializePwa, migrateStandalonePathToHashRoute, shouldUseHashRouting } from "./pwa";
import { setServerConfigSnapshot } from "./rpc/serverState";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { hydrateShellBootstrapState, useStore } from "./store";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
document.title = APP_DISPLAY_NAME;

initializePwa();
migrateStandalonePathToHashRoute();

const cachedBootstrap = readBootstrapCache();
if (cachedBootstrap?.serverConfig) {
  setServerConfigSnapshot(cachedBootstrap.serverConfig);
}
const cachedShellState = cachedBootstrap?.shellState;
if (cachedShellState) {
  useStore.setState((state) => hydrateShellBootstrapState(state, cachedShellState));
}

const history = isElectron || shouldUseHashRouting() ? createHashHistory() : createBrowserHistory();
const router = getRouter(history);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
