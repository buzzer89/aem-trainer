const express = require("express");

const executorAgent = require("../agents/executorAgent");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const { command, preset } = req.body;

    if (!command && !preset) {
      return res.status(400).json({ error: "command or preset is required" });
    }

    const result = await executorAgent.handleExecutionRequest({ command, preset });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
