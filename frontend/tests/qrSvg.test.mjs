import test from 'node:test'
import assert from 'node:assert/strict'
import { generateQrMatrix, renderQrSvg, renderQrDataUri } from '../src/utils/qrSvg.js'

const VERSION_EC_TABLE = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] }
}

const ALIGNMENT_CENTERS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50]
}

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]])

function buildFunctionMask(version) {
  const size = 17 + 4 * version
  const isFunc = Array.from({ length: size }, () => Array(size).fill(false))
  const markRect = (r0, c0, h, w) => {
    for (let r = Math.max(0, r0); r < Math.min(size, r0 + h); r++) {
      for (let c = Math.max(0, c0); c < Math.min(size, c0 + w); c++) isFunc[r][c] = true
    }
  }
  markRect(0, 0, 9, 9)
  markRect(0, size - 8, 9, 8)
  markRect(size - 8, 0, 8, 9)
  for (let i = 8; i < size - 8; i++) {
    isFunc[6][i] = true
    isFunc[i][6] = true
  }
  const centers = ALIGNMENT_CENTERS[version]
  const last = centers.length - 1
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      markRect(centers[i] - 2, centers[j] - 2, 5, 5)
    }
  }
  if (version >= 7) {
    markRect(size - 11, 0, 3, 6)
    markRect(0, size - 11, 6, 3)
  }
  return isFunc
}

function decodeAndVerifyQrMatrix(qr) {
  const { size, version, ecc, mask, modules } = qr
  assert.equal(size, 17 + 4 * version)
  assert.equal(modules.length, size)
  assert.ok(modules.every((row) => row.length === size))

  // Check finder patterns (top-left, top-right, bottom-left)
  for (const [tr, tc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const expected = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        assert.equal(modules[tr + r][tc + c], expected)
      }
    }
  }

  // Dark module
  assert.equal(modules[4 * version + 9][8], true)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0)
    assert.equal(modules[i][6], i % 2 === 0)
  }

  // Format info copy 1 & copy 2
  const readBits = (coords) => coords.reduce((acc, [r, c]) => (acc << 1) | (modules[r][c] ? 1 : 0), 0)
  const copy1Coords = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ]
  const copy2Coords = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
  ]
  const fmt1 = readBits(copy1Coords) ^ 0x5412
  const fmt2 = readBits(copy2Coords) ^ 0x5412
  assert.equal(fmt1, fmt2, 'Format copies must match')
  // Verify BCH(15,5) syndrome === 0
  let bchRem = fmt1
  for (let i = 14; i >= 10; i--) if ((bchRem >> i) & 1) bchRem ^= 0x537 << (i - 10)
  assert.equal(bchRem, 0, 'Format info BCH syndrome must be 0')
  assert.equal(fmt1 >> 10, ({ L: 0b01, M: 0b00, Q: 0b11, H: 0b10 }[ecc] << 3) | mask)

  // Version info (v >= 7)
  if (version >= 7) {
    let vTop = 0
    let vBot = 0
    for (let i = 17; i >= 0; i--) {
      const r = Math.floor(i / 3)
      const c = i % 3
      vTop = (vTop << 1) | (modules[r][size - 11 + c] ? 1 : 0)
      vBot = (vBot << 1) | (modules[size - 11 + c][r] ? 1 : 0)
    }
    assert.equal(vTop, vBot)
    assert.equal(vTop >> 12, version)
    let vRem = vTop
    for (let i = 17; i >= 12; i--) if ((vRem >> i) & 1) vRem ^= 0x1f25 << (i - 12)
    assert.equal(vRem, 0, 'Version info Golay syndrome must be 0')
  }

  // Unmask & read codewords
  const isFunc = buildFunctionMask(version)
  const maskFn = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ][mask]

  const bits = []
  let up = true
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--
    for (let step = 0; step < size; step++) {
      const row = up ? size - 1 - step : step
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc
        if (!isFunc[row][c]) {
          const raw = modules[row][c]
          bits.push((maskFn(row, c) ? !raw : raw) ? 1 : 0)
        }
      }
    }
    up = !up
  }

  const codewords = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]
    codewords.push(b)
  }

  // De-interleave blocks & verify Reed-Solomon syndromes === 0
  const [ecCount, g1, d1, g2, d2] = VERSION_EC_TABLE[version][ecc]
  const totalBlocks = g1 + g2
  const dataBlocks = Array.from({ length: totalBlocks }, (_, idx) => new Uint8Array(idx < g1 ? d1 : d2))
  const ecBlocks = Array.from({ length: totalBlocks }, () => new Uint8Array(ecCount))

  let cwIdx = 0
  const maxDataLen = Math.max(d1, d2)
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      if (i < dataBlocks[b].length) dataBlocks[b][i] = codewords[cwIdx++]
    }
  }
  for (let i = 0; i < ecCount; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      ecBlocks[b][i] = codewords[cwIdx++]
    }
  }

  for (let b = 0; b < totalBlocks; b++) {
    const full = [...dataBlocks[b], ...ecBlocks[b]]
    for (let rootIdx = 0; rootIdx < ecCount; rootIdx++) {
      const alpha = GF_EXP[rootIdx]
      let evalVal = 0
      for (const coef of full) {
        evalVal = gfMul(evalVal, alpha) ^ coef
      }
      assert.equal(evalVal, 0, `RS syndrome must be 0 for block ${b}, root ${rootIdx}`)
    }
  }

  // Reassemble data bits & decode Byte Mode UTF-8 string
  const dataBits = []
  for (const blk of dataBlocks) {
    for (const byte of blk) {
      for (let k = 7; k >= 0; k--) dataBits.push((byte >> k) & 1)
    }
  }
  const readDataBits = (pos, len) => {
    let v = 0
    for (let i = 0; i < len; i++) v = (v << 1) | dataBits[pos + i]
    return v
  }
  assert.equal(readDataBits(0, 4), 0b0100, 'Mode indicator must be Byte Mode (0100)')
  const ccBits = version >= 10 ? 16 : 8
  const charCount = readDataBits(4, ccBits)
  const outBytes = new Uint8Array(charCount)
  for (let i = 0; i < charCount; i++) {
    outBytes[i] = readDataBits(4 + ccBits + i * 8, 8)
  }
  return new TextDecoder().decode(outBytes)
}

