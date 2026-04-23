import type { AuthSessionState } from "@t3tools/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  fetchServerAuthSessionState,
  peekPairingCredentialFromUrl,
  readEnvironmentBootstrapCredential,
  stripPairingCredentialFromUrl,
  submitServerAuthCredential,
} from "./serverAuth";
import { isElectron } from "./env";

type ServerAuthGateState =
  | { status: "loading"; session: AuthSessionState | null; error: string | null }
  | { status: "requires-auth"; session: AuthSessionState; error: string | null }
  | { status: "authenticated"; session: AuthSessionState; error: string | null };

type ServerAuthContextValue = ServerAuthGateState & {
  readonly refresh: () => Promise<void>;
  readonly submitCredential: (credential: string) => Promise<void>;
};

const ServerAuthContext = createContext<ServerAuthContextValue | null>(null);

export function ServerAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerAuthGateState>({
    status: "loading",
    session: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      setState((current) => ({ ...current, status: "loading", error: null }));

      const desktopBootstrapCredential = readEnvironmentBootstrapCredential();
      if (isElectron && desktopBootstrapCredential) {
        setState({
          status: "authenticated",
          session: {
            authenticated: true,
            auth: { enabled: true },
          },
          error: null,
        });
        return;
      }

      const initialSession = await fetchServerAuthSessionState();
      if (!initialSession.auth.enabled || initialSession.authenticated) {
        setState({
          status: "authenticated",
          session: initialSession,
          error: null,
        });
        return;
      }

      const pairingCredential = peekPairingCredentialFromUrl();
      const bootstrapCredential = pairingCredential ?? desktopBootstrapCredential;
      if (!bootstrapCredential) {
        setState({
          status: "requires-auth",
          session: initialSession,
          error: null,
        });
        return;
      }

      await submitServerAuthCredential(bootstrapCredential);
      if (pairingCredential) {
        stripPairingCredentialFromUrl();
      }
      const authenticatedSession = await fetchServerAuthSessionState();
      setState({
        status: authenticatedSession.authenticated ? "authenticated" : "requires-auth",
        session: authenticatedSession,
        error: authenticatedSession.authenticated ? null : "Authentication is still required.",
      });
    } catch (error) {
      setState({
        status: "requires-auth",
        session: {
          authenticated: false,
          auth: { enabled: true },
        },
        error: error instanceof Error ? error.message : "Authentication failed.",
      });
    }
  }, []);

  const submitCredential = useCallback(async (credential: string) => {
    await submitServerAuthCredential(credential);
    stripPairingCredentialFromUrl();
    const nextSession = await fetchServerAuthSessionState();
    setState({
      status: nextSession.authenticated ? "authenticated" : "requires-auth",
      session: nextSession,
      error: nextSession.authenticated ? null : "Authentication is still required.",
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<ServerAuthContextValue>(
    () => ({
      ...state,
      refresh,
      submitCredential,
    }),
    [refresh, state, submitCredential],
  );

  return <ServerAuthContext.Provider value={value}>{children}</ServerAuthContext.Provider>;
}

export function useServerAuth(): ServerAuthContextValue {
  const value = useContext(ServerAuthContext);
  if (!value) {
    throw new Error("useServerAuth must be used within ServerAuthProvider");
  }
  return value;
}
