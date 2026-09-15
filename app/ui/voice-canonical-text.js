function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Voice canonical text marker is missing: ${label}.`);
    error.code = 'VOICE_CANONICAL_TEXT_MARKER_MISSING';
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Voice canonical text marker is ambiguous: ${label}.`);
    error.code = 'VOICE_CANONICAL_TEXT_MARKER_AMBIGUOUS';
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function injectVoiceCanonicalText(indexSource) {
  let source = String(indexSource || '');

  source = replaceExactlyOnce(
    source,
    '      if (role === "assistant") {\n        bubble.innerHTML = renderAssistantHtml(content, sources, citations);',
    '      if (role === "assistant") {\n        bubble.dataset.speechText = String(content || "");\n        bubble.innerHTML = renderAssistantHtml(content, sources, citations);',
    'assistant-bubble-canonical-text'
  );

  source = replaceExactlyOnce(
    source,
    '          assistantBubble = addMessage("assistant", reply, "", sources, citations);\n          conversationHistory.push({',
    '          assistantBubble = addMessage("assistant", reply, "", sources, citations);\n          window.dispatchEvent(new CustomEvent("unbound:assistant-stream", {\n            detail: { text: reply, delta: reply, start: true, done: true, research: true }\n          }));\n          conversationHistory.push({',
    'research-reply-event'
  );

  source = replaceExactlyOnce(
    source,
    '            reply += event.delta;\n            assistantBubble.innerHTML = renderMarkdown(reply);',
    '            const speechStart = assistantBubble.dataset.speechStarted !== "true";\n            reply += event.delta;\n            assistantBubble.dataset.speechText = reply;\n            assistantBubble.dataset.speechStarted = "true";\n            window.dispatchEvent(new CustomEvent("unbound:assistant-stream", {\n              detail: { text: reply, delta: event.delta, start: speechStart, done: false }\n            }));\n            assistantBubble.innerHTML = renderMarkdown(reply);',
    'stream-delta-event'
  );

  source = replaceExactlyOnce(
    source,
    '        conversationHistory.push({ role: "assistant", content: reply });',
    '        if (assistantBubble) assistantBubble.dataset.speechText = reply;\n        window.dispatchEvent(new CustomEvent("unbound:assistant-stream", {\n          detail: {\n            text: reply,\n            delta: "",\n            start: Boolean(assistantBubble && assistantBubble.dataset.speechStarted !== "true"),\n            done: true\n          }\n        }));\n        conversationHistory.push({ role: "assistant", content: reply });',
    'stream-complete-event'
  );

  return source;
}

module.exports = {
  replaceExactlyOnce,
  injectVoiceCanonicalText
};
