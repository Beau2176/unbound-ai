function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Model-routing UI marker is missing: ${label}.`);
    error.code = "MODEL_ROUTING_UI_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Model-routing UI marker is ambiguous: ${label}.`);
    error.code = "MODEL_ROUTING_UI_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function injectModelRoutingUi(indexHtml) {
  let source = String(indexHtml || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI index source is empty.");
    error.code = "MODEL_ROUTING_UI_SOURCE_EMPTY";
    throw error;
  }

  const styleControl = `          <label class="style-control" for="aiStyleSelect">`;
  source = replaceExactlyOnce(
    source,
    styleControl,
    `          <label class="style-control" for="modelProfileSelect">\n            <span>MODEL</span>\n            <select id="modelProfileSelect" aria-label="AI model routing profile">\n              <option value="auto">AUTO</option>\n              <option value="fast">FAST · ULTRA</option>\n              <option value="deep">DEEP · ULTRA</option>\n              <option value="research">RESEARCH · ULTRA</option>\n            </select>\n          </label>\n${styleControl}`,
    "model-profile-control"
  );

  const stateMarker = `    let depthStyle = "casual";\n    let aiStyle = "balanced";`;
  source = replaceExactlyOnce(
    source,
    stateMarker,
    `    let depthStyle = "casual";\n    let modelProfile = "auto";\n    let aiStyle = "balanced";`,
    "model-profile-state"
  );

  const researchPayload = `              depthStyle,\n              productMode,\n              aiStyle,\n              conversationId: currentUser ? activeConversationId : null`;
  source = replaceExactlyOnce(
    source,
    researchPayload,
    `              depthStyle,\n              productMode,\n              aiStyle,\n              modelProfile,\n              conversationId: currentUser ? activeConversationId : null`,
    "research-model-profile-payload"
  );

  const streamingPayload = `            depthStyle,\n            productMode,\n            aiStyle,\n            conversationId: currentUser ? activeConversationId : null`;
  source = replaceExactlyOnce(
    source,
    streamingPayload,
    `            depthStyle,\n            productMode,\n            aiStyle,\n            modelProfile,\n            conversationId: currentUser ? activeConversationId : null`,
    "streaming-model-profile-payload"
  );

  const closeMarker = `  </script>\n</body>`;
  const browserIntegration = `    const modelProfileSelect = document.getElementById("modelProfileSelect");\n    if (modelProfileSelect) {\n      modelProfileSelect.addEventListener("change", async () => {\n        const requested = String(modelProfileSelect.value || "auto").trim().toLowerCase();\n        const allowed = ["auto", "fast", "deep", "research"];\n        if (!allowed.includes(requested)) {\n          modelProfile = "auto";\n          modelProfileSelect.value = "auto";\n          return;\n        }\n\n        if (requested !== "auto") {\n          if (!currentUser) {\n            modelProfile = "auto";\n            modelProfileSelect.value = "auto";\n            showToast("Multi-model routing requires a signed-in Ultra account.");\n            openAuth("login");\n            return;\n          }\n          if (!accountAccess) await refreshAccountAccess({ silent: true });\n          if (!canUseCapability("multi_model")) {\n            modelProfile = "auto";\n            modelProfileSelect.value = "auto";\n            showToast("Multi-model routing requires Ultra access.");\n            return;\n          }\n        }\n\n        modelProfile = requested;\n        if (requested === "auto") {\n          showToast("Model routing set to Auto.");\n        } else {\n          showToast(\`Model routing profile: \${requested.toUpperCase()}.\`);\n        }\n      });\n    }\n\n${closeMarker}`;
  source = replaceExactlyOnce(
    source,
    closeMarker,
    browserIntegration,
    "model-profile-browser-handler"
  );

  return source;
}

module.exports = {
  replaceExactlyOnce,
  injectModelRoutingUi
};
