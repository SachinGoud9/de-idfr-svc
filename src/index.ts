import { existsSync } from "node:fs";
import { createApp } from "./server/app";
import { DeidentificationService } from "./service/service";
import { createDefaultRegistry } from "./service/rules";
import { loadConfigFile } from "./config";
import { createLogger } from "./logger";
import { loadSettings } from "./settings";
import { createTokenVerifier } from "./server/oauth";

export { DeidentificationService, ValidationError } from "./service/service";
export { RuleRegistry } from "./service/registry";
export { createDefaultRegistry } from "./service/rules";
export { createApp } from "./server/app";

function main() {
  // Pick up a local .env file when the running Node supports it (20.12+).
  if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");

  const logger = createLogger({ format: "text" });
  let settings;
  try {
    settings = loadSettings();
  } catch (e) {
    logger.error(`Invalid configuration: ${(e as Error).message}`);
    process.exit(1);
  }
  const log = createLogger({ format: settings.logFormat });

  const registry = createDefaultRegistry();
  if (settings.customRulesFile) {
    try {
      loadConfigFile(registry, settings.customRulesFile);
    } catch (e) {
      log.error(`Could not load custom rules from ${settings.customRulesFile}: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  const app = createApp(new DeidentificationService(registry), {
    logger: settings.logRequests ? log : undefined,
    bodyLimit: settings.bodyLimit,
    rateLimit: settings.rateLimitMax
      ? { max: settings.rateLimitMax, windowMs: settings.rateLimitWindowMs }
      : undefined,
    apiKeys: settings.apiKeys,
    tokenVerifier: settings.oauth ? createTokenVerifier(settings.oauth) : undefined,
    trustProxy: settings.trustProxy,
  });

  const server = app.listen(settings.port, () => {
    log.info("Started De-identification service");
    log.info(`Service listening on http://localhost:${settings.port}`, {
      auth:
        [settings.apiKeys.length ? "api-key" : "", settings.oauth ? "oauth" : ""].filter(Boolean).join("+") ||
        "open",
      rateLimit: settings.rateLimitMax || "off",
    });
  });

  // Finish in-flight requests before exiting, but don't hang forever if one is stuck.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => {
      log.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", { message: String(reason) });
  });
}

if (require.main === module) main();
