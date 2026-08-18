// Generate the desktop app icons: a brand-blue rounded square with a white
// inset "window" glyph, emitted as PNGs electron-builder and the tray use.
// Pure Node (zlib + a hand-rolled PNG encoder) so no image dependency enters
// the repo. The main 512px icon is the electron-builder buildResources icon
// (auto-converted to .ico/.icns per target); tray.png is the small tray glyph.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const outDir = fileURLToPath(new URL('../build', import.meta.url))
mkdirSync(outDir, { recursive: true })

// DeepSeek brand blue; the white glyph is the "window" the shell draws.
const BLUE = [0x4d, 0x6b, 0xfe]
const WHITE = [0xff, 0xff, 0xff]

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const stride = 1 + width * 4
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Coverage of a pixel by a rounded rectangle at (0..1)^2; 1 inside, 0 outside, linear edge falloff. */
function roundedSquareCoverage(x, y, size, radius) {
  const half = size / 2
  const cx = Math.abs(x - half)
  const cy = Math.abs(y - half)
  if (cx > half - radius && cy > half - radius) {
    const corner = Math.hypot(cx - (half - radius), cy - (half - radius))
    return Math.min(1, Math.max(0, radius - corner + 0.5))
  }
  return 1
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const half = size / 2
  const glyphHalf = size * 0.23
  const glyphRadius = size * 0.09
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const outer = roundedSquareCoverage(u, v, 1, 0.22)
      if (outer <= 0) continue
      let glyph = 0
      if (Math.abs(x + 0.5 - half) <= glyphHalf && Math.abs(y + 0.5 - half) <= glyphHalf) {
        glyph = roundedSquareCoverage(u, v, (glyphHalf * 2) / size, glyphRadius / size)
      }
      const blue = outer * (1 - glyph)
      const white = outer * glyph
      const idx = (y * size + x) * 4
      const denom = blue + white || 1
      rgba[idx] = Math.round((BLUE[0] * blue + WHITE[0] * white) / denom)
      rgba[idx + 1] = Math.round((BLUE[1] * blue + WHITE[1] * white) / denom)
      rgba[idx + 2] = Math.round((BLUE[2] * blue + WHITE[2] * white) / denom)
      rgba[idx + 3] = Math.round(outer * 255)
    }
  }
  return rgba
}

const icon512 = encodePng(512, 512, drawIcon(512))
writeFileSync(join(outDir, 'icon.png'), icon512)
const tray32 = encodePng(32, 32, drawIcon(32))
writeFileSync(join(outDir, 'tray.png'), tray32)
console.log('gen-icons: wrote build/icon.png (512) and build/tray.png (32)')