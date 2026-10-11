/**
 * Generates build/icon.png (1024×1024) for the app bundle.
 * Pure Node, no image deps. Run: node scripts/make-icon.mjs
 *
 * Design: a macOS "squircle" tile in deep space blue with a glass sheen and a
 * luminous eye. The iris is a set of concentric rings receding into a dark
 * pupil — an eye and a tunnel at the same time.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const SIZE = 1024
const SS = 3 // supersampling

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]

// --- palette -----------------------------------------------------------
const BG_TOP = hex(0x3079c6)
const BG_BOT = hex(0x07101e)
const SHEEN = hex(0x7cc4ff)
const VIGNETTE = hex(0x04080f)
const RIM = hex(0xb5e3ff)
const GLOW = hex(0x1a6fc0)
const OUTLINE = hex(0x061323)

const EYE_TOP = hex(0xf2fbff)
const EYE_MID = hex(0xa9e2ff)
const EYE_BOT = hex(0x3f96d2)
const SOCKET_SHADE = hex(0x0b2b45)
const WET = hex(0xdff6ff)

const IRIS_OUT = hex(0x0a2136)
const IRIS_IN = hex(0x2f78ab)
const IRIS_RING = hex(0x8fd4ff)
const PUPIL = hex(0x03070d)
const WHITE = hex(0xffffff)

// --- shape -------------------------------------------------------------
function squircleRho(nx, ny) {
  const N = 5
  const m = 0.075
  const ax = 0.5 - m
  const ay = 0.5 - m
  const x = (nx - 0.5) / ax
  const y = (ny - 0.5) / ay
  return { rho: Math.pow(Math.abs(x), N) + Math.pow(Math.abs(y), N), ny }
}

function sample(nx, ny) {
  const { rho } = squircleRho(nx, ny)
  if (rho > 1) return [0, 0, 0, 0]

  // ---- tile ----
  let col = mix(BG_BOT, BG_TOP, Math.pow(1 - ny, 1.15))
  const sheen = clamp01(1 - Math.hypot(nx - 0.4, ny - 0.27) / 0.82)
  col = mix(col, SHEEN, sheen * sheen * 0.5)
  const vig = clamp01(Math.hypot(nx - 0.5, ny - 0.5) / 0.8)
  col = mix(col, VIGNETTE, vig * vig * 0.66)
  const rim = smoothstep(0.78, 1.0, rho)
  col = mix(col, RIM, rim * clamp01(1 - ny * 1.7) * 0.85)
  col = mix(col, hex(0x2f6ea8), rim * clamp01((ny - 0.6) * 2.4) * 0.5)

  // ---- glow behind the eye ----
  const glow = clamp01(1 - Math.hypot((nx - 0.5) / 0.6, (ny - 0.5) / 0.36))
  col = mix(col, GLOW, glow * glow * 0.48)

  // ---- eye socket ----
  const R = 0.34
  const h = 0.185
  const d1 = Math.hypot(nx - 0.5, ny - (0.5 - h))
  const d2 = Math.hypot(nx - 0.5, ny - (0.5 + h))
  const lens = Math.max(d1, d2)
  const inside = R - lens // >0 inside the almond
  const EDGE = 0.014

  // dark outline hugging the almond (outside)
  if (inside < 0 && inside > -EDGE) {
    const t = smoothstep(0, EDGE, -inside)
    col = mix(col, OUTLINE, t * 0.85)
  }

  if (inside >= 0) {
    // sclera gradient
    let eye = mix(EYE_TOP, EYE_MID, smoothstep(0.32, 0.5, ny))
    eye = mix(eye, EYE_BOT, smoothstep(0.5, 0.72, ny))
    // upper-lid ambient occlusion
    const ao = smoothstep(0.055, 0.0, inside)
    eye = mix(eye, SOCKET_SHADE, ao * (ny < 0.54 ? 0.5 : 0.3))
    // wet lower rim
    const wet = smoothstep(0.02, 0.0, inside) * smoothstep(0.46, 0.56, ny)
    eye = mix(eye, WET, wet * 0.55)

    // ---- iris ----
    const rc = Math.hypot(nx - 0.5, ny - 0.5)
    const rIris = 0.130
    const rPupil = 0.048
    if (rc < rIris + 0.004) {
      const t = clamp01(rc / rIris)
      let iris = mix(IRIS_IN, IRIS_OUT, Math.pow(t, 1.35))
      // concentric rings -> tunnel
      const ring = 0.5 + 0.5 * Math.cos(t * Math.PI * 9)
      iris = mix(iris, IRIS_RING, ring * 0.5 * smoothstep(0.1, 0.92, t))
      // recessed shading (darker up top, like a socket)
      iris = mix(iris, hex(0x020609), smoothstep(0.55, 0.25, ny) * 0.42)
      // limbal ring + a faint bright arc inside it
      iris = mix(iris, hex(0x040d18), smoothstep(0.85, 1.0, t) * 0.8)
      iris = mix(iris, IRIS_RING, smoothstep(0.9, 0.99, t) * 0.22)
      eye = mix(eye, iris, smoothstep(rIris + 0.004, rIris - 0.004, rc))
    }
    // ---- pupil ----
    const pup = smoothstep(rPupil + 0.004, rPupil - 0.004, rc)
    eye = mix(eye, PUPIL, pup * 0.96)

    // ---- specular highlights ----
    const s1 = clamp01(1 - Math.hypot((nx - 0.463) / 0.05, (ny - 0.452) / 0.06))
    eye = mix(eye, WHITE, Math.pow(s1, 1.5) * 0.95)
    const s2 = clamp01(1 - Math.hypot((nx - 0.541) / 0.019, (ny - 0.552) / 0.019))
    eye = mix(eye, WHITE, Math.pow(s2, 1.2) * 0.75)
    // fine catch-light arc along pupil top-left
    const arc = clamp01(1 - Math.abs(rc - rPupil * 1.25) / 0.012) * (ny < 0.5 ? 1 : 0)
    eye = mix(eye, WET, arc * 0.5)

    // blend the whole eye over the tile, softly at the almond edge
    const cov = smoothstep(0, 0.006, inside)
    col = mix(col, eye, cov)
  }

  return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), 255]
}

// --- PNG plumbing ------------------------------------------------------
function crc32(buf) {
  let c
  const t = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
function encode(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      raw[o++] = rgba[i]
      raw[o++] = rgba[i + 1]
      raw[o++] = rgba[i + 2]
      raw[o++] = rgba[i + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function render(size) {
  const N = size * SS
  const acc = new Float32Array(size * size * 4)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [r, g, b, a] = sample((x + 0.5) / N, (y + 0.5) / N)
      const i = (((y / SS) | 0) * size + ((x / SS) | 0)) * 4
      acc[i] += r * a
      acc[i + 1] += g * a
      acc[i + 2] += b * a
      acc[i + 3] += a
    }
  }
  const inv = 1 / (SS * SS)
  const out = Buffer.alloc(size * size * 4)
  for (let p = 0; p < size * size; p++) {
    const i = p * 4
    const a = acc[i + 3]
    if (a <= 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0
    } else {
      out[i] = Math.round(acc[i] / a)
      out[i + 1] = Math.round(acc[i + 1] / a)
      out[i + 2] = Math.round(acc[i + 2] / a)
      out[i + 3] = Math.round(a * inv)
    }
  }
  return out
}

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', encode(SIZE, render(SIZE)))
writeFileSync('/tmp/icon-preview.png', encode(360, render(360)))
console.log('wrote build/icon.png (1024×1024) and /tmp/icon-preview.png')
