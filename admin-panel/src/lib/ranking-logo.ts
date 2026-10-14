import path from 'path';

import { IMAGE_EXTENSIONS, normalizeImageExtension, type ImageExtension } from '@/lib/asset-upload';
import { HOST_ASSETS_CONFIG_DIR } from '@/lib/ranking-paths';

/** The config.toml section that owns every ranking key the panel writes. */
const ADMIN_SECTION = 'admin';

/** The key the service reads the logo stem from. */
const LOGO_PATH_KEY = 'RANKING_LOGO_PATH';

/** Every `logo.<ext>` name the upload surface probes, in the order the service tries them. */
export function logoFileNames(): readonly string[] {
  return IMAGE_EXTENSIONS.map((extension) => `logo.${extension}`);
}

/** The host-side path a stored logo is mirrored to, or '' when no logo is stored. */
export function logoPathValue(extension: ImageExtension | null): string {
  return extension === null ? '' : `${HOST_ASSETS_CONFIG_DIR}/logo.${extension}`;
}

/** The stored extension an upload's filename selects, or null when it names no accepted format. */
export function logoExtension(fileName: string): ImageExtension | null {
  const base = path.basename(fileName);
  const dot = base.lastIndexOf('.');
  return normalizeImageExtension(dot === -1 ? '' : base.slice(dot + 1));
}

/**
 * Returns config.toml content with the logo path set inside its own section.
 *
 * Why the section is named rather than matched anywhere in the file: RANKING_LOGO_PATH
 * lives in [admin], but a file-wide replace would rewrite a same-named key in another
 * section and leave the one the service reads untouched.
 */
export function setLogoPath(content: string, extension: ImageExtension | null): string {
  const value = logoPathValue(extension);
  const lines = content.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim() === `[${ADMIN_SECTION}]`);
  const newLine = `${LOGO_PATH_KEY} = ${formatTomlString(value)}`;

  if (headerIndex === -1) {
    const separator = content.endsWith('\n') ? '' : '\n';
    return `${content}${separator}\n[${ADMIN_SECTION}]\n${newLine}\n`;
  }

  const keyPattern = new RegExp(`^\\s*${LOGO_PATH_KEY}\\s*=`);
  const sectionEnd = findSectionEnd(lines, headerIndex);
  for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
    if (keyPattern.test(lines[index])) {
      lines[index] = newLine;
      return lines.join('\n');
    }
  }

  lines.splice(sectionEnd, 0, newLine);
  return lines.join('\n');
}

function findSectionEnd(lines: readonly string[], headerIndex: number): number {
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) return index;
  }
  return lines.length;
}

function formatTomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
