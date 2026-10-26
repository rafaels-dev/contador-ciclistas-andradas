import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { accessAllowed } from "./access";
import { isVideo, normalizePath } from "./local-files";
import { STEPS, currentStep, statusKey } from "./status";

describe("normalizePath", () => {
  it("removes the quotes of Windows' 'Copy as path'", () => {
    expect(normalizePath('  "' + path.resolve("videos", "a.mp4") + '"  ')).toBe(path.resolve("videos", "a.mp4"));
  });

  it.runIf(process.platform !== "win32")("on Linux/WSL, C:\\folder becomes /mnt/c/folder", () => {
    expect(normalizePath("C:\\Users\\Ana\\Vídeos\\cam 4.mp4")).toBe("/mnt/c/Users/Ana/Vídeos/cam 4.mp4");
    expect(normalizePath("D:/data/x.mp4")).toBe("/mnt/d/data/x.mp4");
  });

  it.runIf(process.platform === "win32")("on Windows, the path stays as it is", () => {
    expect(normalizePath("C:\\Users\\Ana\\cam.mp4")).toBe("C:\\Users\\Ana\\cam.mp4");
  });
});

describe("isVideo", () => {
  it("recognizes the video extensions, case-insensitive", () => {
    expect(isVideo("Andradas_06.MP4")).toBe(true);
    expect(isVideo("recording.mkv")).toBe(true);
    expect(isVideo("photo.jpg")).toBe(false);
    expect(isVideo("no-extension")).toBe(false);
  });
});

describe("job status", () => {
  it("a video from the computer is not downloaded: only opened", () => {
    expect(statusKey({ status: "downloading", drive_id: "local" })).toBe("status.opening");
    expect(statusKey({ status: "downloading", drive_id: "abc" })).toBe("status.downloading");
  });

  it("each status lands on the right step of the bar", () => {
    expect(STEPS[currentStep("awaiting_lines")]).toBe("lines");
    expect(STEPS[currentStep("suggesting")]).toBe("suggestions");
    expect(STEPS[currentStep("awaiting_review")]).toBe("review");
    expect(STEPS[currentStep("done")]).toBe("review");
    expect(currentStep("error")).toBe(-1);
  });
});

describe("accessAllowed (desktop app server)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("without TRAFFIC_COUNTER_TOKEN (next dev), everything is allowed", () => {
    delete process.env.TRAFFIC_COUNTER_TOKEN;
    expect(accessAllowed(undefined, null)).toBe(true);
  });

  it("with a token: requires the right token and the port's 127.0.0.1 host", () => {
    process.env.TRAFFIC_COUNTER_TOKEN = "secret-123";
    process.env.PORT = "4321";
    expect(accessAllowed("secret-123", "127.0.0.1:4321")).toBe(true);
    expect(accessAllowed("secret-124", "127.0.0.1:4321")).toBe(false);
    expect(accessAllowed("secret", "127.0.0.1:4321")).toBe(false);
    expect(accessAllowed(undefined, "127.0.0.1:4321")).toBe(false);
    // DNS rebinding: a page from another site pointing at the local port
    expect(accessAllowed("secret-123", "malicious.example:4321")).toBe(false);
    expect(accessAllowed("secret-123", "localhost:4321")).toBe(false);
  });
});
