import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const transport = isDev
  ? { target: "pino/file", options: { destination: 1 } }
  : undefined;

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }
    : {
        formatters: {
          level(label) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

export type Logger = typeof logger;

/** Create a child logger with persistent context (e.g. requestId, module). */
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

export { logger };
