/**
 * Erases the muted `user@host:port` subtitle under topology nodes (and the
 * matching line in the import list) so real hostnames/IPs never land in docs.
 *
 * Pure Node: a minimal PNG decode (filters 0-4, colour types 2/6) + encode.
 *
 * Run: node scripts/redact-png.mjs <in> <out> [...]
 */
import { inflateSync, deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

const FAINT = [0x5b, 0x65, 0x7c]
const TOL = 6

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

function decodePng(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 6
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      const bitDepth = data[8]
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!bpp) throw new Error(`unsupported colour type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const data = Buffer.alloc(width * height * bpp)
  let prev = Buffer.alloc(stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 255
    }
    cur.copy(data, y * stride)
    prev = cur
  }
  return { width, height, bpp, data }
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1))
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    rgba.copy(raw, o, y * width * 4, (y + 1) * width * 4)
    o += width * 4
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function toRgba(img) {
  if (img.bpp === 4) return img.data
  const out = Buffer.alloc(img.width * img.height * 4)
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    out[j] = img.data[i]
    out[j + 1] = img.data[i + 1]
    out[j + 2] = img.data[i + 2]
    out[j + 3] = 255
  }
  return out
}

function redact(img, box = [0, 0, 0, 0]) {
  const { width: W, height: H } = img
  const d = toRgba(img)
  const near = (i) =>
    Math.abs(d[i] - FAINT[0]) < TOL &&
    Math.abs(d[i + 1] - FAINT[1]) < TOL &&
    Math.abs(d[i + 2] - FAINT[2]) < TOL

  const [bx0, by0, bx1, by1] = box
  const inBox = (x, y) =>
    (!bx0 && !by0 && !bx1 && !by1) || (x >= bx0 && x <= bx1 && y >= by0 && y <= by1)

  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (inBox(x, y) && near((y * W + x) * 4)) mask[y * W + x] = 1

  // horizontal bands of matching pixels
  const bands = []
  let y = 0
  while (y < H) {
    let any = false
    for (let x = 0; x < W; x++) if (mask[y * W + x]) { any = true; break }
    if (!any) { y++; continue }
    const y0 = y
    while (y < H) {
      let a = false
      for (let x = 0; x < W; x++) if (mask[y * W + x]) { a = true; break }
      if (!a) break
      y++
    }
    bands.push([y0, y - 1])
  }

  let erased = 0
  for (const [y0, y1] of bands) {
    const cols = new Uint8Array(W)
    for (let yy = y0; yy <= y1; yy++)
      for (let x = 0; x < W; x++) if (mask[yy * W + x]) cols[x] = 1

    const clusters = []
    let x = 0
    while (x < W) {
      if (!cols[x]) { x++; continue }
      const x0 = x
      let xe = x
      let gap = 0
      while (x < W) {
        if (cols[x]) { xe = x; gap = 0 } else { gap++; if (gap > 40) break }
        x++
      }
      clusters.push([x0, xe])
    }

    for (const [x0, x1] of clusters) {
      const pad = 4
      const X0 = Math.max(0, x0 - pad), X1 = Math.min(W - 1, x1 + pad)
      const Y0 = Math.max(0, y0 - pad), Y1 = Math.min(H - 1, y1 + pad)
      const sy = Math.min(H - 1, y1 + 6)
      for (let xx = X0; xx <= X1; xx++) {
        let i = (sy * W + xx) * 4
        if (near(i)) i = Math.max(0, y0 - 6) * W * 4 + xx * 4
        const r = d[i], g = d[i + 1], b = d[i + 2]
        for (let yy = Y0; yy <= Y1; yy++) {
          const k = (yy * W + xx) * 4
          d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255
        }
      }
      erased++
    }
  }
  return { img: { width: W, height: H, bpp: 4, data: d }, erased }
}

const [inFile, outFile, boxArg] = process.argv.slice(2)
// "x0,y0,x1,y1" — only pixels inside this box are considered
const BOX = (boxArg ?? '0,0,0,0').split(',').map(Number)
if (!inFile || !outFile) {
  console.error('usage: node scripts/redact-png.mjs <in.png> <out.png> [x0,y0,x1,y1]')
  process.exit(1)
}
const decoded = decodePng(readFileSync(inFile))
const { img, erased } = redact(decoded, BOX)
writeFileSync(outFile, encodePng(img.width, img.height, img.data))
console.log(`${outFile}: erased ${erased} text cluster(s)  (${img.width}×${img.height})`)
