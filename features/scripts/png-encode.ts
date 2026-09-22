import { deflateSync } from "node:zlib";

/**
 * Minimal PNG encoder for rasterized script pages (no image library needed).
 * Accepts pdfium's bitmap output: 1 byte/px grayscale or 4 bytes/px BGRA.
 * Grayscale is what scans are, and it's ~3× smaller than RGB.
 */
export function encodePng(
  data: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 4,
): Buffer {
  if (data.length < width * height * channels) {
    throw new Error("encodePng: bitmap is smaller than width × height × channels");
  }
  const outChannels = channels === 1 ? 1 : 3;
  const rowLen = width * outChannels + 1; // +1 filter byte
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0; // filter: none
    if (channels === 1) {
      raw.set(data.subarray(y * width, (y + 1) * width), rowStart + 1);
    } else {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const o = rowStart + 1 + x * 3;
        raw[o] = data[i + 2]; // R (input is BGRA)
        raw[o + 1] = data[i + 1]; // G
        raw[o + 2] = data[i]; // B
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : 2; // colour type: 0 = gray, 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
