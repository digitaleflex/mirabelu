import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export interface AudioTools {
  ffmpegPath: string;
  ffprobePath: string;
}

export const DEFAULT_TOOLS: AudioTools = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' };

export class AudioError extends Error {
  constructor(
    message: string,
    /** true = le fichier source est inexploitable (inutile de réessayer). */
    readonly permanent = false,
  ) {
    super(message);
    this.name = 'AudioError';
  }
}

function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : undefined;
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(new AudioError(`${cmd} introuvable ou non exécutable : ${e.message}`));
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new AudioError(`${cmd} a échoué (${signal ?? `code ${code}`}) : ${stderr.trim().split('\n').slice(-3).join(' | ')}`, true));
    });
  });
}

export interface ProbeResult {
  durationSec: number;
  codec: string;
  bitrateKbps: number | null;
  sampleRate: number | null;
  channels: number | null;
  formatName: string;
  chapters: { title: string; startSec: number; endSec: number }[];
}

export async function probe(path: string, tools: AudioTools = DEFAULT_TOOLS): Promise<ProbeResult> {
  const { stdout } = await run(tools.ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', path,
  ], { timeoutMs: 120_000 });
  const j = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; bit_rate?: string }[];
    chapters?: { start_time?: string; end_time?: string; tags?: { title?: string } }[];
  };
  const audio = j.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) throw new AudioError('Aucune piste audio dans le fichier', true);
  const duration = Number(j.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new AudioError('Durée audio illisible ou nulle', true);
  const br = Number(audio.bit_rate ?? j.format?.bit_rate);
  return {
    durationSec: Math.round(duration),
    codec: audio.codec_name ?? 'unknown',
    bitrateKbps: Number.isFinite(br) && br > 0 ? Math.round(br / 1000) : null,
    sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio.channels ?? null,
    formatName: j.format?.format_name ?? '',
    chapters: (j.chapters ?? []).map((c, i) => ({
      title: c.tags?.title?.trim() || `Chapitre ${i + 1}`,
      startSec: Math.max(0, Math.floor(Number(c.start_time) || 0)),
      endSec: Math.max(0, Math.ceil(Number(c.end_time) || 0)),
    })),
  };
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

export interface NormalizeOptions {
  bitrateKbps: number;
  /** Cible LUFS pour la normalisation de volume (loudnorm). */
  loudnessLufs?: number;
  timeoutMs?: number;
}

/**
 * Produit le format de diffusion unique : AAC-LC mono dans un conteneur .m4a (faststart pour le
 * démarrage rapide et le « seek » par Range), volume normalisé. Les chapitres sont conservés.
 */
export async function normalizeToStream(
  input: string,
  output: string,
  opts: NormalizeOptions,
  tools: AudioTools = DEFAULT_TOOLS,
): Promise<void> {
  const lufs = opts.loudnessLufs ?? -16;
  await run(
    tools.ffmpegPath,
    [
      '-hide_banner', '-nostdin', '-y',
      '-i', input,
      '-vn', '-map', '0:a:0',
      '-map_metadata', '0', '-map_chapters', '0',
      '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11`,
      '-ac', '1', '-ar', '44100',
      '-c:a', 'aac', '-b:a', `${opts.bitrateKbps}k`,
      '-movflags', '+faststart',
      '-f', 'ipod',
      output,
    ],
    { timeoutMs: opts.timeoutMs ?? 6 * 3600_000 },
  );
}
