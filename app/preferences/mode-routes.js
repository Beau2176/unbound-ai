const path = require("path");

function sendModeLibraryPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "modes.html"));
}

module.exports = {
  sendModeLibraryPage
};
