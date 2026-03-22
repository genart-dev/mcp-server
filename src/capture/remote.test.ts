import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureHtmlRemote, captureHtmlMultiRemote, type RemoteCaptureConfig } from "./remote.js";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const config: RemoteCaptureConfig = {
  url: "http://genart-render.internal:3200",
  secret: "test-secret-123",
  timeoutMs: 5000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const FAKE_PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
const FAKE_JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");

// ---------------------------------------------------------------------------
// captureHtmlRemote
// ---------------------------------------------------------------------------

describe("captureHtmlRemote", () => {
  it("sends correct payload to /capture", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        image: FAKE_PNG_B64,
        mimeType: "image/png",
        width: 800,
        height: 600,
      }),
    );

    await captureHtmlRemote(config, {
      html: "<html>test</html>",
      width: 800,
      height: 600,
      waitMs: 300,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://genart-render.internal:3200/capture",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-secret-123",
        }),
      }),
    );

    // Verify the body payload
    const call = mockFetch.mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({
      html: "<html>test</html>",
      width: 800,
      height: 600,
      waitMs: 300,
      format: "png",
      quality: undefined,
    });
  });

  it("returns CaptureResult with decoded bytes", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        image: FAKE_PNG_B64,
        mimeType: "image/png",
        width: 400,
        height: 300,
      }),
    );

    const result = await captureHtmlRemote(config, {
      html: "<html></html>",
      width: 400,
      height: 300,
    });

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it("sends JPEG format when imageType is jpeg", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        image: FAKE_JPEG_B64,
        mimeType: "image/jpeg",
        width: 200,
        height: 200,
      }),
    );

    await captureHtmlRemote(config, {
      html: "<html></html>",
      width: 200,
      height: 200,
      imageType: "jpeg",
      quality: 80,
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.format).toBe("jpeg");
    expect(body.quality).toBe(80);
  });

  it("omits Authorization header when secret is empty", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        image: FAKE_PNG_B64,
        mimeType: "image/png",
        width: 200,
        height: 200,
      }),
    );

    const noSecretConfig: RemoteCaptureConfig = {
      url: "http://localhost:3200",
      secret: "",
    };

    await captureHtmlRemote(noSecretConfig, {
      html: "<html></html>",
      width: 200,
      height: 200,
    });

    const headers = mockFetch.mock.calls[0]![1].headers;
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));

    await expect(
      captureHtmlRemote(config, {
        html: "<html></html>",
        width: 200,
        height: 200,
      }),
    ).rejects.toThrow("Render service /capture returned 401");
  });

  it("throws on 500 with error message", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Capture failed" }, 500));

    await expect(
      captureHtmlRemote(config, {
        html: "<html></html>",
        width: 200,
        height: 200,
      }),
    ).rejects.toThrow("Render service /capture returned 500");
  });

  it("throws on fetch network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      captureHtmlRemote(config, {
        html: "<html></html>",
        width: 200,
        height: 200,
      }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("aborts on timeout", async () => {
    const shortTimeoutConfig: RemoteCaptureConfig = {
      url: "http://genart-render.internal:3200",
      secret: "test",
      timeoutMs: 50,
    };

    mockFetch.mockImplementationOnce(async (_url: string, opts: { signal: AbortSignal }) => {
      // Wait longer than timeout
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (opts.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return jsonResponse({ image: FAKE_PNG_B64, mimeType: "image/png", width: 200, height: 200 });
    });

    await expect(
      captureHtmlRemote(shortTimeoutConfig, {
        html: "<html></html>",
        width: 200,
        height: 200,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// captureHtmlMultiRemote
// ---------------------------------------------------------------------------

describe("captureHtmlMultiRemote", () => {
  it("sends correct payload to /capture/multi", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        previewPng: FAKE_PNG_B64,
        previewWidth: 800,
        previewHeight: 600,
        inlineJpeg: FAKE_JPEG_B64,
        inlineWidth: 400,
        inlineHeight: 300,
      }),
    );

    await captureHtmlMultiRemote(config, {
      html: "<html>multi</html>",
      width: 800,
      height: 600,
      inlineSize: 400,
      jpegQuality: 70,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://genart-render.internal:3200/capture/multi",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body).toEqual({
      html: "<html>multi</html>",
      width: 800,
      height: 600,
      inlineSize: 400,
      jpegQuality: 70,
    });
  });

  it("returns MultiCaptureResult with decoded bytes", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        previewPng: FAKE_PNG_B64,
        previewWidth: 800,
        previewHeight: 600,
        inlineJpeg: FAKE_JPEG_B64,
        inlineWidth: 400,
        inlineHeight: 300,
      }),
    );

    const result = await captureHtmlMultiRemote(config, {
      html: "<html></html>",
      width: 800,
      height: 600,
    });

    expect(result.previewPng).toBeInstanceOf(Uint8Array);
    expect(result.previewPng).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(result.previewWidth).toBe(800);
    expect(result.previewHeight).toBe(600);
    expect(result.inlineJpeg).toBeInstanceOf(Uint8Array);
    expect(result.inlineJpeg).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    expect(result.inlineWidth).toBe(400);
    expect(result.inlineHeight).toBe(300);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Multi-capture failed" }, 500));

    await expect(
      captureHtmlMultiRemote(config, {
        html: "<html></html>",
        width: 800,
        height: 600,
      }),
    ).rejects.toThrow("Render service /capture/multi returned 500");
  });

  it("uses default timeout when timeoutMs not set", async () => {
    const noTimeoutConfig: RemoteCaptureConfig = {
      url: "http://localhost:3200",
      secret: "test",
    };

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        previewPng: FAKE_PNG_B64,
        previewWidth: 200,
        previewHeight: 200,
        inlineJpeg: FAKE_JPEG_B64,
        inlineWidth: 200,
        inlineHeight: 200,
      }),
    );

    // Should not throw — default timeout is 30s
    const result = await captureHtmlMultiRemote(noTimeoutConfig, {
      html: "<html></html>",
      width: 200,
      height: 200,
    });

    expect(result.previewWidth).toBe(200);
  });
});
