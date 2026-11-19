import { randomUUID } from "node:crypto";
import { desktopCapturer } from "electron";
import type { ScreenshotItem } from "@shared/types";
import type { WindowManager } from "./windows";

const MAX_CAPTURE_WIDTH = 1600;
const JPEG_QUALITY = 82;

export async function captureTargetDisplayScreenshot(
  windows: WindowManager,
  restoreProtection: boolean,
): Promise<ScreenshotItem> {
  const display = windows.getTargetDisplay();
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / Math.max(1, display.bounds.width));
  const targetWidth = Math.max(320, Math.round(display.bounds.width * scale));
  const targetHeight = Math.max(200, Math.round(display.bounds.height * scale));

  // Ensure the HUD overlay does not obscure the captured screen
  windows.setContentProtection(true);
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: targetWidth, height: targetHeight },
    });

    const match =
      sources.find((s) => s.display_id === String(display.id)) ?? sources[0];

    if (!match) {
      throw new Error(
        "No screen capture source available. Check macOS Screen Recording permissions in System Settings.",
      );
    }

    const size = match.thumbnail.getSize();
    if (size.width === 0 || size.height === 0) {
      throw new Error(
        "Captured an empty frame. Grant Screen Recording permission to GlassHUD in System Settings and restart.",
      );
    }

    const jpegBuffer = match.thumbnail.toJPEG(JPEG_QUALITY);
    return {
      id: randomUUID(),
      mimeType: "image/jpeg",
      dataUrl: `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`,
      width: size.width,
      height: size.height,
      capturedAt: Date.now(),
    };
  } finally {
    windows.setContentProtection(restoreProtection);
  }
}
