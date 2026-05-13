const STORAGE_KEY = "t3code.turnCompletionPushEndpoint";

let currentEndpoint: string | null = null;

export function setTurnNotificationTargetEndpoint(endpoint: string | null): void {
  currentEndpoint = endpoint;
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (endpoint) {
      window.localStorage.setItem(STORAGE_KEY, endpoint);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Notification targeting is best effort; storage failures should not block chat.
  }
}

export function getTurnNotificationTargetEndpoint(): string | null {
  if (currentEndpoint) {
    return currentEndpoint;
  }
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const endpoint = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    currentEndpoint = endpoint.length > 0 ? endpoint : null;
  } catch {
    currentEndpoint = null;
  }
  return currentEndpoint;
}
