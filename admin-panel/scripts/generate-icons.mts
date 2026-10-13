#!/usr/bin/env bun
// Fans the single brand source out to every surface that serves an icon; run with `bun run icons`.

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
const APP_ICON_SIZES = [192, 512] as const;
const APPLE_TOUCH_SIZE = 180;
const MASKABLE_SIZE = 512;
const WEBP_SIZE = 512;
const LOCKUP_WIDTH = 480;
const RANKING_LOGO_WIDTH = 320;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

type Output = [file: string, data: Buffer | string];

interface IcoImage {
  size: number;
  data: Buffer;
}

const ICON = await readFile(path.join(BRAND, 'icon.svg'));
const ICON_MASKABLE = await readFile(path.join(BRAND, 'icon-maskable.svg'));
const LOCKUP = await readFile(path.join(BRAND, 'logo-horizontal.svg'));

function squarePng(svg: Buffer, size: number): Promise<Buffer> {
  return sharp(svg, { density: DENSITY })
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function widthPng(svg: Buffer, width: number): Promise<Buffer> {
  return sharp(svg, { density: DENSITY }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
}

function widthWebp(svg: Buffer, width: number): Promise<Buffer> {
  return sharp(svg, { density: DENSITY }).resize({ width }).webp({ quality: 92 }).toBuffer();
}

// Packs PNG frames into the Vista+ PNG-in-ICO container.
function buildIco(images: IcoImage[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  const frames = images.map((image, index) => {
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

  return Buffer.concat([header, directory, ...frames]);
}

async function favicon(): Promise<Buffer> {
  const frames = await Promise.all(
    FAVICON_SIZES.map(async (size): Promise<IcoImage> => ({ size, data: await squarePng(ICON, size) })),
  );
  return buildIco(frames);
}

function panel(...parts: string[]): string {
  return path.join(PANEL, ...parts);
}

function repo(...parts: string[]): string {
  return path.join(REPO, ...parts);
}

async function nextAppIcons(ico: Buffer, appleTouch: Buffer): Promise<Output[]> {
  return [
    [panel('src', 'app', 'icon.svg'), ICON],
    [panel('src', 'app', 'favicon.ico'), ico],
    [panel('src', 'app', 'apple-icon.png'), appleTouch],
  ];
}

async function webIcons(ico: Buffer, appleTouch: Buffer): Promise<Output[]> {
  const appIcons = await Promise.all(
    APP_ICON_SIZES.map(
      async (size): Promise<Output> => [panel('public', 'brand', `icon-${size}.png`), await squarePng(ICON, size)],
    ),
  );
  return [
    [panel('public', 'brand', 'icon.svg'), ICON],
    [panel('public', 'brand', 'favicon.ico'), ico],
    ...appIcons,
    [panel('public', 'brand', `icon-maskable-${MASKABLE_SIZE}.png`), await squarePng(ICON_MASKABLE, MASKABLE_SIZE)],
    [panel('public', 'brand', 'apple-touch-icon.png'), appleTouch],
    [panel('public', 'brand', 'icon.webp'), await widthWebp(ICON, WEBP_SIZE)],
    [panel('public', 'brand', 'logo-horizontal.png'), await widthPng(LOCKUP, LOCKUP_WIDTH)],
    [panel('public', 'brand', 'logo-horizontal.webp'), await widthWebp(LOCKUP, LOCKUP_WIDTH)],
  ];
}

async function serviceIcons(ico: Buffer, rankingLogo: Buffer): Promise<Output[]> {
  return [
    [repo('ranking-web', 'static', 'img', 'favicon.ico'), ico],
    [repo('ranking-web', 'static', 'img', 'logo.png'), rankingLogo],
    [repo('src', 'cms', 'server', 'static', 'favicon.ico'), ico],
    [repo('src', 'cmsranking', 'static', 'img', 'favicon.ico'), ico],
    [repo('src', 'cmsranking', 'static', 'img', 'logo.png'), rankingLogo],
    [repo('src', 'cmsranking', 'images', 'logo.svg'), LOCKUP],
  ];
}

async function put(file: string, data: Buffer | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

async function main(): Promise<void> {
  const ico = await favicon();
  const appleTouch = await squarePng(ICON_MASKABLE, APPLE_TOUCH_SIZE);
  const rankingLogo = await widthPng(LOCKUP, RANKING_LOGO_WIDTH);

  const outputs = [
    ...(await nextAppIcons(ico, appleTouch)),
    ...(await webIcons(ico, appleTouch)),
    ...(await serviceIcons(ico, rankingLogo)),
  ];

  for (const [file, data] of outputs) {
    await put(file, data);
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    console.log(`  ${path.relative(REPO, file)}  ${bytes} B`);
  }

  console.log(`\nWrote ${outputs.length} assets from assets/brand.`);
}

await main();
