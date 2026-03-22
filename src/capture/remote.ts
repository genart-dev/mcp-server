/**
 * Remote capture client — delegates to the render service (ADR 096).
 * Used when RENDER_SERVICE_URL is set (mcp-host in remote mode).
 */

import type { CaptureOptions, CaptureResult, MultiCaptureResult } from "./headless.js";

export interface RemoteCaptureConfig {
  url: string; // e.g. "http://genart-render.internal:3200"
  secret: string;
  timeoutMs?: number;
}

async function post<T>(config: RemoteCaptureConfig, path: string, body: unknown): Promise<T> {
  const timeout = config.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Render service ${path} returned ${res.status}: ${text}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface RemoteCaptureResult {
  image: string; // base64
  mimeType: string;
  width: number;
  height: number;
  previewUrl?: string;
}

interface RemoteMultiResult {
  previewPng: string;
  previewWidth: number;
  previewHeight: number;
  inlineJpeg: string;
  inlineWidth: number;
  inlineHeight: number;
  previewUrl?: string;
}

export async function captureHtmlRemote(
  config: RemoteCaptureConfig,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const result = await post<RemoteCaptureResult>(config, "/capture", {
    html: options.html,
    width: options.width,
    height: options.height,
    waitMs: options.waitMs,
    format: options.imageType ?? "png",
    quality: options.quality,
  });

  return {
    bytes: new Uint8Array(Buffer.from(result.image, "base64")),
    mimeType: result.mimeType as CaptureResult["mimeType"],
    width: result.width,
    height: result.height,
  };
}

export async function captureHtmlMultiRemote(
  config: RemoteCaptureConfig,
  options: {
    html: string;
    width: number;
    height: number;
    waitMs?: number;
    inlineSize?: number;
    jpegQuality?: number;
  },
): Promise<MultiCaptureResult> {
  const result = await post<RemoteMultiResult>(config, "/capture/multi", options);

  return {
    previewPng: new Uint8Array(Buffer.from(result.previewPng, "base64")),
    previewWidth: result.previewWidth,
    previewHeight: result.previewHeight,
    inlineJpeg: new Uint8Array(Buffer.from(result.inlineJpeg, "base64")),
    inlineWidth: result.inlineWidth,
    inlineHeight: result.inlineHeight,
    previewUrl: result.previewUrl,
  };
}
