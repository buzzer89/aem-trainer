const aiService = require("../services/aiService");
const repoIndexService = require("../services/repoIndexService");

async function handleReviewRequest({ message, topic }) {
  await repoIndexService.ensureIndex();
  const searchResults = repoIndexService.searchIndex(message, 5);

  const contextBlock = searchResults.length
    ? searchResults
        .map((result, index) => {
          return [
            `Context ${index + 1}: ${result.path}`,
            `Score: ${result.score}`,
            "Snippet:",
            result.snippet
          ].join("\n");
        })
        .join("\n\n")
    : "No repo files matched the query. Explain the answer and say the repo context is currently unavailable.";

  const system = [
    aiService.getAemPromptPreamble(
      "Review and validate AEM implementations like an AEM architect. Provide not just code review, but also architectural and design critique, rationale, and best practices."
    ),
    "Answer like an AEM architect and senior reviewer.",
    "",
    "When reviewing components, check and explain:",
    "- HTL: correct data-sly-use, null checks with data-sly-test, no embedded Java logic",
    "- Dialog: correct sling:resourceType, field names start with './' and match Sling Model @ValueMapValue names",
    "- Sling Model: correct @Model annotation, @ValueMapValue for each dialog field, proper getters",
    "- Component XML: valid jcr:primaryType='cq:Component', componentGroup matches project config",
    "- Architectural fit: how does this solution fit into the overall AEM solution (OSGi, dispatcher, permissions, content model, etc.)?",
    "- Security, scalability, maintainability, and extensibility considerations",
    "- Common pitfalls, anti-patterns, and how to avoid them",
    "- Suggestions for improvement for enterprise/production use",
    "- Reference Adobe official best practices and documentation",
    "",
    "For each review point, provide rationale (why it matters for maintainability, scalability, security, etc.).",
    "Base your answer on the provided repository context whenever possible.",
    "If the context is missing or weak, say so explicitly and provide the best guidance you can."
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    topic ? `Focus topic: ${topic}` : null,
    aiService.toDataBlock("question", message, 1200),
    aiService.toDataBlock("repository_context", contextBlock, 4500)
  ]
    .filter(Boolean)
    .join("\n");

  const answer = await aiService.askAI({ system, user }, {
    mode: "reviewer",
    fallbackContext: {
      topic,
      message,
      searchResults
    }
  });

  return {
    answer,
    references: searchResults.map((result) => ({
      path: result.path,
      score: result.score
    }))
  };
}

module.exports = {
  handleReviewRequest
};
