/**
 * Standalone Pure-JS ISO/IEC 18004 QR Code Generator (Byte Mode + Reed-Solomon ECC).
 * Generates scannable QR matrices, inline SVG strings, and SVG data URIs completely offline.
 */

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

;(function initGaloisField() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]
  }
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function buildRsGenerator(ecCount) {
  let gen = [1]
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]
      next[j + 1] ^= gfMul(gen[j], GF_EXP[i])
    }
    gen = next
  }
  return gen
}

function computeRsEcc(dataBytes, ecCount) {
  const gen = buildRsGenerator(ecCount)
  const rem = new Uint8Array(ecCount)
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0]
    rem.copyWithin(0, 1)
    rem[ecCount - 1] = 0
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor)
      }
    }
  }
  return rem
}

const ECC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 }

// [ecPerBlock, g1Blocks, g1DataBytes, g2Blocks, g2DataBytes] for Versions 1..10
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

const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 }

function getDataByteCapacity(version, ecc) {
  const [, g1, d1, g2, d2] = VERSION_EC_TABLE[version][ecc]
  return g1 * d1 + g2 * d2
}

function selectVersionAndEcc(byteLength, requestedEcc = 'M') {
  const eccOrder = requestedEcc === 'L' ? ['L'] : [requestedEcc, 'L']
  for (const ecc of eccOrder) {
    for (let v = 1; v <= 10; v++) {
      const cap = getDataByteCapacity(v, ecc)
      const ccBytes = v >= 10 ? 2 : 1
      // 4-bit mode + ccBits + payload bytes <= cap * 8 (mode + byte count takes ccBytes + 0.5 bytes -> floor(cap - 0.5 - ccBytes) bytes max)
      const headerBits = 4 + ccBytes * 8
      if (headerBits + byteLength * 8 <= cap * 8) {
        return { version: v, ecc }
      }
    }
  }
  throw new Error(`QR payload too long (${byteLength} UTF-8 bytes; max supported is 271 bytes)`)
}

function encodeByteModeData(bytes, version, ecc) {
  const cap = getDataByteCapacity(version, ecc)
  const bits = []
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1)
    }
  }

  // Byte mode indicator (0100) + character count
  pushBits(0b0100, 4)
  pushBits(bytes.length, version >= 10 ? 16 : 8)
  for (const b of bytes) pushBits(b, 8)

  const totalBits = cap * 8
  const terminator = Math.min(4, totalBits - bits.length)
  for (let i = 0; i < terminator; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  let padToggle = 0
  while (bits.length < totalBits) {
    pushBits(padToggle === 0 ? 0xec : 0x11, 8)
    padToggle ^= 1
  }

  const out = new Uint8Array(cap)
  for (let i = 0; i < cap; i++) {
    let val = 0
    for (let b = 0; b < 8; b++) val = (val << 1) | bits[i * 8 + b]
    out[i] = val
  }
  return out
}

function buildFinalBitStream(dataBytes, version, ecc) {
  const [ecCount, g1, d1, g2, d2] = VERSION_EC_TABLE[version][ecc]
  const dataBlocks = []
  const ecBlocks = []
  let offset = 0

  for (let i = 0; i < g1; i++) {
    const blk = dataBytes.subarray(offset, offset + d1)
    dataBlocks.push(blk)
    ecBlocks.push(computeRsEcc(blk, ecCount))
    offset += d1
  }
  for (let i = 0; i < g2; i++) {
    const blk = dataBytes.subarray(offset, offset + d2)
    dataBlocks.push(blk)
    ecBlocks.push(computeRsEcc(blk, ecCount))
    offset += d2
  }

  const interleaved = []
  const maxDataLen = Math.max(d1, d2)
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) interleaved.push(blk[i])
    }
  }
  for (let i = 0; i < ecCount; i++) {
    for (const ec of ecBlocks) {
      interleaved.push(ec[i])
    }
  }

  const bits = []
  for (const byte of interleaved) {
    for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1)
  }
  const rem = REMAINDER_BITS[version] || 0
  for (let i = 0; i < rem; i++) bits.push(0)
  return bits
}

function createMatrix(size, fill = false) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

