import { describe, it, expect } from "vitest";
import { ensureTranscribable } from "../src/services/audioService.js";
import { HttpError } from "../src/lib/httpError.js";

// Minimal valid RIFF/PCM WAV: 44-byte header + zeroed 16-bit 16kHz mono samples.
function makeWav(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24); // sample rate
  header.writeUInt32LE(16000 * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

describe("ensureTranscribable", () => {
  it("passes small files through untouched", async () => {
    const wav = makeWav(1024);
    const result = await ensureTranscribable(wav, "recording.wav");
    expect(result.buffer).toBe(wav);
    expect(result.filename).toBe("recording.wav");
  });

  it("compresses oversized files to a smaller .ogg", { timeout: 15_000 }, async () => {
    const wav = makeWav(64 * 1024);
    const result = await ensureTranscribable(wav, "recording.wav", { maxBytes: 20_000 });
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.buffer.length).toBeLessThan(wav.length);
    expect(result.filename).toBe("recording.ogg");
  });

  it("rejects with 413 when even the compressed output is too large", { timeout: 15_000 }, async () => {
    const wav = makeWav(64 * 1024);
    const err = await ensureTranscribable(wav, "recording.wav", { maxBytes: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(413);
  });

  it("rejects with 500 when the input is not decodable audio", { timeout: 15_000 }, async () => {
    const junk = Buffer.concat([Buffer.from("not audio"), Buffer.alloc(100)]);
    const err = await ensureTranscribable(junk, "bad.mp3", { maxBytes: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(500);
  });
});
