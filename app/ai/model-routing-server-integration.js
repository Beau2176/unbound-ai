const INTEGRATION_VERSION = "v0.86";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Model-routing integration marker is missing: ${label}.`);
    error.code = "MODEL_ROUTING_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Model-routing integration marker is ambiguous: ${label}.`);
    error.code = "MODEL_ROUTING_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateModelRoutingServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "MODEL_ROUTING_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const gatewayImport = `const { generateChat, streamChat, getGatewayStatus } = require("./ai/gateway");`;
  source = replaceExactlyOnce(
    source,
    gatewayImport,
    `${gatewayImport}\nconst { resolveChatModel } = require("./ai/model-routing");`,
    "model-routing-import"
  );

  const generateMarker = `    const aiResponse = await runWithRequestCancellation(\n      req,\n      res,\n      (signal) => generateChat({\n        model: gatewayStatus.model,`;
  const generateReplacement = `    const multiModelAccess = req.user ? await buildAccountAccess(req.user) : null;\n    const multiModelEnabled = Boolean(\n      multiModelAccess?.capabilities?.find((item) => item.key === "multi_model")?.usable\n    );\n    const modelRoute = resolveChatModel({\n      requestedProfile: req.body?.modelProfile,\n      depthStyle,\n      productMode,\n      message,\n      defaultModel: gatewayStatus.model,\n      enabled: multiModelEnabled\n    });\n    const reasoningEffort =\n      productMode === "research" || depthStyle === "work" ? "low" : "none";\n\n    const aiResponse = await runWithRequestCancellation(\n      req,\n      res,\n      (signal) => generateChat({\n        model: modelRoute.model,\n        reasoningEffort,`;
  source = replaceExactlyOnce(
    source,
    generateMarker,
    generateReplacement,
    "non-streaming-chat-model"
  );

  const streamMarker = `    const aiResponse = await runWithRequestCancellation(\n      req,\n      res,\n      (signal) => streamChat({\n        model: gatewayStatus.model,`;
  const streamReplacement = `    const multiModelAccess = req.user ? await buildAccountAccess(req.user) : null;\n    const multiModelEnabled = Boolean(\n      multiModelAccess?.capabilities?.find((item) => item.key === "multi_model")?.usable\n    );\n    const modelRoute = resolveChatModel({\n      requestedProfile: req.body?.modelProfile,\n      depthStyle,\n      productMode,\n      message,\n      defaultModel: gatewayStatus.model,\n      enabled: multiModelEnabled\n    });\n    const reasoningEffort = depthStyle === "work" ? "low" : "none";\n\n    const aiResponse = await runWithRequestCancellation(\n      req,\n      res,\n      (signal) => streamChat({\n        model: modelRoute.model,\n        reasoningEffort,`;
  source = replaceExactlyOnce(
    source,
    streamMarker,
    streamReplacement,
    "streaming-chat-model"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateModelRoutingServerSource
};
