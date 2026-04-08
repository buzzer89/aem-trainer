const aiService = require("../services/aiService");
const fileWriterService = require("../services/fileWriterService");
const logger = require("../services/logger");

const BUILD_KEYWORDS = [
  "create",
  "build",
  "scaffold",
  "generate",
  "make",
  "add a component",
  "add component",
  "new component"
];

function isBuildRequest(message) {
  const lower = message.toLowerCase();
  return BUILD_KEYWORDS.some((keyword) => lower.includes(keyword));
}

async function handleTrainingRequest({ message, topic }) {
  if (isBuildRequest(message)) {
    return handleBuildRequest({ message, topic });
  }

  const agentContext = aiService.getTrainerContext();

  const system = [
    aiService.getAemPromptPreamble(
      "Teach the trainee with practical, production-ready AEM guidance."
    ),
    "Follow the training pipeline and conventions described below.",
    "",
    "--- AGENT CONTEXT ---",
    agentContext,
    "--- END AGENT CONTEXT ---",
    "",
    "Teach the learner clearly and practically.",
    "Always include:",
    "1. A concise explanation",
    "2. Step-by-step guidance",
    "3. A short hands-on lab",
    "4. A review checklist"
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    topic ? `Focus topic: ${topic}` : null,
    aiService.toDataBlock("learner_question", message, 1500)
  ]
    .filter(Boolean)
    .join("\n");

  const answer = await aiService.askAI({ system, user }, {
    mode: "trainer",
    fallbackContext: { topic, message }
  });

  return { answer };
}

async function handleBuildRequest({ message, topic }) {
  const prompt = aiService.buildComponentPrompt({ message, topic });
  const result = await aiService.askAIForComponentFiles(prompt);

  if (result.needsClarification) {
    return {
      answer: result.question
    };
  }

  const { taskId, results: fileResults } = fileWriterService.writeFiles(result.files, message);

  const createdFiles = fileResults.filter((f) => f.success);
  const failedFiles = fileResults.filter((f) => !f.success);

  logger.info("Component build completed", {
    created: createdFiles.length,
    failed: failedFiles.length
  });

  let answer = result.explanation;

  if (createdFiles.length > 0) {
    answer +=
      "\n\n### Created Files\n" +
      createdFiles.map((f) => `- \`${f.path}\``).join("\n");
  }

  if (failedFiles.length > 0) {
    answer +=
      "\n\n### Failed Files\n" +
      failedFiles.map((f) => `- \`${f.path}\`: ${f.error}`).join("\n");
  }

  return {
    answer,
    taskId,
    filesCreated: createdFiles.map((f) => f.path),
    filesFailed: failedFiles.map((f) => ({ path: f.path, error: f.error }))
  };
}

module.exports = {
  handleTrainingRequest
};
