import { useCallback, useEffect, useRef, useState } from "react";

const TARGET_RATE = 16000;

function downsampleToInt16(input: Float32Array, sourceRate: number): Int16Array {
  if (sourceRate === TARGET_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = sourceRate / TARGET_RATE;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[Math.min(idx, input.length - 1)];
    const s1 = input[Math.min(idx + 1, input.length - 1)];
    const val = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
    out[i] = val < 0 ? val * 0x8000 : val * 0x7fff;
  }
  return out;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function useMicCapture() {
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);

  const stopMic = useCallback(() => {
    procRef.current?.disconnect();
    procRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    window.glassApi.audio.flushMic();
    setMicActive(false);
    setMicLevel(0);
  }, []);

  const startMic = useCallback(async () => {
    if (streamRef.current) return;
    setMicError(null);
    try {
      const granted = await window.glassApi.permissions.requestMic();
      if (!granted) {
        setMicError("Microphone permission denied. Enable it in System Settings.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const ctx = new AudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const source = ctx.createMediaStreamSource(stream);
      // 4096 samples at 48kHz ~= 85ms frames; stable across Electron Chromium builds
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) {
          sumSq += input[i] * input[i];
        }
        const rms = Math.sqrt(sumSq / Math.max(1, input.length));
        setMicLevel(Math.min(1, rms * 6));

        const pcm16 = downsampleToInt16(input, ctx.sampleRate);
        window.glassApi.audio.sendMicPcmBase64(int16ToBase64(pcm16));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      streamRef.current = stream;
      ctxRef.current = ctx;
      procRef.current = processor;
      setMicActive(true);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : "Failed to start microphone capture.");
      stopMic();
    }
  }, [stopMic]);

  useEffect(() => {
    return () => {
      stopMic();
    };
  }, [stopMic]);

  return { micActive, micLevel, micError, startMic, stopMic };
}
