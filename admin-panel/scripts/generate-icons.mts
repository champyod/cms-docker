#!/usr/bin/env bun
/**
 * Generates every favicon, app icon and web image from the single brand source
 * in admin-panel/assets/brand, then places them where each surface serves them.
 *
 * Source of truth: assets/brand/icon.svg (the mark) and logo-horizontal.svg.
 * Run: bun run icons   (from admin-panel/)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.resolve(HERE, '..');
const REPO = path.resolve(PANEL, '..');
const BRAND = path.join(PANEL, 'assets', 'brand');

const DENSITY = 384;
const FAVICON_SIZES = [16, 32, 48] as const;
const APPLE_TOUCH_SIZE = 180;

const ICON = await readFile(path.join(BRAND, 'icon.svg'));
const ICON_MASKABLE = await readFile(path.join(BRAND, 'icon-maskable.svg'));
const LOCKUP = await readFile(path.join(BRAND, 'logo-horizontal.svg'));

function squarePng(svg: Buffer, size: number): Promise<Buffer> {
  return sharp(svg, { density: DENSITY })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function widthPng(svg: Buffer, width: number): Promise<Buffer> {
  return sharp(svg, { density: DENSITY }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
}

function widthWebp(svg: Buffer, width: number): Promise<Buffer> {
  return sharp(svg, { density: DENSITY }).resize({ width }).webp({ quality: 92 }).toBuffer();
}

interface IcoImage {
  size: number;
  data: Buffer;
}

/** Packs PNG-encoded images into a multi-size .ico (the Vista+ PNG-in-ICO container). */
function buildIco(images: IcoImage[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  const blobs = images.map((image, index) => {
    const entry = 16 * index;
    const dimension = image.size >= 256 ? 0 : image.size;
    directory.writeUInt8(dimension, entry);
    directory.writeUInt8(dimension, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
    return image.data;
  });

  return Buffer.concat([header, directory, ...blobs]);
}

function favicon(): Promise<Buffer> {
  return Promise.all(FAVICON_SIZES.map(async (size) => ({ size, data: await squarePng(ICON, size) })))
    .then((images) => buildIco(images.map((image) => ({ size: image.size, data: image.data }))));
}

async function put(file: string, data: Buffer | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

function panel(...parts: string[]): string {
  return path.join(PANEL, ...parts);
}

function repo(...parts: string[]): string {
  return path.join(REPO, ...parts);
}

async function main(): Promise<void> {
  const ico = await favicon();
  const apple = await squarePng(ICON_MASKABLE, APPLE_TOUCH_SIZE);
  const lockupPng = await widthPng(LOCKUP, 480);
  const lockupWebp = await widthWebp(LOCKUP, 480);
  const lockupRanking = await widthPng(LOCKUP, 320);

  const outputs: Array<[string, Buffer | string]> = [
    // Next.js app-directory file conventions (auto-emitted <link> tags).
    [panel('src', 'app', 'icon.svg'), ICON],
    [panel('src', 'app', 'favicon.ico'), ico],
    [panel('src', 'app', 'apple-icon.png'), apple],

    // Public assets for the web app manifest and general linking.
    [panel('public', 'brand', 'icon.svg'), ICON],
    [panel('public', 'brand', 'favicon.ico'), ico],
    [panel('public', 'brand', 'icon-192.png'), await squarePng(ICON, 192)],
    [panel('public', 'brand', 'icon-512.png'), await squarePng(ICON, 512)],
    [panel('public', 'brand', 'icon-maskable-512.png'), await squarePng(ICON_MASKABLE, 512)],
    [panel('public', 'brand', 'apple-touch-icon.png'), apple],
    [panel('public', 'brand', 'icon.webp'), await widthWebp(ICON, 512)],
    [panel('public', 'brand', 'logo-horizontal.png'), lockupPng],
    [panel('public', 'brand', 'logo-horizontal.webp'), lockupWebp],

    // Public ranking board (Rust ranking-web): favicon plus the vendored logo fallback.
    [repo('ranking-web', 'static', 'img', 'favicon.ico'), ico],
    [repo('ranking-web', 'static', 'img', 'logo.png'), lockupRanking],

    // Legacy contest/admin web interface served by the Python core.
    [repo('src', 'cms', 'server', 'static', 'favicon.ico'), ico],

    // Legacy Python ranking board, kept in step while it remains in the tree.
    [repo('src', 'cmsranking', 'static', 'img', 'favicon.ico'), ico],
    [repo('src', 'cmsranking', 'static', 'img', 'logo.png'), lockupRanking],
    [repo('src', 'cmsranking', 'images', 'logo.svg'), LOCKUP],
  ];

  for (const [file, data] of outputs) {
    await put(file, data);
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    console.log(`  ${path.relative(REPO, file)}  ${size} B`);
  }

  console.log(`\nWrote ${outputs.length} assets from assets/brand.`);
}

await main();
