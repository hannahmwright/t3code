import Mime from "@effect/platform-node/Mime";
import { Data, Effect, FileSystem, Layer, Option, Path } from "effect";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths";
import { resolveAttachmentPathById } from "./attachmentStore";
import {
  clearAppAuthCookie,
  createAppAuthSessionToken,
  isAppAuthEnabled,
  isSameOriginRequest,
  readAppAuthSession,
  verifyAppAuthCredentials,
  withAppAuthCookie,
} from "./auth";
import { ServerConfig } from "./config";
import { decodeOtlpTraceRecords } from "./observability/TraceRecord.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";

function injectRuntimeHtmlConfig(input: {
  readonly appAuthEnabled: boolean;
  readonly authToken: string | undefined;
  readonly html: string;
}): string {
  const assignments = [`window.__T3_APP_AUTH_ENABLED=${input.appAuthEnabled ? "true" : "false"};`];
  if (input.authToken) {
    assignments.push(`window.__T3_WS_TOKEN=${JSON.stringify(input.authToken)};`);
  }

  const runtimeScript = `<script>${assignments.join("")}</script>`;
  const html = input.html;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${runtimeScript}</head>`);
  }
  if (html.includes("</body>")) {
    return html.replace("</body>", `${runtimeScript}</body>`);
  }
  return `${runtimeScript}${html}`;
}

function withNoStoreHeaders(headers?: Record<string, string>) {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    ...(headers ?? {}),
  };
}

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
          bodyJson,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Trace export failed.", { status: 502 })),
        ),
      );
  }),
).pipe(
  Layer.provide(
    HttpRouter.cors({
      allowedMethods: ["POST", "OPTIONS"],
      allowedHeaders: ["content-type"],
      maxAge: 600,
    }),
  ),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (isAppAuthEnabled(config) && readAppAuthSession(request, config) === null) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (isAppAuthEnabled(config) && readAppAuthSession(request, config) === null) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        },
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }),
);

export const appAuthStatusRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/session",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const session = readAppAuthSession(request, config);
    return yield* HttpServerResponse.json(
      {
        enabled: config.appAuthEnabled,
        authenticated: config.appAuthEnabled ? session !== null : true,
        username: session?.username ?? null,
        sessionTtlDays: config.appAuthEnabled ? config.appAuthSessionTtlDays : null,
      },
      {
        status: 200,
        headers: withNoStoreHeaders(),
      },
    );
  }),
);

export const appAuthLoginRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/login",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    if (!config.appAuthEnabled) {
      return yield* HttpServerResponse.json(
        { ok: true, authenticated: true, enabled: false },
        {
          status: 200,
          headers: withNoStoreHeaders(),
        },
      );
    }

    if (!isSameOriginRequest(request)) {
      return yield* HttpServerResponse.json(
        { ok: false, message: "Invalid login origin." },
        {
          status: 403,
          headers: withNoStoreHeaders(),
        },
      );
    }

    const body = (yield* request.json.pipe(Effect.catch(() => Effect.succeed(null)))) as
      | Record<string, unknown>
      | null;
    const username = typeof body?.["username"] === "string" ? body.username.trim() : "";
    const password = typeof body?.["password"] === "string" ? body.password : "";
    const remember = body?.["remember"] !== false;
    if (!username || !password) {
      return yield* HttpServerResponse.json(
        { ok: false, message: "Username and password are required." },
        {
          status: 400,
          headers: withNoStoreHeaders(),
        },
      );
    }

    if (!verifyAppAuthCredentials(config, username, password)) {
      return yield* HttpServerResponse.json(
        { ok: false, message: "Incorrect username or password." },
        {
          status: 401,
          headers: withNoStoreHeaders(),
        },
      );
    }

    const token = createAppAuthSessionToken(config, username);
    if (!token) {
      return yield* HttpServerResponse.json(
        { ok: false, message: "App authentication is not configured correctly." },
        {
          status: 500,
          headers: withNoStoreHeaders(),
        },
      );
    }

    const response = yield* HttpServerResponse.json(
        {
          ok: true,
          authenticated: true,
          enabled: true,
          username,
        },
        {
          status: 200,
          headers: withNoStoreHeaders(),
        },
    );
    return withAppAuthCookie(response, request, token, remember, config);
  }),
);

export const appAuthLogoutRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/logout",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const response = yield* HttpServerResponse.json(
      {
        ok: true,
        authenticated: false,
        enabled: config.appAuthEnabled,
      },
      {
        status: 200,
        headers: withNoStoreHeaders(),
      },
    );

    if (!config.appAuthEnabled) {
      return response;
    }

    return clearAppAuthCookie(response, request);
  }),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (config.devUrl) {
      return HttpServerResponse.redirect(config.devUrl.href, { status: 302 });
    }

    if (!config.staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(config.staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexData = yield* fileSystem
        .readFile(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexData) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      const indexHtml = new TextDecoder().decode(indexData);
      return HttpServerResponse.text(
        injectRuntimeHtmlConfig({
          html: indexHtml,
          appAuthEnabled: config.appAuthEnabled,
          authToken: config.appAuthEnabled ? undefined : config.authToken,
        }),
        {
          status: 200,
          contentType: "text/html; charset=utf-8",
        },
      );
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!data) {
      return HttpServerResponse.text("Internal Server Error", { status: 500 });
    }

    if (contentType.startsWith("text/html")) {
      const html = new TextDecoder().decode(data);
      return HttpServerResponse.text(
        injectRuntimeHtmlConfig({
          html,
          appAuthEnabled: config.appAuthEnabled,
          authToken: config.appAuthEnabled ? undefined : config.authToken,
        }),
        {
          status: 200,
          contentType,
        },
      );
    }

    return HttpServerResponse.uint8Array(data, {
      status: 200,
      contentType,
    });
  }),
);
