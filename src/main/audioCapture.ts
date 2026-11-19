import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { AudioChannel, AudioStatusEvent, TranscriptSegment } from "@shared/types";
import { PcmVadFramer } from "@shared/wav";
import { transcribePcmUtterance } from "./ai/transcribe";
import type { LocalStore } from "./store";

const SAMPLE_RATE = 16000;

export function resolveNativeAudioHelperPath(): string {
  const packaged = join(process.resourcesPath, "bin", "mac-audio-capture");
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return join(app.getAppPath(), "resources", "bin", "mac-audio-capture");
}

export function isMacOsSystemAudioSupported(): boolean {
  if (process.platform !== "darwin") return false;
  const darwinMajor = Number.parseInt(process.getSystemVersion().split(".")[0] ?? "0", 10);
  return !Number.isNaN(darwinMajor) && darwinMajor >= 14;
}

export class AudioCaptureCoordinator {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private systemActive = false;
  private systemError: string | undefined;
  private transcribingCount = 0;

  private readonly systemVad = new PcmVadFramer({
    sampleRate: SAMPLE_RATE,
    speechThreshold: 0.01,
    silenceFlushMs: 900,
    minSpeechMs: 450,
    maxUtteranceMs: 12000,
  });

  private readonly micVad = new PcmVadFramer({
    sampleRate: SAMPLE_RATE,
    speechThreshold: 0.014,
    silenceFlushMs: 850,
    minSpeechMs: 400,
    maxUtteranceMs: 12000,
  });

  constructor(
    private readonly store: LocalStore,
    private readonly onTranscript: (segment: TranscriptSegment) => void,
    private readonly onStatus: (status: AudioStatusEvent) => void,
    private readonly onError: (message: string) => void,
  ) {
    app.on("before-quit", () => {
      this.stopSystemAudio();
    });
  }

  getStatus(): AudioStatusEvent {
    return {
      systemActive: this.systemActive,
      systemSupported: isMacOsSystemAudioSupported() && existsSync(resolveNativeAudioHelperPath()),
      systemError: this.systemError,
      transcribingCount: this.transcribingCount,
    };
  }

  startSystemAudio(): AudioStatusEvent {
    if (this.proc) return this.getStatus();
    this.systemError = undefined;

    if (!isMacOsSystemAudioSupported()) {
      this.systemError = "Native system audio capture requires macOS 14.2 or later.";
      this.emitStatus();
      return this.getStatus();
    }

    const binPath = resolveNativeAudioHelperPath();
    if (!existsSync(binPath)) {
      this.systemError = "Native mac-audio-capture helper is not built. Run `npm run build:native`.";
      this.emitStatus();
      return this.getStatus();
    }

    this.systemVad.reset();
    const child = spawn(binPath, [
      "--sample-rate",
      String(SAMPLE_RATE),
      "--chunk-duration",
      "0.05",
    ]);
    this.proc = child;
    this.systemActive = true;
    this.emitStatus();

    child.stdout.on("data", (chunk: Buffer) => {
      const utterance = this.systemVad.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      if (utterance) {
        void this.dispatchTranscription("system", utterance);
      }
    });

    let stderrBuf = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { type?: string; message?: string };
          if (parsed.type === "error" && parsed.message) {
            this.systemError = parsed.message;
            this.onError(parsed.message);
            this.emitStatus();
          }
        } catch {
          // ignore non-JSON diagnostic lines
        }
      }
    });

    child.on("error", (err) => {
      this.systemActive = false;
      this.proc = null;
      this.systemError = err.message;
      this.onError(err.message);
      this.emitStatus();
    });

    child.on("exit", (code) => {
      if (this.proc === child) {
        this.proc = null;
      }
      this.systemActive = false;
      if (code && code !== 0 && !this.systemError) {
        this.systemError = `System audio helper exited with code ${code}.`;
      }
      this.emitStatus();
    });

    return this.getStatus();
  }

  stopSystemAudio(): AudioStatusEvent {
    const flushed = this.systemVad.flush();
    if (flushed) {
      void this.dispatchTranscription("system", flushed);
    }
    this.systemVad.reset();

    if (this.proc) {
      const target = this.proc;
      this.proc = null;
      target.kill("SIGTERM");
      setTimeout(() => {
        if (!target.killed) target.kill("SIGKILL");
      }, 2000);
    }
    this.systemActive = false;
    this.emitStatus();
    return this.getStatus();
  }

  ingestMicPcmBase64(base64Pcm: string): void {
    const raw = Buffer.from(base64Pcm, "base64");
    const utterance = this.micVad.push(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (utterance) {
      void this.dispatchTranscription("mic", utterance);
    }
  }

  flushMic(): void {
    const flushed = this.micVad.flush();
    if (flushed) {
      void this.dispatchTranscription("mic", flushed);
    }
    this.micVad.reset();
  }

  private async dispatchTranscription(source: AudioChannel, pcmBytes: Uint8Array): Promise<void> {
    this.transcribingCount += 1;
    this.emitStatus();
    try {
      const settings = this.store.getSettings();
      const segment = await transcribePcmUtterance({
        source,
        pcmBytes,
        sampleRate: SAMPLE_RATE,
        sttProvider: settings.sttProvider,
        getApiKey: (provider) => this.store.getApiKey(provider),
      });
      if (segment) {
        this.onTranscript(segment);
      }
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err));
    } finally {
      this.transcribingCount = Math.max(0, this.transcribingCount - 1);
      this.emitStatus();
    }
  }

  private emitStatus(): void {
    this.onStatus(this.getStatus());
  }
}
