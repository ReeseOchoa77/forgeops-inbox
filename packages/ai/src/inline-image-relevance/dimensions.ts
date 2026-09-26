export type ImageDimensions = { width: number; height: number };

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readPng(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readGif(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 10) return null;
  const sig = bytes.toString("ascii", 0, 6);
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function readJpeg(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) return null;
    if (SOF_MARKERS.has(marker)) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) return null;
    i += 2 + length;
  }
  return null;
}

function readWebp(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 30) return null;
  if (bytes.toString("ascii", 0, 4) !== "RIFF") return null;
  if (bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return { width, height };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    const start = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (start < 0 || start + 7 > bytes.length) return null;
    const width = bytes.readUInt16LE(start + 3) & 0x3fff;
    const height = bytes.readUInt16LE(start + 5) & 0x3fff;
    return { width, height };
  }
  return null;
}

/** Read width and height from a file header. Returns null when the header is unrecognized. */
export function readImageDimensions(bytes: Buffer): ImageDimensions | null {
  return readPng(bytes) ?? readGif(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}
