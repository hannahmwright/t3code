const DESKTOP_HTTP_BASE_URL_QUERY_PARAM = "desktopHttpBaseUrl";
const DESKTOP_WS_BASE_URL_QUERY_PARAM = "desktopWsBaseUrl";

export interface DesktopUrlBootstrap {
  readonly label: string;
  readonly httpBaseUrl: string | null;
  readonly wsBaseUrl: string | null;
}

function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = new URL(window.location.href).searchParams.get(name);
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

export function readDesktopUrlBootstrap(): DesktopUrlBootstrap | null {
  const httpBaseUrl = readQueryParam(DESKTOP_HTTP_BASE_URL_QUERY_PARAM);
  const wsBaseUrl = readQueryParam(DESKTOP_WS_BASE_URL_QUERY_PARAM);

  if (!httpBaseUrl && !wsBaseUrl) {
    return null;
  }

  return {
    label: "Local desktop",
    httpBaseUrl,
    wsBaseUrl,
  };
}
