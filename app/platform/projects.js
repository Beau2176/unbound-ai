const crypto = require("crypto");

const MAX_PROJECT_NAME = 100;
const MAX_PROJECT_DESCRIPTION = 2000;
const MAX_ASSET_NAME = 255;

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeProjectInput(body = {}) {
  const name = cleanText(body.name, MAX_PROJECT_NAME);
  if (!name) {
    const error = new Error("Project name is required.");
    error.code = "PROJECT_NAME_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return {
    name,
    description: cleanText(body.description, MAX_PROJECT_DESCRIPTION)
  };
}

function normalizeVaultAssetInput(body = {}) {
  const name = cleanText(body.name, MAX_ASSET_NAME);
  const mediaType = cleanText(body.mediaType || "application/octet-stream", 120);
  const bytes = Math.max(0, Math.min(Number(body.bytes) || 0, 10 * 1024 * 1024 * 1024));
  if (!name) {
    const error = new Error("Vault asset name is required.");
    error.code = "VAULT_ASSET_NAME_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return {
    id: crypto.randomUUID(),
    name,
    mediaType,
    bytes,
    storageState: "metadata_only"
  };
}

function publicProject(row) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description || "",
    status: row.status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicVaultAsset(row) {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    name: row.name,
    mediaType: row.media_type,
    bytes: Number(row.bytes || 0),
    storageProvider: row.storage_provider || null,
    storageState: row.storage_state || "metadata_only",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  MAX_PROJECT_NAME,
  MAX_PROJECT_DESCRIPTION,
  MAX_ASSET_NAME,
  normalizeProjectInput,
  normalizeVaultAssetInput,
  publicProject,
  publicVaultAsset
};
