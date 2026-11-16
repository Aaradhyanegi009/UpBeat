import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'))
const rulesPath = path.join(__dirname, 'music_filters.json')
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'))

if (rootPkg.version && rules.app_version !== rootPkg.version) {
  rules.app_version = rootPkg.version
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + '\n', 'utf8')
}

// 1. Copy canonical JSON to backend/music_filters.json (safe for Vercel root: backend isolation)
const backendTarget = path.join(ROOT_DIR, 'backend', 'music_filters.json')
fs.writeFileSync(backendTarget, JSON.stringify(rules, null, 2) + '\n', 'utf8')

// 2. Generate frontend/src/config/musicFilters.js (zero import-attribute ambiguity across Node & Vite)
const frontendConfigDir = path.join(ROOT_DIR, 'frontend', 'src', 'config')
fs.mkdirSync(frontendConfigDir, { recursive: true })
const frontendTarget = path.join(frontendConfigDir, 'musicFilters.js')

const jsContent = `// AUTO-GENERATED from shared/music_filters.json via \`npm run sync:shared\`.
// Do not edit directly; modify shared/music_filters.json and re-run sync:shared.

export const FILTER_RULES = ${JSON.stringify(rules, null, 2)}

export const MIN_DURATION_SEC = ${rules.min_duration_sec}
export const MAX_DURATION_SEC = ${rules.max_duration_sec}

export const STRICT_VIDEO_ID_REGEX = new RegExp(${JSON.stringify(rules.video_id_pattern)})
export const INVALID_ARTIST_NUMERIC_REGEX = new RegExp(${JSON.stringify(rules.invalid_artist_numeric_pattern)}, 'i')
export const INVALID_ARTIST_GENERIC_REGEX = new RegExp(${JSON.stringify(rules.invalid_artist_generic_pattern)}, 'i')

export const COMEDY_PODCAST_REGEX = new RegExp(${JSON.stringify(rules.patterns.comedy_podcast)}, 'i')
export const DEVOTIONAL_RELIGIOUS_REGEX = new RegExp(${JSON.stringify(rules.patterns.devotional_religious)}, 'i')
export const NON_MUSIC_GENERAL_REGEX = new RegExp(${JSON.stringify(rules.patterns.non_music_general)}, 'i')
export const NON_MUSIC_REGEX = new RegExp(${JSON.stringify(rules.patterns.non_music_academic_and_creator)}, 'i')
`

fs.writeFileSync(frontendTarget, jsContent, 'utf8')
console.log('Synced shared/music_filters.json -> backend/music_filters.json & frontend/src/config/musicFilters.js')
