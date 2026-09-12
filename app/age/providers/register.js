const { registerAgeVerificationAdapter } = require("../gateway");
const {
  PROVIDER_ID,
  yotiAgeVerificationAdapter
} = require("./yoti");

let registered = false;

function registerBuiltInAgeVerificationProviders() {
  if (!registered) {
    registerAgeVerificationAdapter(PROVIDER_ID, yotiAgeVerificationAdapter);
    registered = true;
  }
  return yotiAgeVerificationAdapter;
}

module.exports = {
  registerBuiltInAgeVerificationProviders
};
