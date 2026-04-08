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

  const qaContext = aiService.getQAContext();

  const prompt = [
    "You are the Reviewer Agent for an AEM AI Trainer Platform.",
    "Answer like a senior AEM reviewer.",
    "Follow the QA and validation guidelines described below.",
    "",
    "--- QA AGENT CONTEXT ---",
    qaContext,
    "--- END QA AGENT CONTEXT ---",
    "",
    "Base your answer on the provided repository context whenever possible.",
    "If the context is missing or weak, say so explicitly and provide the best guidance you can.",
    "When reviewing generated components, validate against the checklist in the QA context above.",
    topic ? `Focus topic: ${topic}` : null,
    `Question: ${message}`,
    "",
    "Repository Context:",
    contextBlock
  ]
    .filter(Boolean)
    .join("\n");

  const answer = await aiService.askAI(prompt, {
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
