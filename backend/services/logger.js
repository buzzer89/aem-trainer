const fs = require("fs");
const path = require("path");

const logsDir = path.resolve(__dirname, "..", "logs");
const logFile = path.join(logsDir, "app.log");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function write(level, message, details) {
  const timestamp = new Date().toISOString();
  const payload = [
    `[${timestamp}]`,
    `[${level.toUpperCase()}]`,
    message,
    details ? JSON.stringify(details) : ""
  ]
    .filter(Boolean)
    .join(" ");

  fs.appendFileSync(logFile, `${payload}\n`);
  console[level === "error" ? "error" : "log"](payload);
}

module.exports = {
  info(message, details) {
    write("info", message, details);
  },
  warn(message, details) {
    write("warn", message, details);
  },
  error(message, details) {
    write("error", message, details);
  }
};
