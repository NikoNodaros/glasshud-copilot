/**
 * Encodes little-endian signed 16-bit PCM bytes into a standard 44-byte RIFF/WAV buffer.
 */
export function encodePcm16ToWav(
  pcmBytes: Uint8Array,
  sampleRate = 16000,
  numChannels = 1,
): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBytes.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Computes normalized RMS energy in [0, 1] for a little-endian Int16 PCM buffer.
 */
export function computePcm16Rms(pcmBytes: Uint8Array): number {
  const sampleCount = Math.floor(pcmBytes.byteLength / 2);
  if (sampleCount === 0) return 0;
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, sampleCount * 2);
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const normalized = view.getInt16(i * 2, true) / 32768;
    sumSq += normalized * normalized;
  }
  return Math.sqrt(sumSq / sampleCount);
}

export interface VadFramerOptions {
  sampleRate?: number;
  speechThreshold?: number;
  silenceFlushMs?: number;
  minSpeechMs?: number;
  maxUtteranceMs?: number;
  preRollMs?: number;
}

/**
 * Stateful Voice Activity Detection (VAD) utterance framer for 16-bit mono PCM streams.
 * Accumulates speech chunks with a pre-roll buffer and flushes complete utterances on
 * pause or max duration.
 */
export class PcmVadFramer {
  private readonly sampleRate: number;
  private readonly speechThreshold: number;
  private readonly silenceFlushMs: number;
  private readonly minSpeechMs: number;
  private readonly maxUtteranceMs: number;
  private readonly preRollMaxBytes: number;

  private preRoll: Uint8Array[] = [];
  private preRollBytes = 0;
  private activeChunks: Uint8Array[] = [];
  private activeBytes = 0;
  private speechMs = 0;
  private trailingSilenceMs = 0;
  private inSpeech = false;

  constructor(options: VadFramerOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16000;
    this.speechThreshold = options.speechThreshold ?? 0.012;
    this.silenceFlushMs = options.silenceFlushMs ?? 850;
    this.minSpeechMs = options.minSpeechMs ?? 400;
    this.maxUtteranceMs = options.maxUtteranceMs ?? 12000;
    const preRollMs = options.preRollMs ?? 250;
    this.preRollMaxBytes = Math.floor((this.sampleRate * 2 * preRollMs) / 1000);
  }

  push(chunk: Uint8Array): Uint8Array | null {
    if (chunk.byteLength < 2) return null;
    const chunkMs = (chunk.byteLength / 2 / this.sampleRate) * 1000;
    const rms = computePcm16Rms(chunk);
    const isVoice = rms >= this.speechThreshold;

    if (!this.inSpeech) {
      if (isVoice) {
        this.inSpeech = true;
        this.activeChunks = [...this.preRoll, chunk];
        this.activeBytes = this.preRollBytes + chunk.byteLength;
        this.preRoll = [];
        this.preRollBytes = 0;
        this.speechMs = chunkMs;
        this.trailingSilenceMs = 0;
      } else {
        this.preRoll.push(chunk);
        this.preRollBytes += chunk.byteLength;
        while (this.preRollBytes > this.preRollMaxBytes && this.preRoll.length > 1) {
          const dropped = this.preRoll.shift()!;
          this.preRollBytes -= dropped.byteLength;
        }
      }
      return null;
    }

    this.activeChunks.push(chunk);
    this.activeBytes += chunk.byteLength;

    if (isVoice) {
      this.speechMs += chunkMs;
      this.trailingSilenceMs = 0;
    } else {
      this.trailingSilenceMs += chunkMs;
    }

    const totalMs = (this.activeBytes / 2 / this.sampleRate) * 1000;
    if (this.trailingSilenceMs >= this.silenceFlushMs || totalMs >= this.maxUtteranceMs) {
      return this.flushInternal();
    }
    return null;
  }

  flush(): Uint8Array | null {
    if (!this.inSpeech) return null;
    return this.flushInternal();
  }

  reset(): void {
    this.preRoll = [];
    this.preRollBytes = 0;
    this.activeChunks = [];
    this.activeBytes = 0;
    this.speechMs = 0;
    this.trailingSilenceMs = 0;
    this.inSpeech = false;
  }

  private flushInternal(): Uint8Array | null {
    const enoughSpeech = this.speechMs >= this.minSpeechMs;
    const chunks = this.activeChunks;
    const totalBytes = this.activeBytes;
    this.activeChunks = [];
    this.activeBytes = 0;
    this.speechMs = 0;
    this.trailingSilenceMs = 0;
    this.inSpeech = false;

    if (!enoughSpeech || totalBytes === 0) return null;
    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
}
