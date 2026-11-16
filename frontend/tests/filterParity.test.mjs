import './helpers/test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FILTER_RULES } from '../src/config/musicFilters.js'
import { isStrictMusicTrack } from '../src/standaloneApi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')

test('frontend generated musicFilters.js and backend music_filters.json stay in sync with shared/music_filters.json', () => {
  const shared = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'shared', 'music_filters.json'), 'utf8'))
  const backendCopy = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'backend', 'music_filters.json'), 'utf8'))
  assert.deepEqual(FILTER_RULES, shared)
  assert.deepEqual(backendCopy, shared)
})

test('JS isStrictMusicTrack passes 100% of shared filter_test_corpus.json', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'shared', 'filter_test_corpus.json'), 'utf8'))
  for (const item of corpus) {
    assert.equal(isStrictMusicTrack(item.track), item.expected, `Failed JS corpus case: ${item.label}`)
  }
})
