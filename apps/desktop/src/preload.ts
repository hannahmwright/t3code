import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@t3tools/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const PET_COMPANION_TOGGLE_CHANNEL = "desktop:pet-companion-toggle";
const PET_COMPANION_GET_STATE_CHANNEL = "desktop:pet-companion-get-state";
const PET_COMPANION_SET_STATE_CHANNEL = "desktop:pet-companion-set-state";
const PET_COMPANION_STATE_CHANNEL = "desktop:pet-companion-state";
const PET_COMPANION_GET_USAGE_CHANNEL = "desktop:pet-companion-get-usage";
const PET_COMPANION_SET_USAGE_CHANNEL = "desktop:pet-companion-set-usage";
const PET_COMPANION_USAGE_CHANNEL = "desktop:pet-companion-usage";
const PET_COMPANION_GET_STATUS_CHANNEL = "desktop:pet-companion-get-status";
const PET_COMPANION_SET_STATUS_CHANNEL = "desktop:pet-companion-set-status";
const PET_COMPANION_STATUS_CHANNEL = "desktop:pet-companion-status";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const wsUrl = process.env.T3CODE_DESKTOP_WS_URL ?? null;

function readBootstrapToken(rawWsUrl: string | null): string | null {
  if (!rawWsUrl) {
    return null;
  }

  try {
    return new URL(rawWsUrl).searchParams.get("token");
  } catch {
    return null;
  }
}

function toHttpBaseUrl(rawWsUrl: string | null): string | null {
  if (!rawWsUrl) {
    return null;
  }

  try {
    const url = new URL(rawWsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    return url.origin;
  } catch {
    return null;
  }
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => wsUrl,
  getLocalEnvironmentBootstrap: () => {
    if (!wsUrl) {
      return null;
    }

    const bootstrapToken = readBootstrapToken(wsUrl);
    return {
      label: "Local desktop",
      httpBaseUrl: toHttpBaseUrl(wsUrl),
      wsBaseUrl: wsUrl,
      ...(bootstrapToken ? { bootstrapToken } : {}),
    };
  },
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  togglePetCompanion: () => ipcRenderer.invoke(PET_COMPANION_TOGGLE_CHANNEL),
  getPetCompanionState: () => ipcRenderer.invoke(PET_COMPANION_GET_STATE_CHANNEL),
  setPetCompanionState: (state: string) =>
    ipcRenderer.invoke(PET_COMPANION_SET_STATE_CHANNEL, state),
  onPetCompanionState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "string") return;
      listener(state);
    };

    ipcRenderer.on(PET_COMPANION_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(PET_COMPANION_STATE_CHANNEL, wrappedListener);
    };
  },
  getPetCompanionUsage: () => ipcRenderer.invoke(PET_COMPANION_GET_USAGE_CHANNEL),
  setPetCompanionUsage: (usage) => ipcRenderer.invoke(PET_COMPANION_SET_USAGE_CHANNEL, usage),
  onPetCompanionUsage: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, usage: unknown) => {
      listener(usage as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(PET_COMPANION_USAGE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(PET_COMPANION_USAGE_CHANNEL, wrappedListener);
    };
  },
  getPetCompanionStatus: () => ipcRenderer.invoke(PET_COMPANION_GET_STATUS_CHANNEL),
  setPetCompanionStatus: (status) => ipcRenderer.invoke(PET_COMPANION_SET_STATUS_CHANNEL, status),
  onPetCompanionStatus: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, status: unknown) => {
      listener(status as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(PET_COMPANION_STATUS_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(PET_COMPANION_STATUS_CHANNEL, wrappedListener);
    };
  },
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
