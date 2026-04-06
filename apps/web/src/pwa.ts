import { useSyncExternalStore } from "react";

import { isElectron } from "./env";

const SERVICE_WORKER_URL = "/sw.js";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  prompt: () => Promise<void>;
  userChoice: Promise<{
    readonly outcome: "accepted" | "dismissed";
    readonly platform: string;
  }>;
}

export interface PwaInstallState {
  readonly supported: boolean;
  readonly canPrompt: boolean;
  readonly isStandalone: boolean;
  readonly showIosInstallHint: boolean;
}

let initialized = false;
let installPromptEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function canUseServiceWorker() {
  if (typeof window === "undefined") {
    return false;
  }

  if (isElectron || !("serviceWorker" in navigator)) {
    return false;
  }

  return (
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false) === true
  );
}

function isIosSafariLike() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(userAgent) && /Safari/i.test(userAgent);
}

export function getPwaInstallState(): PwaInstallState {
  const supported = typeof window !== "undefined" && !isElectron;
  const isStandalone = isStandaloneDisplayMode();
  const showIosInstallHint =
    supported && !isStandalone && installPromptEvent === null && isIosSafariLike();

  return {
    supported,
    canPrompt: installPromptEvent !== null,
    isStandalone,
    showIosInstallHint,
  };
}

export function subscribeToPwaInstallState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePwaInstallState() {
  return useSyncExternalStore(subscribeToPwaInstallState, getPwaInstallState, getPwaInstallState);
}

export async function registerPwaServiceWorker() {
  if (!canUseServiceWorker()) {
    return null;
  }

  return navigator.serviceWorker.register(SERVICE_WORKER_URL);
}

export async function promptForPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!installPromptEvent) {
    return "unavailable";
  }

  const deferredPrompt = installPromptEvent;
  installPromptEvent = null;
  notifyListeners();

  await deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  return result.outcome;
}

export function initializePwa() {
  if (initialized || typeof window === "undefined" || isElectron) {
    return;
  }
  initialized = true;

  void registerPwaServiceWorker().catch(() => null);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPromptEvent = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    notifyListeners();
  });
}
