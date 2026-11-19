import { describe, expect, it } from "vitest";
import { computePcm16Rms, encodePcm16ToWav, PcmVadFramer } from "../src/shared/wav";

function makePcmChunk(sampleCount: number, amplitude: number): Uint8Array {
  const buf = new ArrayBuffer(sampleCount * 2);
  const view = new DataView(buf);
  for (let i = 0; i < sampleCount; i++) {
    const val = Math.round(Math.sin((i / 20) * Math.PI * 2) * amplitude * 32767);
    view.setInt16(i * 2, val, true);
  }
  return new Uint8Array(buf);
}

describe("WAV encoding and VAD framing", () => {
  it("encodes valid RIFF/WAVE header around PCM16 data", () => {
    const pcm = makePcmChunk(800, 0.25); // 50ms at 16kHz
    const wav = encodePcm16ToWav(pcm, 16000, 1);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const riff = String.fromCharCode(...wav.slice(0, 4));
    const wave = String.fromCharCode(...wav.slice(8, 12));
    const data = String.fromCharCode(...wav.slice(36, 40));

    expect(riff).toBe("RIFF");
    expect(wave).toBe("WAVE");
    expect(data).toBe("data");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
  });

  it("computes normalized RMS loudness", () => {
    const silence = makePcmChunk(800, 0);
    const loud = makePcmChunk(800, 0.5);
    expect(computePcm16Rms(silence)).toBe(0);
    expect(computePcm16Rms(loud)).toBeGreaterThan(0.3);
    expect(computePcm16Rms(loud)).toBeLessThan(0.45);
  });

  it("frames speech utterances with pre-roll and flushes on trailing silence", () => {
    const vad = new PcmVadFramer({
      sampleRate: 16000,
      speechThreshold: 0.02,
      silenceFlushMs: 200,
      minSpeechMs: 150,
      preRollMs: 100,
    });

    const silence50ms = makePcmChunk(800, 0.001);
    const voice50ms = makePcmChunk(800, 0.3);

    // 2 pre-roll silence frames
    expect(vad.push(silence50ms)).toBeNull();
    expect(vad.push(silence50ms)).toBeNull();

    // 4 voice frames (200ms speech > 150ms min)
    for (let i = 0; i < 4; i++) {
      expect(vad.push(voice50ms)).toBeNull();
    }

    // 3 silence frames (150ms < 200ms)
    expect(vad.push(silence50ms)).toBeNull();
    expect(vad.push(silence50ms)).toBeNull();
    expect(vad.push(silence50ms)).toBeNull();

    // 4th silence frame hits 200ms -> flushes utterance including pre-roll!
    const utterance = vad.push(silence50ms);
    expect(utterance).not.toBeNull();
    // 2 pre-roll + 4 voice + 4 silence = 10 frames * 1600 bytes
    expect(utterance!.byteLength).toBe(10 * 1600);
  });
});
