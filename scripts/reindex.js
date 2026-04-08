const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function run() {
  loadEnvFile();
  const repoIndexService = require("../backend/services/repoIndexService");
  const result = await repoIndexService.buildIndex();
  console.log(
    `Indexed ${result.fileCount} files from ${result.projectDir}. Snapshot saved to ${result.indexOutputPath}.`
  );
}

run().catch((error) => {
  console.error("Failed to build repo index:", error.message);
  process.exit(1);
});
