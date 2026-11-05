export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  format?: "text" | "json";
  // Where lines go. Defaults to stdout for info/warn and stderr for errors.
  write?: (level: LogLevel, line: string) => void;
}

const defaultWrite = (level: LogLevel, line: string) =>
  level === "error" ? console.error(line) : console.log(line);

// Tiny structured logger. Callers only ever pass metadata (ids, paths, status codes),
// never request or response bodies, because those contain the PII we are removing.
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? defaultWrite;
  const json = options.format === "json";

  const emit = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    const time = new Date().toISOString();
    if (json) {
      write(level, JSON.stringify({ time, level, msg, ...fields }));
      return;
    }
    const extra = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    write(level, `${time} ${level.toUpperCase()} ${msg}${extra ? " " + extra : ""}`);
  };

  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
