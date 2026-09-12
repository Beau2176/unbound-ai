from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new, 1))


server = Path("app/server.js")

one(
    server,
    '''const express = require("express");
const path = require("path");
''',
    '''const express = require("express");
const compression = require("compression");
const path = require("path");
''',
    "compression import"
)

one(
    server,
    '''app.disable("x-powered-by");
app.use(createHttpSecurityMiddleware({ isProduction: IS_PRODUCTION }));
app.use(
  createSameOriginApiGuard({
    isProduction: IS_PRODUCTION,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN || ""
  })
);
app.use(express.json({ limit: "100kb" }));
app.get("/index.html", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/unbound-cosmic.png", (req, res) => res.sendFile(path.join(__dirname, "unbound-cosmic.png")));
''',
    '''app.disable("x-powered-by");
app.use(createHttpSecurityMiddleware({ isProduction: IS_PRODUCTION }));
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.path === "/api/chat/stream") return false;
      return compression.filter(req, res);
    }
  })
);
app.use(
  createSameOriginApiGuard({
    isProduction: IS_PRODUCTION,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN || ""
  })
);
app.use(express.json({ limit: "100kb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/index.html", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/admin.html", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "admin.html"));
});
app.get("/unbound-cosmic.png", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  return res.sendFile(path.join(__dirname, "unbound-cosmic.png"));
});
''',
    "compression and cache middleware"
)

one(
    server,
    '''app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
''',
    '''app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "index.html"));
});
''',
    "root html cache policy"
)

print("Applied UNBOUND AI v0.32 HTTP performance hardening.")
