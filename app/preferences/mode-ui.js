const { listAiStyles } = require("./ai-style");

const LEGACY_STYLE_OPTIONS = `              <option value="balanced">BALANCED</option>
              <option value="straight">STRAIGHT SHOOTER</option>
              <option value="professional">PROFESSIONAL</option>
              <option value="warm">WARM</option>
              <option value="playful">PLAYFUL</option>`;

const LEGACY_STYLE_FUNCTIONS = `    function normalizeAiStyle(value) {
      return ["balanced", "straight", "professional", "warm", "playful"].includes(value)
        ? value
        : "balanced";
    }

    function aiStyleLabel(value) {
      return ({
        balanced: "Balanced",
        straight: "Straight Shooter",
        professional: "Professional",
        warm: "Warm",
        playful: "Playful"
      })[normalizeAiStyle(value)];
    }`;

function buildAiStyleOptions(styles = listAiStyles()) {
  return styles
    .map((style) => `              <option value="${style.id}">${style.label.toUpperCase()}</option>`)
    .join("\n");
}

function buildAiStyleBrowserFunctions(styles = listAiStyles()) {
  const ids = styles.map((style) => style.id);
  const labels = Object.fromEntries(styles.map((style) => [style.id, style.label]));
  return `    const UNBOUND_AI_STYLE_IDS = Object.freeze(${JSON.stringify(ids)});
    const UNBOUND_AI_STYLE_LABELS = Object.freeze(${JSON.stringify(labels)});

    function normalizeAiStyle(value) {
      const normalized = String(value || "").trim().toLowerCase();
      return UNBOUND_AI_STYLE_IDS.includes(normalized) ? normalized : "balanced";
    }

    function aiStyleLabel(value) {
      return UNBOUND_AI_STYLE_LABELS[normalizeAiStyle(value)] || "Balanced";
    }`;
}

function buildAiStyleIndexHtml(indexHtml) {
  let source = String(indexHtml || "");
  for (const [marker, replacement] of [
    [LEGACY_STYLE_OPTIONS, buildAiStyleOptions()],
    [LEGACY_STYLE_FUNCTIONS, buildAiStyleBrowserFunctions()]
  ]) {
    if (source.indexOf(marker) < 0 || source.indexOf(marker) !== source.lastIndexOf(marker)) {
      const error = new Error("Expected exactly one UNBOUND AI style selector marker.");
      error.code = "AI_STYLE_INDEX_MARKER_CHANGED";
      throw error;
    }
    source = source.replace(marker, replacement);
  }
  return source;
}

module.exports = {
  LEGACY_STYLE_OPTIONS,
  LEGACY_STYLE_FUNCTIONS,
  buildAiStyleOptions,
  buildAiStyleBrowserFunctions,
  buildAiStyleIndexHtml
};
