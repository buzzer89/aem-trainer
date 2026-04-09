const aiService = require("../services/aiService");
const fileWriterService = require("../services/fileWriterService");
const logger = require("../services/logger");

const BUILD_KEYWORDS = [
  "create",
  "build",
  "scaffold",
  "generate",
  "make",
  "update",
  "modify",
  "enhance",
  "refactor",
  "fix",
  "add a component",
  "add component",
  "new component"
];

function isBuildRequest(message) {
  const lower = message.toLowerCase();
  return BUILD_KEYWORDS.some((keyword) => lower.includes(keyword))
    || /(update|modify|enhance|refactor|fix)\s+.*component/i.test(message)
    || /component\s+.*(update|modify|enhance|refactor|fix)/i.test(message);
}

async function handleTrainingRequest({ message, topic }) {
  if (isBuildRequest(message)) {
    return handleBuildRequest({ message, topic });
  }

  const agentContext = aiService.getTrainerContext();

  const system = [
    aiService.getAemPromptPreamble(
      "You are an AEM architect and expert trainer. Teach the trainee with practical, production-ready AEM guidance for ALL types of AEM development tasks, not just components. This includes servlets, OSGi services, schedulers, workflows, event listeners, filters, utilities, backend integrations, permissions, dispatcher configs, content modeling, and more. Always provide architectural context, rationale, and best practices."
    ),
    "Follow the training pipeline and conventions described below.",
    "",
    "--- AGENT CONTEXT ---",
    agentContext,
    "--- END AGENT CONTEXT ---",
    "",
    "Teach the learner clearly, practically, and as an AEM architect would mentor a junior developer.",
    "Always include:",
    "1. A concise explanation of the requested topic or feature, including its role in AEM architecture (e.g., OSGi, dispatcher, permissions, content model, etc.)",
    "2. Step-by-step guidance with rationale for each step (explain WHY, not just HOW)",
    "3. A short hands-on lab or exercise",
    "4. A review checklist",
    "5. Common pitfalls, anti-patterns, and how to avoid them",
    "6. Best practices and references to Adobe official documentation",
    "7. A section: 'Why this matters in enterprise AEM projects' (explain impact on scalability, maintainability, security, etc.)",
    "8. Use diagrams or visual explanations where helpful (Mermaid syntax if possible)",
    "9. If the request is for a servlet, service, scheduler, workflow, listener, or any non-component feature, generate the correct AEM artifact and do NOT create a component unless explicitly requested."
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
  const { system, user, artifactType } = aiService.buildFeaturePrompt({ message, topic });
  const result = await aiService.askAIForFeatureFiles({ system, user }, artifactType);

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
