import type { ReactNode } from "react";
import { useState } from "react";

import { APP_DISPLAY_NAME } from "../branding";
import { useServerAuth } from "../serverAuthContext";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ServerAuthGate({ children }: { children: ReactNode }) {
  const auth = useServerAuth();
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (auth.status === "authenticated") {
    return <>{children}</>;
  }

  if (auth.status === "loading") {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">Authorizing {APP_DISPLAY_NAME}…</p>
        </div>
      </div>
    );
  }

  const errorMessage = submitError ?? auth.error;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="relative w-full max-w-md rounded-2xl border border-border/80 bg-card/95 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Pair This Browser</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Open a pairing link here, or paste a pairing token from your trusted T3 Code session.
        </p>

        <form
          className="mt-6 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitting(true);
            setSubmitError(null);
            void auth
              .submitCredential(credential)
              .catch((error) => {
                setSubmitError(error instanceof Error ? error.message : "Authentication failed.");
              })
              .finally(() => {
                setSubmitting(false);
              });
          }}
        >
          <Input
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="Paste pairing token"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Pairing…" : "Continue"}
          </Button>
        </form>

        {errorMessage ? <p className="mt-3 text-sm text-red-500">{errorMessage}</p> : null}
      </section>
    </div>
  );
}
