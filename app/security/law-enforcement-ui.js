function buildCompanyLegalResponseHtml(html) {
  let output = String(html || "");
  const replacements = [
    ["<title>UNBOUND AI · Law Enforcement</title>", "<title>UNBOUND AI · Company Legal Response</title>"],
    ["UNBOUND <span>AI</span> · LAW ENFORCEMENT", "UNBOUND <span>AI</span> · LEGAL RESPONSE"],
    ["<h1>Law Enforcement Evidence Response</h1>", "<h1>Company Legal / Law Enforcement Response</h1>"],
    [
      "Admin-only search and manual export of previously preserved high-risk safety evidence.",
      "Admin-only search and manual export of Preserved High-Risk Safety Records for a specific verified legal or law-enforcement request."
    ],
    [
      "<strong>Manual disclosure only.</strong> This workspace does not decide that a person committed a crime, does not record every conversation, and does not send anything to police or any other outside party. Use it only after a specific law-enforcement request has been received. Every export is audited and selected records are placed on legal hold.",
      "<strong>Company-controlled disclosure only.</strong> These Preserved High-Risk Safety Records are maintained for legitimate safety, legal-hold, and response purposes. This workspace does not decide that a person committed a crime, does not create a blanket surveillance archive, and does not transmit records automatically. Company personnel may search or export records only after a specific verified legal or law-enforcement request has been logged. Every export is audited and selected records are placed on legal hold."
    ],
    ["<h2>2. Matching Preserved Records</h2>", "<h2>2. Matching Preserved High-Risk Safety Records</h2>"],
    ["<h2>Recent Law-Enforcement Requests</h2>", "<h2>Recent Legal / Law-Enforcement Requests</h2>"],
    [
      "These records are an internal audit trail of specific requests. They are not automatically sent anywhere.",
      "These entries are the company's internal audit trail of specific legal or law-enforcement requests. Nothing is automatically sent outside UNBOUND AI."
    ]
  ];

  for (const [from, to] of replacements) output = output.replace(from, to);
  return output;
}

module.exports = { buildCompanyLegalResponseHtml };
