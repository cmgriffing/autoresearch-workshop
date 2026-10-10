import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createApp } from "./server.ts";

try {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      port: { type: "string", default: "4310" },
      "ui-origin": { type: "string" },
      dev: { type: "boolean", default: false },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("--port must be an integer between 1 and 65535.");
  const apiOrigin = `http://127.0.0.1:${port}`;
  const app = await createApp({
    configPath:
      values.config ??
      process.env.VISUALIZER_CONFIG ??
      fileURLToPath(new URL("../config.example.json", import.meta.url)),
    apiOrigin,
    uiOrigin:
      values["ui-origin"] ?? (values.dev ? "http://127.0.0.1:5173" : apiOrigin),
    ...(!values.dev
      ? {
          staticRoot: fileURLToPath(
            new URL("../../visualizer/dist/", import.meta.url),
          ),
        }
      : {}),
  });
  await app.listen({ host: "127.0.0.1", port });
  console.log(`Visualizer ${values.dev ? "API" : "app"}: ${apiOrigin}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
