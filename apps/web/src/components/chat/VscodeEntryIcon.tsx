import { memo, useEffect, useMemo, useState } from "react";
import { FileIcon, FolderIcon } from "lucide-react";
import { cn } from "~/lib/utils";

let vscodeIconModulePromise: Promise<typeof import("../../vscode-icons")> | null = null;
const resolvedIconUrlCache = new Map<string, string>();

function getIconCacheKey(
  pathValue: string,
  kind: "file" | "directory",
  theme: "light" | "dark",
): string {
  return `${theme}:${kind}:${pathValue}`;
}

function loadVscodeIconUrl(
  pathValue: string,
  kind: "file" | "directory",
  theme: "light" | "dark",
): Promise<string> {
  const cacheKey = getIconCacheKey(pathValue, kind, theme);
  const cached = resolvedIconUrlCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  vscodeIconModulePromise ??= import("../../vscode-icons");

  return vscodeIconModulePromise.then(({ getVscodeIconUrlForEntry }) => {
    const iconUrl = getVscodeIconUrlForEntry(pathValue, kind, theme);
    resolvedIconUrlCache.set(cacheKey, iconUrl);
    return iconUrl;
  });
}

export const VscodeEntryIcon = memo(function VscodeEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  className?: string;
}) {
  const cacheKey = useMemo(
    () => getIconCacheKey(props.pathValue, props.kind, props.theme),
    [props.kind, props.pathValue, props.theme],
  );
  const [iconUrl, setIconUrl] = useState<string | null>(
    () => resolvedIconUrlCache.get(cacheKey) ?? null,
  );
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFailedIconUrl(null);
    const cached = resolvedIconUrlCache.get(cacheKey) ?? null;
    if (cached) {
      setIconUrl(cached);
      return () => {
        cancelled = true;
      };
    }

    setIconUrl(null);
    void loadVscodeIconUrl(props.pathValue, props.kind, props.theme)
      .then((nextIconUrl) => {
        if (!cancelled) {
          setIconUrl(nextIconUrl);
        }
      })
      .catch((error: unknown) => {
        console.warn("Failed to load VS Code file icons manifest", error);
        if (!cancelled) {
          setIconUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, props.kind, props.pathValue, props.theme]);

  const failed = failedIconUrl === iconUrl;

  if (failed || iconUrl == null) {
    return props.kind === "directory" ? (
      <FolderIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
    ) : (
      <FileIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", props.className)}
      loading="lazy"
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
});
