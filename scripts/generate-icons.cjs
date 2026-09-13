#!/usr/bin/env node
/**
 * Generates every icon electron-builder needs from one procedural drawing.
 *
 * Outputs (into build/):
 *   icon.png   1024px master — Linux target + general fallback
 *   icon.ico   16/24/32/48/64/128/256 — Windows exe + installer
 *   icon.icns  16..1024 — macOS
 *
 * Handwritten instead of an npm icon package: the project has zero runtime
 * dependencies and icon generators pull in native image stacks. The mark is
 * simple geometry — the same violet ring + dot as the new tab page — so a
 * few dozen lines of SDF rasterisation cover it.
 *
 * Usage: npm run icons   (idempotent; overwrites the three files)
 */

const { statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const zlib = require('node:zlib')

const OUT_DIR = join(__dirname, '..', 'build')

// Brand colors, straight from the new tab page CSS.
const BG = [15, 15, 23] // #0f0f17
const ACCENT = [124, 106, 247] // #7c6af7

const MASTER = 1024
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
// ICNS types: icp4=16 icp5=32 ic07=128 ic08=256 ic09=512 ic10=1024 ("@2x" of 512).
const ICNS_CHUNKS = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]

// ─────────────────────────────────────────────────────────────────────────────
// Drawing — signed-distance rasterisation on the 1024px master
// ─────────────────────────────────────────────────────────────────────────────

/** Signed distance to a rounded rectangle centred at (cx, cy). Negative inside. */
function sdRoundRect(px, py, cx, cy, half, rad) {
  const qx = Math.abs(px - cx) - (half - rad)
  const qy = Math.abs(py - cy) - (half - rad)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rad
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))
/** Antialiased coverage of a signed distance at pixel resolution. */
const cover = (d) => clamp01(0.5 - d)

/**
 * Renders the master canvas as three float planes (r, g, b, a packed per pixel).
 * The silhouette is a rounded rect so macOS gets proper corner transparency.
 */
function renderMaster(size) {
  const half = size / 2
  const radius = size * 0.225 // matches modern macOS icon squircle proportions
  const data = new Float32Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      // Background with a soft violet glow falling from the top centre.
      const bgA = cover(sdRoundRect(px, py, half, half, half, radius))
      const glowDist = Math.hypot(px - half, py - size * 0.08) / (size * 1.1)
      const glow = Math.pow(clamp01(1 - glowDist), 2) * 0.28

      // Ring: a band around radius 0.41s with an 0.085s stroke.
      const dist = Math.hypot(px - half, py - half)
      const ringD = Math.abs(dist - size * 0.41) - size * 0.0425
      // Dot: filled circle at 0.16s.
      const dotD = dist - size * 0.16
      const markA = Math.max(cover(ringD), cover(dotD))

      const i = (y * size + x) * 4
      // Blend bg → accent by glow, then paint the mark on top.
      let r = BG[0] + (ACCENT[0] - BG[0]) * glow
      let g = BG[1] + (ACCENT[1] - BG[1]) * glow
      let b = BG[2] + (ACCENT[2] - BG[2]) * glow
      const outA = Math.max(bgA, markA)
      const markOver = markA // mark is fully opaque where covered
      r = r * (1 - markOver) + ACCENT[0] * markOver
      g = g * (1 - markOver) + ACCENT[1] * markOver
      b = b * (1 - markOver) + ACCENT[2] * markOver

      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = outA * 255
    }
  }
  return { data, size }
}

/** Box-average downsample from the master — cheap and antialiasing comes free. */
function downsample(src, target) {
  const { data, size } = src
  const scale = size / target
  const step = Math.max(1, Math.floor(scale))
  const out = new Uint8Array(target * target * 4)

  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      const x0 = Math.floor(x * scale)
      const y0 = Math.floor(y * scale)
      // A fixed 2x2..4x4 window per target pixel: exact area averaging is
      // unnecessary — the master is already 4-64x denser than the target.
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const si = ((y0 + dy) * size + (x0 + dx)) * 4
          const sa = data[si + 3] / 255
          // Premultiply while averaging so transparent corners don't bleed.
          r += data[si] * sa
          g += data[si + 1] * sa
          b += data[si + 2] * sa
          a += sa
          n++
        }
      }
      const oi = (y * target + x) * 4
      const avgA = a / n
      out[oi] = avgA > 0 ? Math.round(r / n / avgA) : 0
      out[oi + 1] = avgA > 0 ? Math.round(g / n / avgA) : 0
      out[oi + 2] = avgA > 0 ? Math.round(b / n / avgA) : 0
      out[oi + 3] = Math.round(avgA * 255)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG encoding (color type 6, RGBA, 8-bit)
// ─────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(rgba, size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // One filter byte (0 = None) per scanline. The mark is smooth; forcing
  // Paeth on flat regions grows the file, so None keeps it simple and small.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })

  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

// ─────────────────────────────────────────────────────────────────────────────
// Container formats
// ─────────────────────────────────────────────────────────────────────────────

/** ICO with PNG-compressed entries (supported since Windows Vista). */
function encodeIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = 6 + count * 16
  for (const [size, png] of pngs) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256 in the directory entry
    entry[1] = size >= 256 ? 0 : size
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(entry)
  }

  return Buffer.concat([header, ...entries, ...pngs.map(([, png]) => png)])
}

/** ICNS: a type/length table of embedded PNGs. */
function encodeIcns(chunks) {
  const body = []
  let total = 8
  for (const [type, png] of chunks) {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    body.push(head, png)
    total += png.length + 8
  }
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(total, 4)
  return Buffer.concat([header, ...body])
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const master = renderMaster(MASTER)
const pngFor = new Map()
for (const size of [...ICO_SIZES, ...ICNS_CHUNKS.map(([, s]) => s)]) {
  if (!pngFor.has(size)) pngFor.set(size, encodePng(downsample(master, size), size))
}

const iconPng = pngFor.get(MASTER)
writeFileSync(join(OUT_DIR, 'icon.png'), iconPng)
writeFileSync(
  join(OUT_DIR, 'icon.ico'),
  encodeIco(ICO_SIZES.map((size) => [size, pngFor.get(size)])),
)
writeFileSync(
  join(OUT_DIR, 'icon.icns'),
  encodeIcns(ICNS_CHUNKS.map(([type, size]) => [type, pngFor.get(size)])),
)

for (const file of ['icon.png', 'icon.ico', 'icon.icns']) {
  const path = join(OUT_DIR, file)
  const stat = statSync(path)
  console.log(`[omega] wrote ${file} (${(stat.size / 1024).toFixed(1)} KB)`)
}
