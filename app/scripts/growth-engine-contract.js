"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateGrowthServerSource } = require("../growth/server-integration");
const {
  cleanReferralCode,
  cleanLandingPath,
  normalizeAcquisition,
  safeMetadata
} = require("../growth/store");
const {
  FEATURE_LANDING_PAGES,
  landingForPath,
  buildFeatureLandingHtml
} = require("../growth/landing-pages");

function main() {
  assert.equal(cleanReferralCode("ab12cd34"), "AB12CD34");
  assert.equal(cleanReferralCode("bad code!"), null);
  assert.equal(cleanLandingPath("/research?x=1"), "/research?x=1");
  assert.equal(cleanLandingPath("https://evil.example"), null);

  const acquisition = normalizeAcquisition({
    source: " TikTok ",
    medium: "creator",
    campaign: "launch-wave-1",
    content: "work-mode-demo",
    ref: "abc12345",
    landingPath: "/work"
  });
  assert.deepEqual(acquisition, {
    source: "TikTok",
    medium: "creator",
    campaign: "launch-wave-1",
    content: "work-mode-demo",
    referralCode: "ABC12345",
    landingPath: "/work"
  });

  const metadata = safeMetadata({
    provider: "segpay",
    ok: true,
    count: 2,
    nested: { should: "drop" }
  });
  assert.deepEqual(metadata, { provider: "segpay", ok: true, count: 2 });

  assert.equal(FEATURE_LANDING_PAGES.length, 7);
  assert.equal(landingForPath("/work-mode")?.id, "work_mode");
  assert.equal(landingForPath("/privacy-control")?.plan, "FREE");
  const researchLanding = buildFeatureLandingHtml(landingForPath("/research"));
  assert.match(researchLanding, /Research Mode/);
  assert.match(researchLanding, /utm_campaign=product_pages/);
  assert.match(researchLanding, /landing=%2Fresearch/);
  assert.doesNotMatch(researchLanding, /<script/i);

  const appRoot = path.resolve(__dirname, "..");
  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  let source = integrateEmailVerificationServerSource(rawServer);
  source = integrateBillingServerSource(source);
  source = integrateGrowthServerSource(source);

  assert.match(source, /initializeGrowthSchema\(pool\)/);
  assert.match(source, /captureRegistrationGrowth/);
  assert.match(source, /"\/api\/account\/referral"/);
  assert.match(source, /"\/api\/admin\/growth\/summary"/);
  assert.match(source, /"\/growth-admin"/);
  assert.match(source, /FEATURE_LANDING_PAGES/);
  assert.match(source, /eventName: "landing_view"/);
  assert.match(source, /eventName: "checkout_started"/);
  assert.match(source, /eventName: "subscription_activated"/);
  assert.match(source, /eventName: "subscription_churned"/);

  const reappliedError = (() => {
    try {
      integrateGrowthServerSource(source);
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.ok(reappliedError, "Growth integration should fail closed rather than duplicate itself.");

  console.log("Growth engine contract passed: acquisition attribution, referrals, and checkout funnel events.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
