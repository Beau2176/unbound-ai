"use strict";

const FEATURE_LANDING_PAGES = Object.freeze([
  Object.freeze({
    id: "work_mode",
    path: "/work-mode",
    eyebrow: "FAST WHEN YOU WANT IT. DEEP WHEN YOU NEED IT.",
    title: "Work Mode",
    summary: "Switch UNBOUND AI into deeper, fuller analysis for planning, writing, technical work, and complex decisions.",
    plan: "FREE",
    bullets: [
      "Deeper response style without changing your account.",
      "Built for long-form planning, troubleshooting, and research preparation.",
      "Switch back to Casual Mode when speed matters more than depth."
    ],
    cta: "TRY WORK MODE"
  }),
  Object.freeze({
    id: "research",
    path: "/research",
    eyebrow: "LIVE SOURCES. CLEARER ANSWERS.",
    title: "Research Mode",
    summary: "Use live source-driven research with citations when you need current information instead of an answer based only on model knowledge.",
    plan: "PREMIUM",
    bullets: [
      "Live web research with source-backed answers.",
      "Research citations and source metadata.",
      "Designed for current events, products, comparisons, and fact checking."
    ],
    cta: "EXPLORE RESEARCH"
  }),
  Object.freeze({
    id: "voice",
    path: "/voice-conversation",
    eyebrow: "TALK TO UNBOUND.",
    title: "Voice Conversation",
    summary: "Have a spoken conversation with UNBOUND AI when typing is inconvenient or you simply want a more natural interaction.",
    plan: "PREMIUM",
    bullets: [
      "Natural spoken conversation.",
      "Listen controls and device voice support.",
      "Works alongside the same UNBOUND account and access system."
    ],
    cta: "EXPLORE VOICE"
  }),
  Object.freeze({
    id: "files",
    path: "/analyze-files",
    eyebrow: "BRING THE DOCUMENT. ASK THE QUESTION.",
    title: "File Analysis",
    summary: "Upload supported documents and data files and ask UNBOUND AI to help explain, summarize, compare, or work through them.",
    plan: "PREMIUM",
    bullets: [
      "Analyze supported documents and data files.",
      "Raw uploads are not stored by the UNBOUND file-analysis flow.",
      "Useful for summaries, comparisons, extraction, and structured work."
    ],
    cta: "EXPLORE FILES"
  }),
  Object.freeze({
    id: "images",
    path: "/image-tools",
    eyebrow: "UNDERSTAND. CREATE. EDIT.",
    title: "Image Tools",
    summary: "Use image understanding on Premium, and unlock image generation and supported image editing with Ultra.",
    plan: "PREMIUM + ULTRA",
    bullets: [
      "Premium includes image understanding.",
      "Ultra includes image generation and supported image editing.",
      "Raw image uploads are not stored by the image-understanding flow."
    ],
    cta: "EXPLORE IMAGES"
  }),
  Object.freeze({
    id: "agents",
    path: "/ai-agents",
    eyebrow: "MULTI-STEP WORK WITHOUT LOSING THE THREAD.",
    title: "Bounded Agents",
    summary: "Let UNBOUND AI carry out structured multi-step analysis, drafting, planning, and source-backed research inside defined limits.",
    plan: "ULTRA",
    bullets: [
      "Queued multi-step work for larger tasks.",
      "Optional source-backed web research.",
      "External actions remain separately permissioned and controlled."
    ],
    cta: "EXPLORE AGENTS"
  }),
  Object.freeze({
    id: "privacy_control",
    path: "/privacy-control",
    eyebrow: "YOUR ACCOUNT. YOUR CONTROLS.",
    title: "Privacy & Control",
    summary: "UNBOUND AI is being built around explicit account controls instead of hiding important settings behind vague defaults.",
    plan: "FREE",
    bullets: [
      "Download a privacy-safe copy of your account data.",
      "Delete your account with re-authentication and billing safety checks.",
      "Review legal consent, memory controls, and connected-app permissions."
    ],
    cta: "OPEN UNBOUND AI"
  })
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function landingForPath(pathname) {
  return FEATURE_LANDING_PAGES.find((page) => page.path === String(pathname || "")) || null;
}

function buildFeatureLandingHtml(page) {
  if (!page) return null;
  const params = new URLSearchParams({
    utm_source: "unbound",
    utm_medium: "feature_landing",
    utm_campaign: "product_pages",
    utm_content: page.id,
    landing: page.path
  });
  const ctaUrl = "/?" + params.toString();
  const bullets = page.bullets
    .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#050913" />
  <meta name="description" content="${escapeHtml(page.summary)}" />
  <title>${escapeHtml(page.title)} · UNBOUND AI</title>
  <style>
    *{box-sizing:border-box} body{margin:0;min-height:100vh;color:#f7fbff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(180deg,rgba(2,6,14,.44),rgba(2,6,14,.94)),url("/unbound-cosmic.png") center/cover fixed no-repeat}
    a{color:inherit}.nav{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:16px 22px;background:rgba(3,8,16,.84);border-bottom:1px solid rgba(255,255,255,.08);backdrop-filter:blur(14px)}.brand{font-weight:950;letter-spacing:.16em}.brand span{color:#6bc1ff}.nav a{text-decoration:none;font-weight:850;font-size:13px}
    main{width:min(1040px,calc(100% - 28px));margin:0 auto;padding:clamp(52px,10vw,110px) 0 70px}.eyebrow{color:#ffbf69;font-size:12px;font-weight:950;letter-spacing:.14em}.hero{max-width:820px}.hero h1{font-size:clamp(46px,9vw,88px);line-height:.95;margin:12px 0 20px}.hero p{max-width:740px;color:#c5d3e0;font-size:clamp(18px,3vw,24px);line-height:1.5;margin:0}.plan{display:inline-flex;margin-top:24px;padding:8px 12px;border:1px solid rgba(107,193,255,.42);border-radius:999px;background:rgba(66,165,255,.1);color:#ccecff;font-weight:900;font-size:12px;letter-spacing:.08em}
    .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:24px;margin-top:44px}.card{padding:24px;border:1px solid rgba(107,193,255,.3);border-radius:20px;background:rgba(5,10,20,.9);box-shadow:0 22px 70px rgba(0,0,0,.44)}ul{margin:0;padding-left:22px;color:#d9e6f0;line-height:1.65}li+li{margin-top:10px}.cta{display:flex;flex-direction:column;justify-content:center;align-items:flex-start}.cta h2{margin:0 0 10px;font-size:28px}.cta p{margin:0 0 18px;color:#9fb3c5;line-height:1.5}.button{display:inline-block;padding:14px 18px;border:1px solid rgba(255,173,67,.6);border-radius:12px;background:linear-gradient(135deg,rgba(255,173,67,.18),rgba(66,165,255,.14));text-decoration:none;font-weight:950;letter-spacing:.06em}
    .trust{margin-top:26px;color:#8198aa;font-size:12px;line-height:1.5}.footer{margin-top:70px;color:#72899c;font-size:12px}.footer a{margin-right:14px}
    @media(max-width:760px){.nav{padding:14px}.grid{grid-template-columns:1fr}.hero h1{font-size:clamp(44px,16vw,68px)}main{padding-top:58px}}
  </style>
</head>
<body>
  <header class="nav">
    <div class="brand">UNBOUND <span>AI</span></div>
    <a href="/">OPEN APP</a>
  </header>
  <main>
    <section class="hero">
      <div class="eyebrow">${escapeHtml(page.eyebrow)}</div>
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.summary)}</p>
      <div class="plan">${escapeHtml(page.plan)} ACCESS</div>
    </section>
    <section class="grid">
      <div class="card"><ul>${bullets}</ul></div>
      <div class="card cta">
        <h2>See it inside UNBOUND AI</h2>
        <p>Create an account or sign in, then use Account Access to see what your current plan includes.</p>
        <a class="button" href="${escapeHtml(ctaUrl)}">${escapeHtml(page.cta)}</a>
      </div>
    </section>
    <div class="trust">Feature availability depends on account plan and configured providers. These pages describe the current product structure; they do not promise uninterrupted third-party service availability.</div>
    <footer class="footer"><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/">UNBOUND AI</a></footer>
  </main>
</body>
</html>`;
}

function sendFeatureLandingPage(req, res) {
  const page = landingForPath(req.path);
  const html = buildFeatureLandingHtml(page);
  if (!html) return res.status(404).send("Not found.");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.type("html").send(html);
}

module.exports = {
  FEATURE_LANDING_PAGES,
  escapeHtml,
  landingForPath,
  buildFeatureLandingHtml,
  sendFeatureLandingPage
};
