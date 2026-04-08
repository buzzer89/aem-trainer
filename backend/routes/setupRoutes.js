const express = require("express");
const { exec } = require("child_process");
const util = require("util");
const path = require("path");
const fs = require("fs");

const appConfig = require("../../config/default");
const projectConfigService = require("../services/projectConfigService");
const repoIndexService = require("../services/repoIndexService");
const logger = require("../services/logger");

const execAsync = util.promisify(exec);

const router = express.Router();

router.get("/config", (_req, res) => {
  res.json({
    config: projectConfigService.get(),
    configured: projectConfigService.isConfigured()
  });
});

router.post("/config", (req, res) => {
  const { appTitle, appId, groupId, aemVersion, archetypeVersion, frontendModule, includeDispatcherConfig } = req.body;

  if (!appTitle || !appId || !groupId) {
    return res.status(400).json({
      error: "appTitle, appId, and groupId are required"
    });
  }

  if (!/^[a-z][a-z0-9]*$/.test(appId)) {
    return res.status(400).json({
      error: "appId must be lowercase alphanumeric starting with a letter"
    });
  }

  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/.test(groupId)) {
    return res.status(400).json({
      error: "groupId must be a valid Java package name (e.g., com.mycompany)"
    });
  }

  const config = projectConfigService.save({
    appTitle,
    appId,
    groupId,
    aemVersion: aemVersion || "6.5.8",
    archetypeVersion: archetypeVersion || "56",
    frontendModule: frontendModule || "general",
    includeDispatcherConfig: includeDispatcherConfig || "n"
  });

  res.json({ config, configured: true });
});

router.post("/generate", async (req, res) => {
  const config = projectConfigService.get();

  if (!config.appId || !config.groupId || !config.appTitle) {
    return res.status(400).json({
      error: "Project must be configured first. POST to /setup/config first."
    });
  }

  const targetDir = path.resolve(appConfig.repo.projectsDir);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const expectedDir = path.join(targetDir, config.appId);
  if (fs.existsSync(expectedDir)) {
    return res.status(409).json({
      error: `Project directory already exists: ${expectedDir}. Remove it first or use a different appId.`
    });
  }

  const command = projectConfigService.buildArchetypeCommand(config);

  logger.info("Generating AEM project from archetype", {
    command,
    cwd: targetDir
  });

  res.json({
    status: "generating",
    message: "AEM archetype generation started. This may take a few minutes.",
    command,
    targetDir
  });
});

router.post("/generate/run", async (req, res) => {
  const config = projectConfigService.get();

  if (!config.appId || !config.groupId || !config.appTitle) {
    return res.status(400).json({
      error: "Project must be configured first."
    });
  }

  const targetDir = path.resolve(appConfig.repo.projectsDir);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const command = projectConfigService.buildArchetypeCommand(config);

  try {
    logger.info("Running AEM archetype generation", { cwd: targetDir });

    const { stdout, stderr } = await execAsync(command, {
      cwd: targetDir,
      timeout: 1000 * 60 * 10,
      maxBuffer: 1024 * 1024 * 5,
      env: {
        ...process.env,
        ...(process.env.JAVA_HOME ? { JAVA_HOME: process.env.JAVA_HOME } : {}),
        PATH: process.env.JAVA_HOME
          ? `${process.env.JAVA_HOME}/bin:${process.env.PATH}`
          : process.env.PATH
      }
    });

    const generatedDir = path.join(targetDir, config.appId);
    const exists = fs.existsSync(generatedDir);

    if (exists) {
      appConfig.repo.projectDir = generatedDir;

      try {
        await repoIndexService.buildIndex();
      } catch (indexError) {
        logger.warn("Post-generation indexing failed", {
          error: indexError.message
        });
      }
    }

    logger.info("AEM archetype generation completed", {
      generatedDir,
      exists
    });

    res.json({
      success: true,
      generatedDir,
      exists,
      stdout: stdout.slice(-2000),
      stderr: stderr?.slice(-1000) || ""
    });
  } catch (error) {
    logger.error("AEM archetype generation failed", {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: error.message,
      stdout: error.stdout?.slice(-2000) || "",
      stderr: error.stderr?.slice(-1000) || ""
    });
  }
});

router.get("/preview-command", (_req, res) => {
  const config = projectConfigService.get();

  if (!config.appId) {
    return res.status(400).json({ error: "Project not configured yet" });
  }

  res.json({
    command: projectConfigService.buildArchetypeCommand(config)
  });
});

module.exports = router;
