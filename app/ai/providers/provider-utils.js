function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    return String(part.text || part.input_text || part.output_text || "");
  }).filter(Boolean).join("\n");
}

function normalizeInputMessages(input = []) {
  return (Array.isArray(input) ? input : []).map((item) => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: contentToText(item?.content)
  })).filter((item) => item.content);
}

function combineSystemAndMessages(instructions, input = []) {
  return {
    system: String(instructions || "").trim(),
    messages: normalizeInputMessages(input)
  };
}

function providerError(code, message, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeHttpEndpoint(value, { allowHttp = false } = {}) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol === "https:" || (allowHttp && parsed.protocol === "http:")) return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  contentToText,
  normalizeInputMessages,
  combineSystemAndMessages,
  providerError,
  normalizeHttpEndpoint
};
