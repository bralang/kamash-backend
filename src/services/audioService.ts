import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HttpError } from "../lib/httpError.js";
import { logger } from "../lib/logger.js";

// ffmpeg-static is CJS whose module.exports IS the path string, but its bundled
// .d.ts declares a default export, which TS under NodeNext mistypes for an ESM
// default import — so load it with require() and type it ourselves.
const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string | null;

const execFileAsync = promisify(execFile);

// Whisper rejects uploads over 25MB, while our own upload cap is 100MB.
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Returns audio that fits under Whisper's size limit: small files pass through
 * untouched; oversized ones are re-encoded to Ogg/Opus 32kbps mono 16kHz, which
 * keeps any recording of a plausible session length well under the limit.
 */
export async function ensureTranscribable(
  buffer: Buffer,
  filename: string,
  opts: { maxBytes?: number } = {}, // maxBytes overridable only for tests
): Promise<{ buffer: Buffer; filename: string }> {
  const maxBytes = opts.maxBytes ?? WHISPER_MAX_BYTES;
  if (buffer.length <= maxBytes) {
    return { buffer, filename };
  }

  if (!ffmpegPath) {
    throw new HttpError(500, "ffmpeg binary not available");
  }

  // ffmpeg works on temp files rather than stdin/stdout: some containers we accept
  // (m4a/mp4) need seekable input, and the input extension lets the demuxer pick
  // the right container.
  const dir = await mkdtemp(path.join(os.tmpdir(), "kamash-audio-"));
  try {
    const inputPath = path.join(dir, `input${path.extname(filename) || ".bin"}`);
    const outputPath = path.join(dir, "output.ogg");
    await writeFile(inputPath, buffer);

    try {
      await execFileAsync(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel", "error",
          "-y",
          "-i", inputPath,
          "-vn",
          "-map_metadata", "-1",
          "-ac", "1",
          "-ar", "16000",
          "-c:a", "libopus",
          "-b:a", "32k",
          "-application", "voip",
          outputPath,
        ],
        { timeout: 5 * 60_000, killSignal: "SIGKILL" },
      );
    } catch (err) {
      logger.error({ err, filename }, "ffmpeg compression failed");
      throw new HttpError(500, "Audio compression failed — the file may be corrupt or in an unsupported encoding");
    }

    const compressed = await readFile(outputPath);
    if (compressed.length > maxBytes) {
      throw new HttpError(
        413,
        "Audio file is too large to transcribe even after compression. Please upload a shorter recording.",
      );
    }

    logger.info(
      { filename, originalBytes: buffer.length, compressedBytes: compressed.length },
      "compressed oversized audio for transcription",
    );
    return { buffer: compressed, filename: `${path.parse(filename).name}.ogg` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
