const express = require("express");

const trainerAgent = require("../agents/trainerAgent");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const { message, topic } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const result = await trainerAgent.handleTrainingRequest({ message, topic });
    res.json({
      answer: result.answer,
      taskId: result.taskId || null,
      filesCreated: result.filesCreated || [],
      filesFailed: result.filesFailed || []
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
