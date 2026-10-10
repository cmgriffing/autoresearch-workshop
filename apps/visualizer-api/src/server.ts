import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import {
  ApiErrorSchema,
  DiffResponseSchema,
  LiveEventSchema,
  RefreshResponseSchema,
} from "visualizar-common";
import type { GitDiffOptions } from "./git-diff.ts";
import { createDiffService } from "./git-diff.ts";
import { createRegistry } from "./registry.ts";
import type { RegistryOptions } from "./registry.ts";

export const SSE_HEARTBEAT_MS = 5_000;
export const MAX_SSE_CLIENTS = 32;
export const MAX_SSE_EVENT_BYTES = 64 * 1024;

export function validateUiOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.origin !== value
  )
    throw new Error(
      "UI origin must be an exact loopback HTTP origin, e.g. http://127.0.0.1:5173.",
    );
  return url.origin;
}
export async function createApp(options: {
  configPath: string;
  apiOrigin: string;
  uiOrigin: string;
  staticRoot?: string;
  gitDiffOptions?: GitDiffOptions;
  registryOptions?: RegistryOptions;
}) {
  const registry = await createRegistry(
    options.configPath,
    options.registryOptions,
  );
  const diffs = createDiffService(options.gitDiffOptions);
  const uiOrigin = validateUiOrigin(options.uiOrigin);
  const authority = new URL(options.apiOrigin).host;
  const app = Fastify({ logger: false });
  const closeStreams = new Set<() => void>();
  app.addHook("onListen", async () => registry.startMonitoring());
  app.addHook("onClose", async () => {
    for (const close of [...closeStreams]) close();
    await registry.close();
    diffs.cache.clear();
  });
  const error = (code: string, message: string) =>
    ApiErrorSchema.parse({ error: { code, message } });
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.host !== authority)
      return reply
        .code(403)
        .send(error("HOST_FORBIDDEN", "Use the configured local API address."));
    if (
      (request.headers.origin && request.headers.origin !== uiOrigin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      return reply
        .code(403)
        .send(error("ORIGIN_FORBIDDEN", "Use the configured local UI origin."));
    reply.header("X-Content-Type-Options", "nosniff");
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
  });
  app.get("/api/projects", async () => registry.list);
  app.get("/api/events", async (request, reply) => {
    if (closeStreams.size >= MAX_SSE_CLIENTS)
      return reply
        .code(503)
        .send(
          error("SSE_CAPACITY", "Too many live-update clients are connected."),
        );
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    response.flushHeaders();
    let active = true;
    let unsubscribe = () => {};
    let heartbeat: NodeJS.Timeout | undefined;
    const close = () => {
      if (!active) return;
      active = false;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      closeStreams.delete(close);
      if (!response.destroyed) response.end();
    };
    const send = (value: unknown) => {
      if (!active || response.destroyed) return;
      const event = `data: ${JSON.stringify(LiveEventSchema.parse(value))}\n\n`;
      if (
        Buffer.byteLength(event) > MAX_SSE_EVENT_BYTES ||
        !response.write(event)
      )
        close();
    };
    unsubscribe = registry.subscribe(send);
    closeStreams.add(close);
    request.raw.once("close", close);
    heartbeat = setInterval(() => {
      send({
        type: "heartbeat",
        indexRevision: registry.list.indexRevision,
      });
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref();
    send({
      type: "connected",
      indexRevision: registry.list.indexRevision,
    });
  });
  app.post("/api/refresh", async (request, reply) => {
    if (request.headers.origin !== uiOrigin)
      return reply
        .code(403)
        .send(
          error(
            "ORIGIN_FORBIDDEN",
            "Refresh requires the configured local UI origin.",
          ),
        );
    if (request.body != null || Object.keys(request.query as object).length)
      return reply
        .code(400)
        .send(
          error(
            "BAD_REFRESH_REQUEST",
            "Refresh does not accept paths, a request body, or query parameters.",
          ),
        );
    return RefreshResponseSchema.parse(await registry.refresh());
  });
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request, reply) => {
      const snapshot = registry.projects.get(request.params.projectId);
      if (!snapshot)
        return reply
          .code(404)
          .send(
            error(
              "PROJECT_NOT_FOUND",
              "That project ID is not in the configured registry.",
            ),
          );
      return snapshot;
    },
  );
  app.get<{
    Params: { projectId: string; runId: string };
    Querystring: {
      revision?: string;
      comparison?: string;
      includeAuto?: string;
    };
  }>("/api/projects/:projectId/runs/:runId/diff", async (request, reply) => {
    const snapshot = registry.projects.get(request.params.projectId);
    if (!snapshot)
      return reply
        .code(404)
        .send(
          error(
            "PROJECT_NOT_FOUND",
            "That project ID is not in the configured registry.",
          ),
        );
    const run = snapshot.runs.find(
      (candidate) => candidate.id === request.params.runId,
    );
    if (!run)
      return reply
        .code(404)
        .send(
          error(
            "RUN_NOT_FOUND",
            "That run ID is not in the selected project snapshot.",
          ),
        );
    if (!request.query.revision)
      return reply
        .code(400)
        .send(
          error(
            "REVISION_REQUIRED",
            "Diff requests must include the project source revision.",
          ),
        );
    if (request.query.revision !== snapshot.project.revision)
      return reply
        .code(409)
        .send(
          error(
            "STALE_REVISION",
            "The project source changed; refresh the snapshot before requesting its diff.",
          ),
        );
    const comparison = request.query.comparison ?? "parent";
    const includeAuto = request.query.includeAuto ?? "false";
    if (
      !["parent", "baseline"].includes(comparison) ||
      !["true", "false"].includes(includeAuto) ||
      Object.keys(request.query).some(
        (key) => !["revision", "comparison", "includeAuto"].includes(key),
      )
    )
      return reply
        .code(400)
        .send(
          error(
            "BAD_DIFF_REQUEST",
            "Use comparison=parent|baseline and includeAuto=true|false; paths and arbitrary revisions are not accepted.",
          ),
        );
    const projectPath = registry.projectPaths.get(request.params.projectId);
    if (!projectPath)
      return DiffResponseSchema.parse({
        state: "failure",
        comparison: comparison as "parent" | "baseline",
        includeAuto: includeAuto === "true",
        message: "The project path is no longer available.",
      });
    const baselineId = snapshot.segments.find(
      (segment) => segment.id === run.segmentId,
    )?.baselineRunId;
    const value = await diffs.resolve(projectPath, run, {
      comparison: comparison as "parent" | "baseline",
      includeAuto: includeAuto === "true",
      revision: snapshot.project.revision,
      baseline:
        snapshot.runs.find((candidate) => candidate.id === baselineId) ?? null,
    });
    // A manual/live refresh may have installed another source while Git was running.
    if (
      registry.projects.get(request.params.projectId)?.project.revision !==
      snapshot.project.revision
    )
      return reply
        .code(409)
        .send(
          error(
            "STALE_REVISION",
            "The project source changed during comparison; refresh the snapshot before retrying.",
          ),
        );
    return DiffResponseSchema.parse(value);
  });
  if (options.staticRoot)
    await app.register(fastifyStatic, {
      root: options.staticRoot,
      index: ["index.html"],
    });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(error("NOT_FOUND", "This route does not exist.")),
  );
  app.setErrorHandler((cause, _request, reply) => {
    const status =
      cause instanceof Error &&
      "statusCode" in cause &&
      typeof cause.statusCode === "number" &&
      cause.statusCode >= 400 &&
      cause.statusCode < 500
        ? cause.statusCode
        : 500;
    reply
      .code(status)
      .send(
        error(
          status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
          status === 500
            ? "The local API could not complete this request."
            : cause instanceof Error
              ? cause.message
              : "Invalid request.",
        ),
      );
  });
  return app;
}
