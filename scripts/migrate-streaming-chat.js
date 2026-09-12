const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "..", "app", "server.js");
const indexPath = path.join(__dirname, "..", "app", "index.html");
let server = fs.readFileSync(serverPath, "utf8");
let index = fs.readFileSync(indexPath, "utf8");

function replaceOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return source.replace(oldText, newText);
}

server = replaceOnce(
  server,
  'const { generateChat, getGatewayStatus } = require("./ai/gateway");',
  'const { generateChat, streamChat, getGatewayStatus } = require("./ai/gateway");',
  "gateway streaming import"
);

const streamEndpoint = String.raw`
app.post("/api/chat/stream", async (req, res) => {
  try {
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "Please enter a message." });
    }

    const gatewayStatus = getGatewayStatus();

    if (!gatewayStatus.configured) {
      return res.status(503).json({
        error:
          gatewayStatus.error === "unsupported-provider"
            ? "AI provider '" + gatewayStatus.provider + "' is not supported."
            : "AI provider '" + gatewayStatus.provider + "' is not configured."
      });
    }

    const history = cleanHistory(req.body.history);
    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const depthInstructions =
      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const input = [
      ...history,
      { role: "user", content: message.slice(0, 12000) }
    ];

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const writeEvent = (event) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(JSON.stringify(event) + "\n");
      }
    };

    writeEvent({
      type: "meta",
      depthStyle,
      provider: gatewayStatus.provider,
      model: gatewayStatus.model
    });

    const aiResponse = await streamChat({
      model: gatewayStatus.model,
      instructions: UNBOUND_SYSTEM_PROMPT + "\n\n" + depthInstructions,
      input,
      onDelta: async (delta) => {
        writeEvent({ type: "delta", delta });
      }
    });

    if (databaseReady && pool && aiResponse.usage) {
      try {
        const sessionUser = await findSessionUser(req);
        await recordUsageEvent({
          userId: sessionUser?.id || null,
          provider: aiResponse.provider,
          model: aiResponse.model,
          eventType: "chat_stream_" + depthStyle,
          usage: aiResponse.usage,
          estimatedCostMicros: estimateProviderCostMicros(
            aiResponse.provider,
            aiResponse.usage
          ),
          providerResponseId: aiResponse.responseId
        });
      } catch (usageError) {
        console.error("UNBOUND AI STREAM USAGE METER ERROR:", usageError);
      }
    }

    writeEvent({
      type: "done",
      depthStyle,
      provider: aiResponse.provider,
      model: aiResponse.model
    });
    res.end();
  } catch (error) {
    console.error("UNBOUND AI STREAM ERROR:", error);

    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) {
        res.write(
          JSON.stringify({
            type: "error",
            error: error.message || "UNBOUND AI could not get a response."
          }) + "\n"
        );
        res.end();
      }
      return;
    }

    res.status(500).json({
      error: error.message || "UNBOUND AI could not get a response."
    });
  }
});

`;

server = replaceOnce(
  server,
  'app.get("/", (req, res) => {',
  streamEndpoint + 'app.get("/", (req, res) => {',
  "stream endpoint insertion"
);

const oldSendStart = '    async function sendMessage() {';
const oldSendEnd = '    async function goDeeper() {';
const start = index.indexOf(oldSendStart);
const end = index.indexOf(oldSendEnd);
if (start === -1 || end === -1 || end <= start) {
  throw new Error("frontend sendMessage boundaries not found");
}

const newSend = String.raw`    async function sendMessage() {
      const message = input.value.trim();

      if (!message) {
        return;
      }

      const priorHistory = conversationHistory.slice(-MAX_CONTEXT_MESSAGES);

      addMessage("user", message);
      conversationHistory.push({ role: "user", content: message });
      saveConversation();
      updateGoDeeperVisibility();

      input.value = "";
      input.focus();
      sendButton.disabled = true;
      goDeeperButton.disabled = true;
      const typingBubble = addTypingIndicator();
      let assistantBubble = null;
      let reply = "";

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/x-ndjson"
          },
          body: JSON.stringify({
            message,
            history: priorHistory,
            depthStyle
          })
        });

        if (!response.ok) {
          const data = await readJson(response);
          throw new Error(data.error || "Request failed.");
        }

        if (!response.body) {
          throw new Error("Streaming is not available in this browser.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleStreamLine = (line) => {
          if (!line.trim()) return;
          const event = JSON.parse(line);

          if (event.type === "delta" && typeof event.delta === "string") {
            if (!assistantBubble) {
              typingBubble.remove();
              assistantBubble = addMessage("assistant", "");
            }
            reply += event.delta;
            assistantBubble.innerHTML = renderMarkdown(reply);
            messages.scrollTop = messages.scrollHeight;
          }

          if (event.type === "error") {
            throw new Error(event.error || "Streaming response failed.");
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            handleStreamLine(line);
          }

          if (done) break;
        }

        if (buffer.trim()) {
          handleStreamLine(buffer);
        }

        typingBubble.remove();

        if (!reply) {
          reply = "No response returned.";
          if (!assistantBubble) {
            assistantBubble = addMessage("assistant", reply);
          } else {
            assistantBubble.innerHTML = renderMarkdown(reply);
          }
        }

        conversationHistory.push({ role: "assistant", content: reply });
        saveConversation();
        updateGoDeeperVisibility();
      } catch (error) {
        typingBubble.remove();
        if (assistantBubble && reply) {
          assistantBubble.classList.add("error");
          assistantBubble.innerHTML = renderMarkdown(
            reply + "\n\n[Stream interrupted: " + (error.message || "unknown error") + "]"
          );
        } else {
          addMessage(
            "assistant",
            error.message || "UNBOUND AI could not get a response.",
            "error"
          );
        }
      } finally {
        sendButton.disabled = false;
        goDeeperButton.disabled = false;
        updateGoDeeperVisibility();
      }
    }

`;

index = index.slice(0, start) + newSend + index.slice(end);

fs.writeFileSync(serverPath, server);
fs.writeFileSync(indexPath, index);
console.log("Streaming chat migration applied.");
