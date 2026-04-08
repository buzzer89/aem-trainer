const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

function resolveFromRoot(targetPath, fallbackPath) {
  const resolvedPath = targetPath || fallbackPath;
  return path.isAbsolute(resolvedPath)
    ? resolvedPath
    : path.resolve(ROOT_DIR, resolvedPath);
}

module.exports = {
  rootDir: ROOT_DIR,
  server: {
    port: Number(process.env.PORT) || 4000,
    clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173"
  },
  ai: {
    mode: process.env.AI_MODE || "mock",
    claudeCommand: process.env.CLAUDE_COMMAND || "claude",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4"
  },
  repo: {
    projectsDir: resolveFromRoot(process.env.AEM_PROJECTS_DIR, ROOT_DIR),
    projectDir: resolveFromRoot(process.env.AEM_PROJECTS_DIR, ROOT_DIR),
    indexOutputPath: path.join(ROOT_DIR, "config", "repo-index.json"),
    maxFileSizeBytes: 1024 * 200,
    ignoredFiles: [".DS_Store"],
    ignoredDirectories: [
      ".git",
      "node_modules",
      "node",
      "dist",
      "build",
      "target",
      "coverage",
      ".cache"
    ]
  },
  commands: {
    logPath: resolveFromRoot(
      process.env.AEM_LOG_PATH,
      "/Users/pradeep/aem/author/crx-quickstart/logs/error.log"
    ),
    allowedExecutables: ["mvn", "curl", "tail", "ls"],
    presets: {
      build: "mvn clean install",
      deploy: "mvn clean install -PautoInstallPackage",
      logs: "tail -n 200 /Users/pradeep/aem/author/crx-quickstart/logs/error.log",
      packages: "ls -la"
    }
  },
  logging: {
    level: process.env.LOG_LEVEL || "info"
  }
};
