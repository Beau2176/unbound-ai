"use strict";

const crypto = require("crypto");

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 12;

function normalizeRecoveryCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function formatRecoveryCode(buffer) {
  const hex = buffer.toString("hex").toUpperCase();
  const groups = hex.match(/.{1,4}/g) || [];
  return `UNB-${groups.join("-")}`;
}

function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const safeCount = Math.min(Math.max(Number(count) || RECOVERY_CODE_COUNT, 1), 20);
  return Array.from({ length: safeCount }, () =>
    formatRecoveryCode(crypto.randomBytes(RECOVERY_CODE_BYTES))
  );
}

function hashRecoveryCode(value) {
  const normalized = normalizeRecoveryCode(value);
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function isRecoveryCodeShape(value) {
  const normalized = normalizeRecoveryCode(value);
  return /^UNB[A-F0-9]{24}$/.test(normalized);
}

function getRecoveryStatus() {
  return {
    enabled: true,
    codeCount: RECOVERY_CODE_COUNT,
    oneTimeUse: true,
    plaintextStored: false,
    hashAlgorithm: "sha256",
    codeEntropyBits: RECOVERY_CODE_BYTES * 8
  };
}

module.exports = {
  RECOVERY_CODE_COUNT,
  normalizeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeShape,
  getRecoveryStatus
};
