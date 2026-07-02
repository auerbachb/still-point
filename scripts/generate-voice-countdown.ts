/**
 * One-off script: generate final-minute voice countdown clips via ElevenLabs.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... npx tsx scripts/generate-voice-countdown.ts
 *
 * Optional env:
 *   ELEVENLABS_VOICE_ID  — defaults to Adam (deep male)
 *   ELEVENLABS_MODEL_ID  — defaults to eleven_multilingual_v2
 *
 * Writes mp3 files to public/audio/voice-countdown/{1..60}.mp3
 * (filename = remaining seconds spoken at that moment).
 *
 * Without ELEVENLABS_API_KEY, falls back to espeak-ng if installed (dev placeholders only).
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "audio", "voice-countdown");
const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam — deep, calm male
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

/** Spoken label for each remaining-second value (1–60). */
function spokenLabel(seconds: number): string {
  if (seconds === 1) return "one";
  return String(seconds);
}

async function generateWithElevenLabs(
  apiKey: string,
  voiceId: string,
  modelId: string,
  text: string,
): Promise<ArrayBuffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.65, similarity_boost: 0.75, style: 0.2 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }

  return res.arrayBuffer();
}

function generateWithEspeak(text: string, outPath: string): void {
  execSync(`espeak-ng -v en-us+m3 -s 130 -p 20 -a 80 -w "${outPath}.wav" "${text}"`, {
    stdio: "inherit",
  });
  execSync(
    `ffmpeg -y -i "${outPath}.wav" -codec:a libmp3lame -qscale:a 6 "${outPath}.mp3"`,
    { stdio: "inherit" },
  );
  execSync(`rm -f "${outPath}.wav"`);
}

function hasEspeak(): boolean {
  try {
    execSync("which espeak-ng", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasFfmpeg(): boolean {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID;

  mkdirSync(OUT_DIR, { recursive: true });

  const mode = apiKey ? "elevenlabs" : hasEspeak() && hasFfmpeg() ? "espeak-fallback" : null;
  if (!mode) {
    console.error(
      "No ELEVENLABS_API_KEY and espeak-ng/ffmpeg fallback unavailable.\n" +
        "Install espeak-ng and ffmpeg for dev placeholders, or set ELEVENLABS_API_KEY for production clips.",
    );
    process.exit(1);
  }

  if (mode === "espeak-fallback") {
    console.warn(
      "⚠️  ELEVENLABS_API_KEY not set — generating espeak-ng placeholder clips.\n" +
        "   Re-run with a real key before shipping production assets.",
    );
  } else {
    console.log(`Generating with ElevenLabs voice ${voiceId} → ${OUT_DIR}`);
  }

  for (let seconds = 60; seconds >= 1; seconds--) {
    const label = spokenLabel(seconds);
    const outPath = join(OUT_DIR, `${seconds}.mp3`);

    if (existsSync(outPath) && process.env.FORCE !== "1") {
      console.log(`skip ${seconds}.mp3 (exists)`);
      continue;
    }

    process.stdout.write(`${seconds}.mp3 ("${label}")… `);

    if (mode === "elevenlabs") {
      const buf = await generateWithElevenLabs(apiKey!, voiceId, modelId, label);
      writeFileSync(outPath, Buffer.from(buf));
    } else {
      generateWithEspeak(label, outPath.replace(/\.mp3$/, ""));
    }

    console.log("done");

    // Gentle rate limit for ElevenLabs free tier
    if (mode === "elevenlabs") {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  console.log(`\n✓ Wrote 60 clips to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
