const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const appConfig = require("../config/default");
const trainRoutes = require("./routes/trainRoutes");
const askRoutes = require("./routes/askRoutes");
const executeRoutes = require("./routes/executeRoutes");
const explorerRoutes = require("./routes/explorerRoutes");
const setupRoutes = require("./routes/setupRoutes");
const projectConfigService = require("./services/projectConfigService");
const repoIndexService = require("./services/repoIndexService");
const logger = require("./services/logger");

const app = express();

app.use(
  cors({
    origin: appConfig.server.clientOrigin
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/health", async (_req, res) => {
  const indexSummary = repoIndexService.getIndexSummary();
  res.json({
    status: "ok",
    indexedFiles: indexSummary.fileCount,
    indexedProjectDir: indexSummary.projectDir
  });
});

app.use("/train", trainRoutes);
app.use("/ask", askRoutes);
app.use("/execute", executeRoutes);
app.use("/explorer", explorerRoutes);
app.use("/setup", setupRoutes);

app.use((err, _req, res, _next) => {
  logger.error("Unhandled request error", err);
  res.status(err.statusCode || 500).json({
    error: err.message || "Internal server error"
  });
});

async function startServer() {
  try {
    if (projectConfigService.isConfigured()) {
      await repoIndexService.buildIndex();
    } else {
      logger.info("Project not configured yet — skipping repo indexing");
    }
  } catch (error) {
    logger.warn(
      `Repo indexing skipped during startup: ${error.message}`
    );
  }

  app.listen(appConfig.server.port, () => {
    logger.info(
      `AEM AI Trainer backend listening on port ${appConfig.server.port}`
    );
  });
}

startServer();
