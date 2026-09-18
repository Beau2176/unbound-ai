const INTERRUPTED_REPLY_MARKER = "[Response interrupted before completion.]";

function replaceExactlyOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) {
    const error = new Error(
      `UNBOUND AI interrupted-stream integration could not patch ${label}; expected one anchor, found ${count}.`
    );
    error.code = "CHAT_STREAM_RECOVERY_ANCHOR_INVALID";
    throw error;
  }
  return source.replace(oldText, newText);
}

function injectInterruptedStreamRecovery(source) {
  const input = String(source || "");

  if (
    input.includes("let streamCompleted = false;") &&
    input.includes("lastItem.interrupted !== true") &&
    input.includes('item.interrupted ? "error" : ""') &&
    input.includes(INTERRUPTED_REPLY_MARKER)
  ) {
    return input;
  }

  let output = input;

  output = replaceExactlyOnce(
    output,
    `      goDeeperButton.hidden = !(\n        depthStyle === "casual" &&\n        lastItem &&\n        lastItem.role === "assistant"\n      );`,
    `      goDeeperButton.hidden = !(\n        depthStyle === "casual" &&\n        lastItem &&\n        lastItem.role === "assistant" &&\n        lastItem.interrupted !== true\n      );`,
    "Go Deeper completion guard"
  );

  output = replaceExactlyOnce(
    output,
    `          return {\n            role: item.role,\n            content,\n            sources,\n            citations\n          };`,
    `          return {\n            role: item.role,\n            content,\n            sources,\n            citations,\n            interrupted: item.role === "assistant" && item.interrupted === true\n          };`,
    "history interruption state"
  );

  output = replaceExactlyOnce(
    output,
    `        addMessage(\n          item.role,\n          item.content,\n          "",\n          item.sources || [],\n          item.citations || []\n        );`,
    `        addMessage(\n          item.role,\n          item.content,\n          item.interrupted ? "error" : "",\n          item.sources || [],\n          item.citations || []\n        );`,
    "interrupted history rendering"
  );

  output = replaceExactlyOnce(
    output,
    `        let buffer = "";`,
    `        let buffer = "";\n        let streamCompleted = false;`,
    "stream completion state"
  );

  output = replaceExactlyOnce(
    output,
    `          const event = JSON.parse(line);`,
    `          const event = JSON.parse(line);\n\n          if (event.type === "done") {\n            streamCompleted = true;\n          }`,
    "done-event tracking"
  );

  output = replaceExactlyOnce(
    output,
    `        if (buffer.trim()) {\n          handleStreamLine(buffer);\n        }\n\n        typingBubble.remove();\n\n        if (!reply) {`,
    `        if (buffer.trim()) {\n          handleStreamLine(buffer);\n        }\n\n        if (!streamCompleted) {\n          throw new Error("Response stream ended before completion.");\n        }\n\n        typingBubble.remove();\n\n        if (!reply) {`,
    "early EOF detection"
  );

  output = replaceExactlyOnce(
    output,
    `        if (assistantBubble && reply && requestMode !== "research") {\n          assistantBubble.classList.add("error");\n          assistantBubble.innerHTML = renderMarkdown(\n            reply + "\\n\\n[Stream interrupted: " + (error.message || "unknown error") + "]"\n          );\n        } else {`,
    `        if (assistantBubble && reply && requestMode !== "research") {\n          const interruptedReply =\n            reply + "\\n\\n${INTERRUPTED_REPLY_MARKER}";\n          assistantBubble.classList.add("error");\n          assistantBubble.innerHTML = renderMarkdown(interruptedReply);\n          conversationHistory.push({\n            role: "assistant",\n            content: interruptedReply,\n            interrupted: true\n          });\n          saveConversation();\n          updateGoDeeperVisibility();\n          console.warn("UNBOUND AI response stream interrupted:", error);\n        } else {`,
    "durable interrupted reply"
  );

  return output;
}

module.exports = {
  INTERRUPTED_REPLY_MARKER,
  injectInterruptedStreamRecovery
};
