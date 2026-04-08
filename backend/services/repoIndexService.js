const fs = require("fs");
const path = require("path");

const appConfig = require("../../config/default");
const logger = require("./logger");

let repoDocuments = [];
let lastIndexedAt = null;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldIgnore(name) {
  return (
    appConfig.repo.ignoredDirectories.includes(name) ||
    appConfig.repo.ignoredFiles.includes(name)
  );
}

function walkDirectory(directory, collectedFiles = []) {
  if (!fs.existsSync(directory)) {
    return collectedFiles;
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!shouldIgnore(entry.name)) {
        walkDirectory(fullPath, collectedFiles);
      }
      continue;
    }

    const stats = fs.statSync(fullPath);
    if (
      stats.size <= appConfig.repo.maxFileSizeBytes &&
      !shouldIgnore(entry.name)
    ) {
      collectedFiles.push(fullPath);
    }
  }

  return collectedFiles;
}

function scoreDocument(query, content) {
  const tokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);

  return tokens.reduce((score, token) => {
    if (!token) {
      return score;
    }

    const matches = content
      .toLowerCase()
      .match(new RegExp(escapeRegExp(token), "g"));
    return score + (matches ? matches.length : 0);
  }, 0);
}

function createSnippet(content, query) {
  const lowerContent = content.toLowerCase();
  const token = query
    .toLowerCase()
    .split(/\W+/)
    .find(Boolean);

  if (!token) {
    return content.slice(0, 500);
  }

  const startIndex = Math.max(lowerContent.indexOf(token) - 140, 0);
  return content.slice(startIndex, startIndex + 500);
}

async function buildIndex() {
  const projectDir = path.resolve(appConfig.repo.projectDir);

  if (!fs.existsSync(projectDir)) {
    throw new Error(`AEM project directory does not exist: ${projectDir}`);
  }

  const files = walkDirectory(projectDir, []);
  repoDocuments = files
    .map((filePath) => {
      try {
        const content = fs.readFileSync(filePath, "utf8");

        if (content.includes("\u0000")) {
          return null;
        }

        return {
          path: path.relative(projectDir, filePath),
          absolutePath: filePath,
          content
        };
      } catch (error) {
        logger.warn("Skipping unreadable file during indexing", {
          filePath,
          error: error.message
        });
        return null;
      }
    })
    .filter(Boolean);

  lastIndexedAt = new Date().toISOString();

  const snapshot = {
    projectDir,
    fileCount: repoDocuments.length,
    lastIndexedAt,
    files: repoDocuments.map((document) => ({
      path: document.path,
      preview: document.content.slice(0, 250)
    }))
  };

  fs.writeFileSync(
    appConfig.repo.indexOutputPath,
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );

  logger.info("Repository index built", {
    projectDir,
    fileCount: repoDocuments.length
  });

  return {
    projectDir,
    fileCount: repoDocuments.length,
    indexOutputPath: appConfig.repo.indexOutputPath
  };
}

async function ensureIndex() {
  if (repoDocuments.length > 0) {
    return getIndexSummary();
  }

  try {
    return await buildIndex();
  } catch (error) {
    logger.warn("Unable to ensure repository index", {
      error: error.message
    });

    return getIndexSummary();
  }
}

function searchIndex(query, limit = 5) {
  if (!query || !repoDocuments.length) {
    return [];
  }

  return repoDocuments
    .map((document) => ({
      path: document.path,
      score: scoreDocument(query, document.content),
      snippet: createSnippet(document.content, query)
    }))
    .filter((document) => document.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function getIndexSummary() {
  return {
    projectDir: path.resolve(appConfig.repo.projectDir),
    fileCount: repoDocuments.length,
    lastIndexedAt
  };
}

module.exports = {
  buildIndex,
  ensureIndex,
  searchIndex,
  getIndexSummary
};
