const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const appConfig = require("../../config/default");
const logger = require("./logger");

const ALLOWED_EXTENSIONS = [
  ".xml",
  ".html",
  ".java",
  ".js",
  ".ts",
  ".scss",
  ".css",
  ".json",
  ".txt",
  ".cfg",
  ".config"
];

const taskHistory = [];

function isPathSafe(filePath) {
  const projectDir = path.resolve(appConfig.repo.projectDir);
  const resolved = path.resolve(projectDir, filePath);

  if (!resolved.startsWith(projectDir + path.sep)) {
    return false;
  }

  if (resolved.includes("..")) {
    return false;
  }

  return true;
}

function isExtensionAllowed(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

function writeFiles(files, taskLabel) {
  const projectDir = path.resolve(appConfig.repo.projectDir);
  const taskId = crypto.randomUUID();
  const results = [];
  const createdPaths = [];

  for (const file of files) {
    const relativePath = file.path;
    const fullPath = path.resolve(projectDir, relativePath);

    if (!isPathSafe(relativePath)) {
      results.push({
        path: relativePath,
        success: false,
        error: "Path is outside the AEM project directory"
      });
      continue;
    }

    if (!isExtensionAllowed(relativePath)) {
      results.push({
        path: relativePath,
        success: false,
        error: `File extension not allowed: ${path.extname(relativePath)}`
      });
      continue;
    }

    try {
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, file.content, "utf8");
      logger.info("File created", { taskId, path: relativePath, fullPath });
      results.push({ path: relativePath, success: true });
      createdPaths.push(relativePath);
    } catch (error) {
      logger.error("Failed to write file", {
        path: relativePath,
        error: error.message
      });
      results.push({
        path: relativePath,
        success: false,
        error: error.message
      });
    }
  }

  if (createdPaths.length > 0) {
    taskHistory.push({
      taskId,
      label: taskLabel || "Component build",
      createdAt: new Date().toISOString(),
      files: createdPaths,
      reverted: false
    });
  }

  return { taskId, results };
}

function revertTask(taskId) {
  const task = taskHistory.find((t) => t.taskId === taskId && !t.reverted);

  if (!task) {
    return null;
  }

  const projectDir = path.resolve(appConfig.repo.projectDir);
  const revertResults = [];

  for (const relativePath of task.files) {
    const fullPath = path.resolve(projectDir, relativePath);

    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        logger.info("File reverted (deleted)", { taskId, path: relativePath });

        let dir = path.dirname(fullPath);
        while (dir !== projectDir && dir.startsWith(projectDir)) {
          const entries = fs.readdirSync(dir);
          if (entries.length === 0) {
            fs.rmdirSync(dir);
            logger.info("Empty directory removed", { dir });
          } else {
            break;
          }
          dir = path.dirname(dir);
        }

        revertResults.push({ path: relativePath, success: true });
      } else {
        revertResults.push({ path: relativePath, success: true, note: "Already deleted" });
      }
    } catch (error) {
      logger.error("Failed to revert file", {
        path: relativePath,
        error: error.message
      });
      revertResults.push({ path: relativePath, success: false, error: error.message });
    }
  }

  task.reverted = true;
  task.revertedAt = new Date().toISOString();

  return {
    taskId,
    label: task.label,
    results: revertResults
  };
}

function getTaskHistory() {
  return taskHistory.map((task) => ({
    taskId: task.taskId,
    label: task.label,
    createdAt: task.createdAt,
    files: task.files,
    reverted: task.reverted,
    revertedAt: task.revertedAt || null
  }));
}

module.exports = {
  writeFiles,
  revertTask,
  getTaskHistory
};