test('generateQrMatrix produces ISO-valid byte-mode QR matrices with valid RS ECC across versions', () => {
  const payloads = [
    'JAM-4829',
    'https://upbeat-music.vercel.app/#/?jam=JAM-4829',
    'https://upbeat.example.com/#/?addFriend=UP-9X4K2M&name=Aaradhya%20%E2%99%AB',
    'https://upbeat.local/invite?jam=JAM-7788&host=SynthWave&tracks=' + 'x'.repeat(130) // forces Version 7+ (version info test!)
  ]

  for (const text of payloads) {
    const qr = generateQrMatrix(text)
    const decoded = decodeAndVerifyQrMatrix(qr)
    assert.equal(decoded, text)
  }

  // Test explicit ECC levels too
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    const qr = generateQrMatrix('https://upbeat.app/#/?jam=JAM-1234', { ecc })
    assert.equal(qr.ecc, ecc)
    assert.equal(decodeAndVerifyQrMatrix(qr), 'https://upbeat.app/#/?jam=JAM-1234')
  }
})

test('renderQrSvg and renderQrDataUri output valid SVG markup and data URIs offline', () => {
  const url = 'https://upbeat.app/#/?jam=JAM-9012'
  const svg = renderQrSvg(url, { size: 240, fg: '#0A0A0B', bg: '#FFFFFF', margin: 2 })
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /width="240" height="240"/)
  assert.match(svg, /fill="#FFFFFF"/)
  assert.match(svg, /fill="#0A0A0B"/)
  assert.match(svg, /<path d="M/)
  assert.match(svg, /<\/svg>$/)

  const uri = renderQrDataUri(url)
  assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/)
})
