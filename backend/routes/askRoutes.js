const express = require("express");

const reviewerAgent = require("../agents/reviewerAgent");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const { message, topic } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const response = await reviewerAgent.handleReviewRequest({ message, topic });
    res.json(response);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
