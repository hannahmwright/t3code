import { FolderIcon } from "lucide-react";
import { useState } from "react";
import { resolveServerUrl } from "~/lib/utils";

const loadedProjectFaviconSrcs = new Set<string>();

export function ProjectFavicon({
  cwd,
  emoji,
  className,
}: {
  cwd: string;
  emoji?: string | null;
  className?: string;
}) {
  if (emoji) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex size-4.5 shrink-0 items-center justify-center text-base leading-none md:size-3.5 md:text-sm ${className ?? ""}`}
      >
        {emoji}
      </span>
    );
  }

  const src = resolveServerUrl({
    protocol: "http",
    pathname: "/api/project-favicon",
    searchParams: { cwd },
  });
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  return (
    <>
      {status !== "loaded" ? (
        <FolderIcon
          className={`size-4.5 shrink-0 text-muted-foreground/50 md:size-3.5 ${className ?? ""}`}
        />
      ) : null}
      <img
        src={src}
        alt=""
        className={`size-4.5 shrink-0 rounded-sm object-contain md:size-3.5 ${status === "loaded" ? "" : "hidden"} ${className ?? ""}`}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(src);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}
