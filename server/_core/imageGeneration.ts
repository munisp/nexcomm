/**
 * NEXCOM Exchange — Image generation helper
 *
 * Replaces the Manus ImageService gRPC-web proxy with a direct OpenAI Images API call.
 * Works with any OpenAI-compatible image endpoint (DALL-E 3, Stable Diffusion via
 * compatible wrappers, etc.).
 *
 * Configuration:
 *   - OPENAI_API_KEY or LLM_API_KEY  — API key
 *   - LLM_BASE_URL                   — override base URL (e.g. for local SD)
 *   - IMAGE_MODEL                    — model name (default: dall-e-3)
 *
 * No Manus dependencies.
 */
import OpenAI from "openai";
import { storagePut } from "../storage";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
  model?: string;
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
  quality?: "standard" | "hd";
};

export type GenerateImageResponse = {
  url?: string;
};

function createImageClient(): OpenAI {
  const baseURL = process.env.LLM_BASE_URL ?? undefined;
  const apiKey =
    process.env.LLM_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "no-key";
  return new OpenAI({ apiKey, baseURL });
}

let _imageClient: OpenAI | null = null;
function getImageClient(): OpenAI {
  if (!_imageClient) _imageClient = createImageClient();
  return _imageClient;
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const client = getImageClient();
  const model = options.model ?? process.env.IMAGE_MODEL ?? "dall-e-3";
  const size = options.size ?? "1024x1024";
  const quality = options.quality ?? "standard";

  // If editing an existing image and the model supports it, use the edit endpoint
  if (options.originalImages?.length && options.originalImages[0]?.url) {
    // Download the original image and pass as a buffer
    const origUrl = options.originalImages[0].url;
    const imgResp = await fetch(origUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgResp.ok) throw new Error(`Failed to fetch original image: ${imgResp.status}`);
    const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
    const imgFile = new File([imgBuffer], "original.png", { type: "image/png" });

    const editResp = await client.images.edit({
      model: "dall-e-2", // edit endpoint only supports dall-e-2
      image: imgFile,
      prompt: options.prompt,
      size: "1024x1024",
      response_format: "b64_json",
    });

    const b64 = editResp.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image edit returned no data");
    const buffer = Buffer.from(b64, "base64");
    const { url } = await storagePut(`generated/${Date.now()}-edit.png`, buffer, "image/png");
    return { url };
  }

  // Standard generation
  const resp = await client.images.generate({
    model,
    prompt: options.prompt,
    size,
    quality,
    response_format: "b64_json",
    n: 1,
  });

  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no data");
  const buffer = Buffer.from(b64, "base64");
  const { url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
  return { url };
}

export function _resetImageClient() { _imageClient = null; }
