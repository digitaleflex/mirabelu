import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AudioError, normalizeToStream, probe, sha256File } from '../src/index.js';

let dir: string;
let src: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-'));
  src = join(dir, 'src.mp3');
  // 12 s de stéréo 44,1 kHz + deux chapitres via un fichier de métadonnées FFMETADATA.
  const meta = join(dir, 'meta.txt');
  writeFileSync(
    meta,
    ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=5000\ntitle=Introduction\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=5000\nEND=12000\ntitle=Idées clés\n',
  );
  const wav = join(dir, 'tone.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-ac', '2', '-ar', '44100', wav]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-i', meta, '-map_metadata', '1', '-map_chapters', '1', '-b:a', '128k', src]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('audio', () => {
  it('probe lit durée, codec et chapitres', async () => {
    const p = await probe(src);
    expect(p.durationSec).toBeGreaterThanOrEqual(12);
    expect(p.durationSec).toBeLessThanOrEqual(13);
    expect(p.codec).toBe('mp3');
    expect(p.channels).toBe(2);
    expect(p.chapters.map((c) => c.title)).toEqual(['Introduction', 'Idées clés']);
    expect(p.chapters[1]?.startSec).toBe(5);
  });

  it('normalise en AAC mono 64 kbps .m4a faststart avec chapitres', async () => {
    const out = join(dir, 'out.m4a');
    await normalizeToStream(src, out, { bitrateKbps: 64 });
    const p = await probe(out);
    expect(p.codec).toBe('aac');
    expect(p.channels).toBe(1);
    expect(p.sampleRate).toBe(44100);
    expect(p.bitrateKbps).toBeGreaterThan(40);
    expect(p.bitrateKbps).toBeLessThan(90);
    expect(Math.abs(p.durationSec - 12)).toBeLessThanOrEqual(1);
    expect(p.chapters.length).toBe(2);
    // faststart : l'atome moov précède mdat
    const buf = readFileSync(out);
    expect(buf.indexOf('moov')).toBeGreaterThan(0);
    expect(buf.indexOf('moov')).toBeLessThan(buf.indexOf('mdat'));
  }, 60_000);

  it('sha256 est stable et correct', async () => {
    const f = join(dir, 'h.txt');
    writeFileSync(f, 'abc');
    expect(await sha256File(f)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('un fichier non audio est refusé de façon permanente', async () => {
    const bad = join(dir, 'bad.mp3');
    writeFileSync(bad, 'ceci n’est pas de l’audio');
    const e = (await probe(bad).catch((x: unknown) => x)) as AudioError;
    expect(e).toBeInstanceOf(AudioError);
    expect(e.permanent).toBe(true);
  });

  it('binaire absent = erreur non permanente', async () => {
    const e = (await probe(src, { ffmpegPath: 'x', ffprobePath: '/nonexistent/ffprobe' }).catch((x: unknown) => x)) as AudioError;
    expect(e.permanent).toBe(false);
  });
});
