const UNBOUND_PROJECT_START_DATE = "2026-09-08";
const UNBOUND_PROJECT_START_DATE_DISPLAY = "September 8, 2026";
const UNBOUND_PROJECT_START_TIME_ZONE = "America/Denver";
const UNBOUND_PROJECT_STARTED_AT_UTC = "2026-09-09T04:57:34Z";
const UNBOUND_BRAND_LINE = "A more open tomorrow starts today.";

const CORE_PROJECT_MEMORY = Object.freeze([
  "UNBOUND AI is the product and platform name.",
  `UNBOUND AI's official project inception date is ${UNBOUND_PROJECT_START_DATE_DISPLAY}.`,
  "The project inception date is a product-level fact, not an individual user's signup date or first-chat date.",
  "UNBOUND AI is an adults-only (18+) AI platform centered on candid conversation, broad research, creativity, mature subjects, and user-controlled AI settings.",
  `UNBOUND AI's brand line is \"${UNBOUND_BRAND_LINE}\".`
]);

function buildProjectCoreMemoryPrompt() {
  const lines = CORE_PROJECT_MEMORY.map((item) => `- ${item}`).join("\n");
  return `
UNBOUND AI core persistent project memory:
- These are durable product-level identity facts maintained by the UNBOUND AI project.
- Keep them available across conversations and sessions.
- Do not treat them as user-specific personal memory.
- If the project owner explicitly changes one of these facts in the product code, use the updated value.
${lines}
`;
}

function getProjectIdentity() {
  return {
    name: "UNBOUND AI",
    startDate: UNBOUND_PROJECT_START_DATE,
    startDateDisplay: UNBOUND_PROJECT_START_DATE_DISPLAY,
    startTimeZone: UNBOUND_PROJECT_START_TIME_ZONE,
    startedAtUtc: UNBOUND_PROJECT_STARTED_AT_UTC,
    brandLine: UNBOUND_BRAND_LINE
  };
}

module.exports = {
  UNBOUND_PROJECT_START_DATE,
  UNBOUND_PROJECT_START_DATE_DISPLAY,
  UNBOUND_PROJECT_START_TIME_ZONE,
  UNBOUND_PROJECT_STARTED_AT_UTC,
  UNBOUND_BRAND_LINE,
  CORE_PROJECT_MEMORY,
  buildProjectCoreMemoryPrompt,
  getProjectIdentity
};
