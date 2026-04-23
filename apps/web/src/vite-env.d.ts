/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly VITE_HTTP_URL: string;
  readonly VITE_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