function setFinderPattern(modules, isFunc, top, left) {
  const size = modules.length
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = top + dr
      const c = left + dc
      if (r < 0 || r >= size || c < 0 || c >= size) continue
      const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
      const dark =
        inOuter &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4))
      modules[r][c] = dark
      isFunc[r][c] = true
    }
  }
}

function setAlignmentPattern(modules, isFunc, centerR, centerC) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = centerR + dr
      const c = centerC + dc
      const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1
      modules[r][c] = dark
      isFunc[r][c] = true
    }
  }
}

function populateFunctionPatterns(version) {
  const size = 17 + 4 * version
  const modules = createMatrix(size, false)
  const isFunc = createMatrix(size, false)

  setFinderPattern(modules, isFunc, 0, 0)
  setFinderPattern(modules, isFunc, 0, size - 7)
  setFinderPattern(modules, isFunc, size - 7, 0)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0
    modules[6][i] = dark
    modules[i][6] = dark
    isFunc[6][i] = true
    isFunc[i][6] = true
  }

  // Alignment patterns
  const centers = ALIGNMENT_CENTERS[version] || []
  const last = centers.length - 1
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      setAlignmentPattern(modules, isFunc, centers[i], centers[j])
    }
  }

  // Dark module
  modules[4 * version + 9][8] = true
  isFunc[4 * version + 9][8] = true

  // Reserve Format Info positions
  for (let i = 0; i <= 8; i++) {
    isFunc[8][i] = true
    isFunc[i][8] = true
  }
  for (let i = 0; i < 8; i++) {
    isFunc[8][size - 1 - i] = true
    if (i < 7) isFunc[size - 1 - i][8] = true
  }

  // Write Version Info for version >= 7
  if (version >= 7) {
    let rem = version << 12
    for (let i = 17; i >= 12; i--) {
      if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12)
    }
    const verBits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = Boolean((verBits >> i) & 1)
      const r = Math.floor(i / 3)
      const c = i % 3
      modules[size - 11 + c][r] = bit
      isFunc[size - 11 + c][r] = true
      modules[r][size - 11 + c] = bit
      isFunc[r][size - 11 + c] = true
    }
  }

  return { size, modules, isFunc }
}

function placeDataBits(modules, isFunc, bits) {
  const size = modules.length
  let bitIdx = 0
  let up = true

  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--
    for (let step = 0; step < size; step++) {
      const row = up ? size - 1 - step : step
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc
        if (!isFunc[row][c]) {
          modules[row][c] = bitIdx < bits.length ? bits[bitIdx] === 1 : false
          bitIdx++
        }
      }
    }
    up = !up
  }
}

function applyMaskPattern(baseModules, isFunc, maskId) {
  const size = baseModules.length
  const masked = baseModules.map((row) => [...row])
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isFunc[r][c]) continue
      let flip = false
      switch (maskId) {
        case 0: flip = (r + c) % 2 === 0; break
        case 1: flip = r % 2 === 0; break
        case 2: flip = c % 3 === 0; break
        case 3: flip = (r + c) % 3 === 0; break
        case 4: flip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break
        case 5: flip = ((r * c) % 2) + ((r * c) % 3) === 0; break
        case 6: flip = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break
        case 7: flip = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break
      }
      if (flip) masked[r][c] = !masked[r][c]
    }
  }
  return masked
}

function writeFormatInfo(modules, ecc, maskId) {
  const size = modules.length
  const data5 = ((ECC_BITS[ecc] ?? 0) << 3) | (maskId & 7)
  let rem = data5 << 10
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10)
  }
  const fmt = ((data5 << 10) | rem) ^ 0x5412

  const bit = (idx) => Boolean((fmt >> idx) & 1)

  // Copy 1 (top-left)
  for (let i = 0; i <= 5; i++) modules[8][i] = bit(14 - i)
  modules[8][7] = bit(8)
  modules[8][8] = bit(7)
  modules[7][8] = bit(6)
  for (let i = 0; i <= 5; i++) modules[5 - i][8] = bit(5 - i)

  // Copy 2 (bottom-left + top-right)
  for (let i = 0; i <= 6; i++) modules[size - 1 - i][8] = bit(14 - i)
  for (let i = 0; i <= 7; i++) modules[8][size - 8 + i] = bit(7 - i)
}

