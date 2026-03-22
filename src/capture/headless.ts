/**
 * Headless capture — renders a standalone HTML page to a PNG screenshot
 * using Puppeteer's headless Chrome.
 *
 * When RENDER_SERVICE_URL is set, delegates to the remote render service
 * (ADR 096) instead of launching a local browser.
 */

import puppeteer from "puppeteer";
import { captureHtmlRemote, captureHtmlMultiRemote, type RemoteCaptureConfig } from "./remote.js";

/** Remote render service config — set when running in mcp-host (remote mode). */
const remoteConfig: RemoteCaptureConfig | null = process.env.RENDER_SERVICE_URL
  ? {
      url: process.env.RENDER_SERVICE_URL,
      secret: process.env.RENDER_SERVICE_SECRET || "",
    }
  : null;

type Browser = Awaited<ReturnType<typeof puppeteer.launch>>;

/** Options for capturing a screenshot of an HTML page. */
export interface CaptureOptions {
  /** Full HTML source to render. */
  html: string;
  /** Viewport / output width in pixels. */
  width: number;
  /** Viewport / output height in pixels. */
  height: number;
  /** Time in ms to wait after page load before screenshotting (default: 500). */
  waitMs?: number;
  /** Image format (default: "png"). */
  imageType?: "png" | "jpeg";
  /** JPEG quality 0-100 (only used when imageType is "jpeg", default: 80). */
  quality?: number;
}

/** Result of a headless capture. */
export interface CaptureResult {
  /** Raw image bytes. */
  bytes: Uint8Array;
  /** MIME type of the captured image. */
  mimeType: "image/png" | "image/jpeg";
  /** Width of the captured image. */
  width: number;
  /** Height of the captured image. */
  height: number;
}

/** Result of a two-tier capture (preview PNG + inline JPEG). */
export interface MultiCaptureResult {
  /** Full-resolution PNG for the preview file. */
  previewPng: Uint8Array;
  previewWidth: number;
  previewHeight: number;
  /** Small JPEG for inline AI viewing. */
  inlineJpeg: Uint8Array;
  inlineWidth: number;
  inlineHeight: number;
  /** Public URL for the preview image (only set when using remote render service with PUBLIC_HOST). */
  previewUrl?: string;
}

/**
 * Chrome launch args that enable WebGL2 via SwANGLE (SwiftShader + ANGLE).
 * On macOS ARM, SwiftShader is broken — `headless: "new"` uses the real GPU.
 */
function getWebGLArgs(): string[] {
  const base = ["--use-gl=angle"];
  if (process.platform === "darwin" && process.arch === "arm64") {
    return base;
  }
  return [...base, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
}

/** Shared browser instance (lazy singleton). */
let browserInstance: Browser | null = null;

/** Get or launch the shared headless browser. */
async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      ...getWebGLArgs(),
    ],
  });
  return browserInstance;
}

/**
 * Render an HTML string to a PNG image using headless Chrome.
 * The page is loaded with the given viewport dimensions, then screenshotted
 * after a brief wait to allow the sketch to render its first frame.
 */
export async function captureHtml(options: CaptureOptions): Promise<CaptureResult> {
  if (remoteConfig) return captureHtmlRemote(remoteConfig, options);

  const { html, width, height, waitMs = 500, imageType = "png", quality } = options;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait for the sketch to render its first frame
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const buffer = await page.screenshot({
      type: imageType,
      clip: { x: 0, y: 0, width, height },
      ...(imageType === "jpeg" && quality !== undefined ? { quality } : {}),
    });
    const bytes = new Uint8Array(buffer);
    const mimeType = imageType === "jpeg" ? "image/jpeg" as const : "image/png" as const;

    return { bytes, mimeType, width, height };
  } finally {
    await page.close();
  }
}

/**
 * Two-tier capture: loads the page once and takes two screenshots.
 * 1. Full-res PNG at the given dimensions (for preview file)
 * 2. Resized JPEG at inlineSize (for inline AI viewing, low token cost)
 */
export async function captureHtmlMulti(options: {
  html: string;
  width: number;
  height: number;
  waitMs?: number;
  inlineSize?: number;
  jpegQuality?: number;
}): Promise<MultiCaptureResult> {
  if (remoteConfig) return captureHtmlMultiRemote(remoteConfig, options);

  const { html, width, height, waitMs = 500, inlineSize = 400, jpegQuality = 70 } = options;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // First capture: full-res PNG at sketch dimensions
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const pngBuffer = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width, height },
    });
    const previewPng = new Uint8Array(pngBuffer);

    // Second capture: small JPEG for inline AI viewing
    // Scale to fit within inlineSize, preserving aspect ratio
    const scale = Math.min(inlineSize / width, inlineSize / height, 1);
    const inlineWidth = Math.round(width * scale);
    const inlineHeight = Math.round(height * scale);

    await page.setViewport({ width: inlineWidth, height: inlineHeight, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const jpegBuffer = await page.screenshot({
      type: "jpeg",
      quality: jpegQuality,
      clip: { x: 0, y: 0, width: inlineWidth, height: inlineHeight },
    });
    const inlineJpeg = new Uint8Array(jpegBuffer);

    return {
      previewPng,
      previewWidth: width,
      previewHeight: height,
      inlineJpeg,
      inlineWidth,
      inlineHeight,
    };
  } finally {
    await page.close();
  }
}

/** Close the shared browser instance. Call on server shutdown. */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
