const ADVERTISE_LINK = '<a class="account-button advertiser-link" href="/advertisers.html">ADVERTISE</a>';
const CONNECTED_APPS_LINK = '<a class="account-button advertiser-link" href="/connected-apps.html">APPS</a>';

function injectConnectedAppsUi(html) {
  const source = String(html || "");
  if (source.includes(CONNECTED_APPS_LINK)) return source;
  const first = source.indexOf(ADVERTISE_LINK);
  const last = source.lastIndexOf(ADVERTISE_LINK);
  if (first === -1 || first !== last) {
    const error = new Error("Connected Apps navigation marker is missing or ambiguous.");
    error.code = "CONNECTED_APPS_UI_MARKER_INVALID";
    throw error;
  }
  return source.slice(0, first) + `${ADVERTISE_LINK}\n      ${CONNECTED_APPS_LINK}` + source.slice(first + ADVERTISE_LINK.length);
}

module.exports = {
  ADVERTISE_LINK,
  CONNECTED_APPS_LINK,
  injectConnectedAppsUi
};