function evaluatePenalty(modules) {
  const size = modules.length
  let penalty = 0

  // N1: 5+ consecutive same-color modules in row/col
  const checkLineRuns = (getCell) => {
    let runColor = false
    let runLen = 0
    for (let i = 0; i < size; i++) {
      const val = getCell(i)
      if (i === 0 || val !== runColor) {
        if (runLen >= 5) penalty += 3 + (runLen - 5)
        runColor = val
        runLen = 1
      } else {
        runLen++
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5)
  }

  for (let r = 0; r < size; r++) checkLineRuns((c) => modules[r][c])
  for (let c = 0; c < size; c++) checkLineRuns((r) => modules[r][c])

  // N2: 2x2 same-color blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c]
      if (modules[r][c + 1] === v && modules[r + 1][c] === v && modules[r + 1][c + 1] === v) {
        penalty += 3
      }
    }
  }

  // N3: 1:1:3:1:1 finder-like pattern with 4 light cells on either side
  const isFinderLike = (getCell, start) => {
    const p1 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    const p2 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    let m1 = true
    let m2 = true
    for (let k = 0; k < 11; k++) {
      const bit = getCell(start + k) ? 1 : 0
      if (bit !== p1[k]) m1 = false
      if (bit !== p2[k]) m2 = false
      if (!m1 && !m2) return false
    }
    return true
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (isFinderLike((k) => modules[r][k], c)) penalty += 40
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      if (isFinderLike((k) => modules[k][c], r)) penalty += 40
    }
  }

  // N4: dark module balance
  let darkCount = 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) darkCount++
    }
  }
  const pct = (darkCount * 100) / (size * size)
  const k = Math.floor(Math.abs(pct - 50) / 5)
  penalty += k * 10

  return penalty
}

/**
 * Generates an ISO/IEC 18004 QR matrix `{ size, version, ecc, mask, modules }` (modules[row][col] = boolean).
 */
export function generateQrMatrix(text, { ecc = 'M' } = {}) {
  const raw = String(text ?? '')
  const encoder = new TextEncoder()
  const bytes = encoder.encode(raw)
  const requestedEcc = ECC_BITS[ecc] !== undefined ? ecc : 'M'
  const { version, ecc: resolvedEcc } = selectVersionAndEcc(bytes.length, requestedEcc)

  const dataBytes = encodeByteModeData(bytes, version, resolvedEcc)
  const finalBits = buildFinalBitStream(dataBytes, version, resolvedEcc)
  const { size, modules: base, isFunc } = populateFunctionPatterns(version)
  placeDataBits(base, isFunc, finalBits)

  let bestMask = 0
  let bestScore = Infinity
  let bestModules = null

  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMaskPattern(base, isFunc, mask)
    writeFormatInfo(candidate, resolvedEcc, mask)
    const score = evaluatePenalty(candidate)
    if (score < bestScore) {
      bestScore = score
      bestMask = mask
      bestModules = candidate
    }
  }

  return {
    size,
    version,
    ecc: resolvedEcc,
    mask: bestMask,
    modules: bestModules
  }
}

function escapeAttr(val) {
  return String(val ?? '').replace(/[&"'<>]/g, '')
}

/**
 * Renders a crisp offline SVG string for the given QR payload.
 */
export function renderQrSvg(text, { size = 200, fg = '#000000', bg = '#ffffff', margin = 4, ecc = 'M' } = {}) {
  const matrix = generateQrMatrix(text, { ecc })
  const quiet = Math.max(0, Math.round(Number(margin) || 0))
  const total = matrix.size + quiet * 2
  const px = Math.max(32, Math.round(Number(size) || 200))
  const safeFg = escapeAttr(fg || '#000000')
  const safeBg = escapeAttr(bg || '#ffffff')

  const parts = []
  for (let r = 0; r < matrix.size; r++) {
    const row = matrix.modules[r]
    for (let c = 0; c < matrix.size; c++) {
      if (row[c]) {
        parts.push(`M${c + quiet} ${r + quiet}h1v1h-1z`)
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" role="img" aria-label="QR code" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${safeBg}"/>` +
    `<path d="${parts.join('')}" fill="${safeFg}"/>` +
    `</svg>`
  )
}

/**
 * Renders an inline SVG Data URI suitable for `<img src={...}>` completely offline.
 */
export function renderQrDataUri(text, options = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderQrSvg(text, options))}`
}
