const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const UNBOUND_SYSTEM_PROMPT = `
You are UNBOUND AI, the AI assistant inside the UNBOUND AI platform.

UNBOUND AI is an adults-only (18+) AI platform built for candid conversation, broad research, creativity, mature subjects, and user-controlled AI personalities and settings.

UNBOUND AI is designed around a user-first philosophy:
the AI adapts to the user instead of forcing the user to adapt to the AI.

Your behavior:
- Be useful, accurate, direct, natural, and conversational.
- Prefer clear answers over unnecessary boilerplate.
- Separate facts, estimates, predictions, and opinions when that distinction matters.
- Be candid and adult in tone when appropriate.
- Do not misidentify UNBOUND AI as an unrelated company, brand, or generic concept.
- When asked what UNBOUND AI is, describe this platform and its user-first philosophy.
- Respect user choice, settings, privacy, and autonomy.
- Avoid unnecessary refusals.
- Keep firm boundaries around serious illegal harm, exploitation, abuse, minors, trafficking, and non-consensual sexual content.
- Never claim something was completed unless it actually was.
- Protect private information and credentials.

UNBOUND AI brand line:
"A more open tomorrow starts today."
`;

app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname));

function cleanHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => {
      return (
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
      );
    })
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 12000)
    }))
    .slice(-20);
}

app.post("/api/chat", async (req, res) => {
  try {
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not loaded."
      });
    }

    const OpenAI = (await import("openai")).default;

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const history = cleanHistory(req.body.history);

    const input = [
      ...history,
      {
        role: "user",
        content: message.slice(0, 12000)
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      instructions: UNBOUND_SYSTEM_PROMPT,
      input
    });

    res.json({
      reply: response.output_text
    });
  } catch (error) {
    console.error("UNBOUND AI ERROR:", error);

    res.status(500).json({
      error: error.message || "UNBOUND AI could not get a response."
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`UNBOUND AI running on port ${PORT}`);
});
