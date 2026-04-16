/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
    __T3_APP_AUTH_ENABLED?: boolean;
    __T3_MARK_BOOT_READY?: () => void;
    __T3_WS_TOKEN?: string;
  }
}
