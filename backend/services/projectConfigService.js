const fs = require("fs");
const path = require("path");

const appConfig = require("../../config/default");
const logger = require("./logger");

const CONFIG_FILE = path.join(appConfig.rootDir, "config", "project-config.json");

let detectedJavaBase = null;

const DEFAULT_PROJECT = {
  appTitle: "",
  appId: "",
  groupId: "",
  aemVersion: "6.5.8",
  archetypeVersion: "56",
  frontendModule: "general",
  includeDispatcherConfig: "n",
  configured: false
};

let projectConfig = { ...DEFAULT_PROJECT };

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf8");
      const saved = JSON.parse(raw);
      projectConfig = { ...DEFAULT_PROJECT, ...saved };
      updateProjectDir();
    }
  } catch (error) {
    logger.warn("Failed to load project config, using defaults", {
      error: error.message
    });
  }

  return projectConfig;
}

function save(config) {
  projectConfig = { ...DEFAULT_PROJECT, ...config, configured: true };
  detectedJavaBase = null;

  const dir = path.dirname(CONFIG_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(projectConfig, null, 2), "utf8");

  updateProjectDir();

  logger.info("Project config saved", {
    appId: projectConfig.appId,
    groupId: projectConfig.groupId,
    projectDir: appConfig.repo.projectDir
  });

  return projectConfig;
}

function get() {
  return projectConfig;
}

function isConfigured() {
  return !!(projectConfig.configured && projectConfig.appId && projectConfig.groupId);
}

function getProjectDir() {
  if (projectConfig.appId) {
    return path.join(appConfig.repo.projectsDir, projectConfig.appId);
  }
  return appConfig.repo.projectsDir;
}

function updateProjectDir() {
  if (projectConfig.appId) {
    appConfig.repo.projectDir = path.join(appConfig.repo.projectsDir, projectConfig.appId);
  }
}

function detectJavaBase() {
  if (detectedJavaBase) return detectedJavaBase;

  const projectDir = getProjectDir();
  const javaSrcRoot = path.join(projectDir, "core", "src", "main", "java");

  if (!fs.existsSync(javaSrcRoot)) {
    logger.warn("Java source root not found, falling back to groupId-based paths", { javaSrcRoot });
    return null;
  }

  // Walk down from core/src/main/java to find a directory containing "core/models"
  function findPackageRoot(dir, depth) {
    if (depth > 6) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "." || entry.name === "..") continue;
      const child = path.join(dir, entry.name);
      // Check if this directory has a "core" subfolder (the Java package "core" segment)
      const coreDir = path.join(child, "core");
      if (fs.existsSync(coreDir) && fs.statSync(coreDir).isDirectory()) {
        const relativeToCoreJava = path.relative(javaSrcRoot, child);
        const javaPackage = relativeToCoreJava.replace(/\//g, ".") + ".core";
        detectedJavaBase = {
          packagePath: relativeToCoreJava + "/core",
          javaPackage
        };
        logger.info("Auto-detected Java package from project", detectedJavaBase);
        return detectedJavaBase;
      }
      const deeper = findPackageRoot(child, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  }

  return findPackageRoot(javaSrcRoot, 0);
}

function getJavaBasePath() {
  const detected = detectJavaBase();
  if (detected) return detected.packagePath;
  const groupPath = projectConfig.groupId.replace(/\./g, "/");
  return `${groupPath}/core`;
}

function getComponentsPath() {
  return `ui.apps/src/main/content/jcr_root/apps/${projectConfig.appId}/components`;
}

function getModelsPath() {
  return `core/src/main/java/${getJavaBasePath()}/models`;
}

function getServletsPath() {
  return `core/src/main/java/${getJavaBasePath()}/servlets`;
}

function getServicesPath() {
  return `core/src/main/java/${getJavaBasePath()}/services`;
}

function getFiltersPath() {
  return `core/src/main/java/${getJavaBasePath()}/filters`;
}

function getJavaPackage() {
  const detected = detectJavaBase();
  if (detected) return detected.javaPackage;
  return `${projectConfig.groupId}.core`;
}

function getComponentGroup() {
  return `${projectConfig.appTitle} - Content`;
}

function buildArchetypeCommand(config) {
  const args = [
    "mvn -B org.apache.maven.plugins:maven-archetype-plugin:3.3.1:generate",
    `-DarchetypeGroupId=com.adobe.aem`,
    `-DarchetypeArtifactId=aem-project-archetype`,
    `-DarchetypeVersion=${config.archetypeVersion || "56"}`,
    `-DappTitle="${config.appTitle}"`,
    `-DappId="${config.appId}"`,
    `-DgroupId="${config.groupId}"`,
    `-DaemVersion="${config.aemVersion || "6.5.8"}"`,
    `-DfrontendModule="${config.frontendModule || "general"}"`,
    `-DincludeDispatcherConfig="${config.includeDispatcherConfig || "n"}"`
  ];

  return args.join(" \\\n  ");
}

load();

module.exports = {
  load,
  save,
  get,
  isConfigured,
  getProjectDir,
  getComponentsPath,
  getModelsPath,
  getServletsPath,
  getServicesPath,
  getFiltersPath,
  getJavaPackage,
  getComponentGroup,
  buildArchetypeCommand
};
