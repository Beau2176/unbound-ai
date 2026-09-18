const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  MAX_PROVIDER_REPLY_CHARS,
  assertProviderReplySize,
  boundedProviderReply,
  providerError
} = require("../ai/providers/provider-utils");
const { isRetryableProviderError } = require("../ai/gateway");

function source(name) {
  return fs.readFileSync(path.join(__dirname, "..", "ai", "providers", name), "utf8");
}

function main() {
  assert.strictEqual(MAX_PROVIDER_REPLY_CHARS, 4 * 1024 * 1024);
  assert.strictEqual(assertProviderReplySize(MAX_PROVIDER_REPLY_CHARS, 0), MAX_PROVIDER_REPLY_CHARS);
  assert.strictEqual(boundedProviderReply("abc", { maxChars: 3 }), "abc");

  assert.throws(
    () => assertProviderReplySize(MAX_PROVIDER_REPLY_CHARS, 1, {
      code: "TEST_REPLY_TOO_LARGE",
      label: "Contract"
    }),
    (error) => error?.code === "TEST_REPLY_TOO_LARGE" && error?.statusCode === 502
  );
  assert.throws(
    () => boundedProviderReply("abcd", {
      maxChars: 3,
      code: "TEST_REPLY_TOO_LARGE",
      label: "Contract"
    }),
    (error) => error?.code === "TEST_REPLY_TOO_LARGE"
  );

  const outputLimitError = providerError(
    "OPENAI_REPLY_TOO_LARGE",
    "too large",
    502
  );
  assert.strictEqual(
    isRetryableProviderError(outputLimitError),
    false,
    "local output-size policy must not trigger provider failover or circuit poisoning"
  );

  const openai = source("openai.js");
  assert(openai.includes("boundedProviderReply(response.output_text || \"\""));
  assert(openai.includes("OPENAI_REPLY_TOO_LARGE"));
  assert(openai.includes("OPENAI_RESEARCH_REPLY_TOO_LARGE"));
  assert(openai.includes("OPENAI_STREAM_REPLY_TOO_LARGE"));
  assert(openai.includes("OPENAI_FILE_ANALYSIS_REPLY_TOO_LARGE"));
  assert(openai.includes("assertProviderReplySize(reply.length, event.delta.length"));

  const anthropic = source("anthropic.js");
  assert(anthropic.includes("ANTHROPIC_REPLY_TOO_LARGE"));
  assert(anthropic.includes("assertProviderReplySize(reply.length, block.text.length"));
  assert(anthropic.includes("ANTHROPIC_STREAM_REPLY_TOO_LARGE"));

  const google = source("google.js");
  assert(google.includes("GEMINI_REPLY_TOO_LARGE"));
  assert(google.includes("assertProviderReplySize(replyStartIndex, text.length"));
  assert(google.includes("GEMINI_STREAM_REPLY_TOO_LARGE"));
  assert(google.includes("googleGroundingApproved"));

  const local = source("local.js");
  assert(local.includes("LOCAL_AI_REPLY_TOO_LARGE"));
  assert(local.includes("boundedProviderReply("));
  assert(local.includes("LOCAL_AI_STREAM_REPLY_TOO_LARGE"));

  const gateway = fs.readFileSync(path.join(__dirname, "..", "ai", "gateway.js"), "utf8");
  assert(gateway.includes('/_REPLY_TOO_LARGE$/.test(code)'));

  console.log(
    "PASS provider output bounds: shared 4 Mi-character ceiling, provider-specific non-streaming guards, OpenAI stream/file guards, existing SSE limits, and no failover/circuit poisoning."
  );
}

main();
