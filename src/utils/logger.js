import pino from "pino";
import PinoPretty from "pino-pretty";

// Use pino-pretty as a direct stream destination instead of a worker-thread
// transport so it works inside compiled Bun binaries. Pretty-print only when
// attached to a TTY (development); systemd/production gets plain JSON.
const dest = process.stdout.isTTY
  ? PinoPretty({ colorize: true, translateTime: "SYS:HH:MM:ss" })
  : undefined;

const logger = pino({ level: process.env.LOG_LEVEL || "info" }, dest);

export default logger;
