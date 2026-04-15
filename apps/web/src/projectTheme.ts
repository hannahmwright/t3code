import type { CSSProperties } from "react";

type ThemedStyle = CSSProperties & {
  "--project-accent-color"?: string;
  "--project-accent-background"?: string;
  "--project-accent-background-strong"?: string;
  "--project-accent-border"?: string;
  "--project-accent-text"?: string;
  "--project-accent-ring"?: string;
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandShortHexColor(color: string): string {
  if (color.length !== 4) {
    return color.toUpperCase();
  }

  const [, r, g, b] = color;
  return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
}

export function normalizeProjectAccentColor(color: string | null | undefined): string | null {
  if (typeof color !== "string") {
    return null;
  }

  const trimmed = color.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null;
  }

  return expandShortHexColor(trimmed);
}

export function buildProjectThemeStyle(color: string | null | undefined): ThemedStyle | undefined {
  const normalizedColor = normalizeProjectAccentColor(color);
  if (!normalizedColor) {
    return undefined;
  }

  return {
    "--project-accent-color": normalizedColor,
    "--project-accent-background": `color-mix(in srgb, ${normalizedColor} 10%, var(--background))`,
    "--project-accent-background-strong": `color-mix(in srgb, ${normalizedColor} 18%, var(--background))`,
    "--project-accent-border": `color-mix(in srgb, ${normalizedColor} 28%, var(--border))`,
    "--project-accent-text": `color-mix(in srgb, ${normalizedColor} 72%, var(--foreground))`,
    "--project-accent-ring": `color-mix(in srgb, ${normalizedColor} 24%, transparent)`,
  };
}
