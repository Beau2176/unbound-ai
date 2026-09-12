const assert = require("assert");
const {
  DEFAULT_IMAGE_MODEL,
  generateImage,
  editImage
} = require("../images/providers/openai");

async function main() {
  let generateRequest = null;
  const generated = await generateImage({
    prompt: "A blue-and-gold infinity symbol above a mountain sunrise",
    size: "1024x1024",
    quality: "medium",
    background: "auto",
    outputFormat: "png",
    env: { OPENAI_API_KEY: "contract-test-key" },
    clientFactory: async () => ({
      images: {
        generate: async (request) => {
          generateRequest = request;
          return {
            created: 123,
            output_format: "png",
            quality: "medium",
            size: "1024x1024",
            data: [{ b64_json: "YWJj" }]
          };
        }
      }
    })
  });
  assert.strictEqual(generateRequest.model, DEFAULT_IMAGE_MODEL);
  assert.strictEqual(generateRequest.n, 1);
  assert.strictEqual(generateRequest.moderation, "auto");
  assert.strictEqual(generateRequest.output_format, "png");
  assert.strictEqual(generated.imageBase64, "YWJj");
  assert.strictEqual(generated.provider, "openai");

  const source = Buffer.from("source-image");
  let editRequest = null;
  let uploadArgs = null;
  const edited = await editImage({
    filename: "source.png",
    mimeType: "image/png",
    imageBuffer: source,
    prompt: "Replace the background with snow.",
    inputFidelity: "high",
    size: "1024x1024",
    quality: "medium",
    background: "opaque",
    outputFormat: "webp",
    env: { OPENAI_API_KEY: "contract-test-key" },
    toFileFactory: async (buffer, filename, options) => {
      uploadArgs = { buffer, filename, options };
      return { contractUpload: true };
    },
    clientFactory: async () => ({
      images: {
        edit: async (request) => {
          editRequest = request;
          return {
            created: 456,
            output_format: "webp",
            quality: "medium",
            size: "1024x1024",
            background: "opaque",
            data: [{ b64_json: "ZGVm" }]
          };
        }
      }
    })
  });
  assert.strictEqual(uploadArgs.buffer, source);
  assert.strictEqual(uploadArgs.filename, "source.png");
  assert.deepStrictEqual(uploadArgs.options, { type: "image/png" });
  assert.strictEqual(editRequest.model, DEFAULT_IMAGE_MODEL);
  assert.strictEqual(editRequest.n, 1);
  assert.strictEqual(editRequest.input_fidelity, "high");
  assert.strictEqual(editRequest.output_format, "webp");
  assert.deepStrictEqual(editRequest.image, { contractUpload: true });
  assert.strictEqual(edited.imageBase64, "ZGVm");
  assert.strictEqual(edited.provider, "openai");

  console.log("UNBOUND AI image-tools provider contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
