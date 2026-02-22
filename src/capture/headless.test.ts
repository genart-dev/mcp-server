import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Puppeteer — vi.hoisted ensures mocks are available before vi.mock hoist
// ---------------------------------------------------------------------------

const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const { mockPage, mockBrowser } = vi.hoisted(() => {
  const mockPage = {
    setViewport: vi.fn(),
    setContent: vi.fn(),
    screenshot: vi.fn(),
    close: vi.fn(),
  };
  const mockBrowser = {
    newPage: vi.fn(),
    connected: true,
    close: vi.fn(),
  };
  return { mockPage, mockBrowser };
});

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

import { captureHtml, captureHtmlMulti, closeBrowser } from "./headless.js";

describe("headless capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.setViewport.mockResolvedValue(undefined);
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.screenshot.mockResolvedValue(Buffer.from(FAKE_PNG));
    mockPage.close.mockResolvedValue(undefined);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.connected = true;
  });

  // -----------------------------------------------------------------------
  // captureHtml
  // -----------------------------------------------------------------------

  describe("captureHtml", () => {
    it("captures HTML to PNG by default", async () => {
      const result = await captureHtml({
        html: "<html><body>Test</body></html>",
        width: 800,
        height: 600,
      });

      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.mimeType).toBe("image/png");
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it("captures as JPEG when imageType is jpeg", async () => {
      mockPage.screenshot.mockResolvedValue(Buffer.from(FAKE_JPEG));

      const result = await captureHtml({
        html: "<html><body>Test</body></html>",
        width: 400,
        height: 400,
        imageType: "jpeg",
        quality: 70,
      });

      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(result.mimeType).toBe("image/jpeg");
      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "jpeg",
          quality: 70,
        }),
      );
    });

    it("sets the viewport dimensions", async () => {
      await captureHtml({
        html: "<html><body>Test</body></html>",
        width: 1200,
        height: 1200,
      });

      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 1200,
        height: 1200,
        deviceScaleFactor: 1,
      });
    });

    it("loads HTML content with domcontentloaded", async () => {
      await captureHtml({
        html: "<html><body>Test</body></html>",
        width: 800,
        height: 600,
      });

      expect(mockPage.setContent).toHaveBeenCalledWith(
        "<html><body>Test</body></html>",
        expect.objectContaining({ waitUntil: "domcontentloaded" }),
      );
    });

    it("takes a clipped screenshot", async () => {
      await captureHtml({
        html: "<html><body>Test</body></html>",
        width: 400,
        height: 300,
      });

      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "png",
          clip: { x: 0, y: 0, width: 400, height: 300 },
        }),
      );
    });

    it("closes the page after capture", async () => {
      await captureHtml({
        html: "<html><body>Test</body></html>",
        width: 800,
        height: 600,
      });

      expect(mockPage.close).toHaveBeenCalled();
    });

    it("closes the page even if screenshot fails", async () => {
      mockPage.screenshot.mockRejectedValueOnce(new Error("Screenshot failed"));

      await expect(
        captureHtml({
          html: "<html><body>Test</body></html>",
          width: 800,
          height: 600,
        }),
      ).rejects.toThrow("Screenshot failed");

      expect(mockPage.close).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // captureHtmlMulti
  // -----------------------------------------------------------------------

  describe("captureHtmlMulti", () => {
    it("returns both PNG and JPEG tiers", async () => {
      let callCount = 0;
      mockPage.screenshot.mockImplementation(async (opts: { type?: string }) => {
        callCount++;
        if (callCount === 1) {
          expect(opts.type).toBe("png");
          return Buffer.from(FAKE_PNG);
        }
        expect(opts.type).toBe("jpeg");
        return Buffer.from(FAKE_JPEG);
      });

      const result = await captureHtmlMulti({
        html: "<html><body>Test</body></html>",
        width: 800,
        height: 600,
      });

      expect(result.previewPng).toBeInstanceOf(Uint8Array);
      expect(result.previewWidth).toBe(800);
      expect(result.previewHeight).toBe(600);
      expect(result.inlineJpeg).toBeInstanceOf(Uint8Array);
      // 800x600 scaled to fit within 400: scale = 400/800 = 0.5 → 400x300
      expect(result.inlineWidth).toBe(400);
      expect(result.inlineHeight).toBe(300);
    });

    it("scales inline to fit within inlineSize preserving aspect ratio", async () => {
      mockPage.screenshot.mockResolvedValue(Buffer.from(FAKE_PNG));

      const result = await captureHtmlMulti({
        html: "<html><body>Test</body></html>",
        width: 1200,
        height: 800,
        inlineSize: 300,
      });

      // Scale = min(300/1200, 300/800) = 0.25 → 300x200
      expect(result.inlineWidth).toBe(300);
      expect(result.inlineHeight).toBe(200);
    });

    it("does not upscale when sketch is smaller than inlineSize", async () => {
      mockPage.screenshot.mockResolvedValue(Buffer.from(FAKE_PNG));

      const result = await captureHtmlMulti({
        html: "<html><body>Test</body></html>",
        width: 200,
        height: 150,
        inlineSize: 400,
      });

      // scale = min(400/200, 400/150, 1) = 1 → no upscale
      expect(result.inlineWidth).toBe(200);
      expect(result.inlineHeight).toBe(150);
    });

    it("resizes viewport for second screenshot", async () => {
      mockPage.screenshot.mockResolvedValue(Buffer.from(FAKE_PNG));

      await captureHtmlMulti({
        html: "<html><body>Test</body></html>",
        width: 800,
        height: 800,
        inlineSize: 400,
      });

      // First viewport: full-res
      expect(mockPage.setViewport).toHaveBeenNthCalledWith(1, {
        width: 800,
        height: 800,
        deviceScaleFactor: 1,
      });
      // Second viewport: inline size
      expect(mockPage.setViewport).toHaveBeenNthCalledWith(2, {
        width: 400,
        height: 400,
        deviceScaleFactor: 1,
      });
    });

    it("takes exactly two screenshots per call", async () => {
      mockPage.screenshot.mockResolvedValue(Buffer.from(FAKE_PNG));

      await captureHtmlMulti({
        html: "<html><body>Test</body></html>",
        width: 800,
        height: 600,
      });

      expect(mockPage.screenshot).toHaveBeenCalledTimes(2);
    });

    it("closes the page even if second screenshot fails", async () => {
      let callCount = 0;
      mockPage.screenshot.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error("JPEG failed");
        return Buffer.from(FAKE_PNG);
      });

      await expect(
        captureHtmlMulti({
          html: "<html><body>Test</body></html>",
          width: 800,
          height: 600,
        }),
      ).rejects.toThrow("JPEG failed");

      expect(mockPage.close).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // closeBrowser
  // -----------------------------------------------------------------------

  it("closes browser on closeBrowser()", async () => {
    // First capture to ensure browser is launched
    await captureHtml({
      html: "<html><body>Test</body></html>",
      width: 800,
      height: 600,
    });

    await closeBrowser();
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});
