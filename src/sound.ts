import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import * as vscode from "vscode";

export interface SoundPlayResult {
  played: boolean;
  strategy: string;
}

export async function playFaahSound(context: vscode.ExtensionContext): Promise<SoundPlayResult> {
  const wavPath = await ensureWavFile(context);

  if (process.platform === "win32") {
    const played = await tryWindowsSoundPlayer(wavPath);
    return { played, strategy: played ? "windows-powershell" : "none" };
  }

  if (process.platform === "darwin") {
    const played = await trySpawn("afplay", [wavPath]);
    return { played, strategy: played ? "afplay" : "none" };
  }

  const linuxStrategies: Array<{ command: string; args: string[]; name: string }> = [
    { command: "paplay", args: [wavPath], name: "paplay" },
    { command: "aplay", args: [wavPath], name: "aplay" },
    { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", wavPath], name: "ffplay" },
    { command: "play", args: ["-q", wavPath], name: "sox-play" }
  ];

  for (const strategy of linuxStrategies) {
    if (await trySpawn(strategy.command, strategy.args)) {
      return { played: true, strategy: strategy.name };
    }
  }

  return { played: false, strategy: "none" };
}

async function ensureWavFile(context: vscode.ExtensionContext): Promise<string> {
  const dir = context.globalStorageUri.fsPath;
  const filePath = path.join(dir, "faah.wav");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, buildFaahWave(), { flag: "w" });
  return filePath;
}

function buildFaahWave(): Buffer {
  const sampleRate = 44100;
  const durationSeconds = 0.42;
  const totalSamples = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2;
  const dataSize = totalSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  let offset = 0;
  buffer.write("RIFF", offset);
  offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset);
  offset += 4;
  buffer.write("WAVE", offset);
  offset += 4;
  buffer.write("fmt ", offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(sampleRate * bytesPerSample, offset);
  offset += 4;
  buffer.writeUInt16LE(bytesPerSample, offset);
  offset += 2;
  buffer.writeUInt16LE(16, offset);
  offset += 2;
  buffer.write("data", offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.sin(Math.min(1, t / durationSeconds) * Math.PI);
    const drop = 660 - 280 * (t / durationSeconds);
    const carrier = Math.sin(2 * Math.PI * drop * t);
    const body = Math.sin(2 * Math.PI * (drop * 0.5) * t) * 0.35;
    const amplitude = 0.35 * envelope;
    const sample = Math.max(-1, Math.min(1, (carrier * 0.85 + body) * amplitude));
    buffer.writeInt16LE(Math.round(sample * 32767), offset + i * bytesPerSample);
  }

  return buffer;
}

async function tryWindowsSoundPlayer(wavPath: string): Promise<boolean> {
  const script = [
    `$path = '${escapeSingleQuotes(wavPath)}'`,
    "$player = New-Object System.Media.SoundPlayer $path",
    "$player.PlaySync()"
  ].join("; ");

  if (await trySpawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])) {
    return true;
  }

  return trySpawn("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

async function trySpawn(command: string, args: string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "''");
}
