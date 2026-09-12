from pathlib import Path
import re

path = Path("app/index.html")
text = path.read_text()

combined_send = r'''    async function sendMessage() {
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
        if (productMode === "research") {
          const response = await fetch("/api/chat", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              message,
              history: priorHistory,
              depthStyle,
              productMode
            })
          });

          const data = await response.json();
          typingBubble.remove();

          if (!response.ok) {
            throw new Error(data.error || "Research request failed.");
          }

          reply = data.reply || "No response returned.";
          const sources = Array.isArray(data.sources) ? data.sources : [];
          const citations = Array.isArray(data.citations) ? data.citations : [];
          assistantBubble = addMessage("assistant", reply, "", sources, citations);
          conversationHistory.push({
            role: "assistant",
            content: reply,
            sources,
            citations
          });
          saveConversation();
          updateGoDeeperVisibility();
          return;
        }

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
            depthStyle,
            productMode: "standard"
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
        if (assistantBubble && reply && productMode !== "research") {
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
'''

pattern = re.compile(
    r"    async function sendMessage\(\) \{[\s\S]*?(?=    async function goDeeper\(\) \{)"
)
text, count = pattern.subn(lambda _: combined_send + "\n", text, count=1)
if count != 1:
    raise SystemExit(f"sendMessage resolver expected 1 function, found {count}")

if any(marker in text for marker in ("<<<<<<<", "=======", ">>>>>>>")):
    raise SystemExit("Unresolved merge conflict remains outside sendMessage")

path.write_text(text)
print("Merged Research Mode UI with streaming Standard mode.")
