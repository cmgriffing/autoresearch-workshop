/**
 * Minimal PNG decoder (8-bit RGB / RGBA, non-interlaced — what Chromium
 * screenshots produce) plus the 12×12 perceptual grid used by the hero check.
 */

import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length; // length + type + data + crc
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`unsupported PNG color type ${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  let prev = new Uint8Array(stride);

  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    switch (filter) {
      case 0:
        cur.set(line);
        break;
      case 1:
        for (let i = 0; i < stride; i += 1) {
          cur[i] = (line[i] + (i >= channels ? cur[i - channels] : 0)) & 0xff;
        }
        break;
      case 2:
        for (let i = 0; i < stride; i += 1) {
          cur[i] = (line[i] + prev[i]) & 0xff;
        }
        break;
      case 3:
        for (let i = 0; i < stride; i += 1) {
          const a = i >= channels ? cur[i - channels] : 0;
          cur[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i += 1) {
          const a = i >= channels ? cur[i - channels] : 0;
          const b = prev[i];
          const c = i >= channels ? prev[i - channels] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          cur[i] = (line[i] + pred) & 0xff;
        }
        break;
      default:
        throw new Error(`unsupported PNG filter ${filter}`);
    }
    prev = cur;
  }

  return { width, height, channels, data: out };
}

/** Mean RGB per cell, averaged over the cell's pixels. */
export function downsampleGrid(image, cells = 12) {
  const { width, height, channels, data } = image;
  const grid = [];
  for (let cy = 0; cy < cells; cy += 1) {
    const y0 = Math.floor((cy * height) / cells);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / cells));
    for (let cx = 0; cx < cells; cx += 1) {
      const x0 = Math.floor((cx * width) / cells);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / cells));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * channels;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      grid.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
    }
  }
  return grid;
}

/** Mean absolute per-channel distance between two grids (0–255). */
export function gridDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      sum += Math.abs(a[i][c] - b[i][c]);
      n += 1;
    }
  }
  return sum / n;
}

export async function screenshotGrid(elementHandle, cells = 12) {
  const buffer = await elementHandle.screenshot({ type: 'png' });
  return downsampleGrid(decodePng(buffer), cells);
}
