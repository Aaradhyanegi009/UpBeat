/**
 * UpBeat platform & service barrel (Strangler facade).
 * Delegates cleanly to domain modules under `./services/*` while preserving
 * 100% backward-compatible imports across existing UI components and hooks.
 */

export {
  isNativeApp,
  getStoredApiKey,
  setStoredApiKey,
  getStoredServerUrl,
  setStoredServerUrl,
  hasBackend,
  openExternalUrl,
  getApiBase,
  apiUrl,
  callInnertube,
  isConfigured
} from './services/platformConfig.js'

export {
  COMEDY_PODCAST_REGEX,
  DEVOTIONAL_RELIGIOUS_REGEX,
  NON_MUSIC_GENERAL_REGEX,
  STRICT_VIDEO_ID_REGEX,
  NON_MUSIC_REGEX,
  isStrictArtistName,
  isStrictMusicTrack,
  isValidMusicTrack,
  sanitizeLocalMusicLibrary
} from './services/musicFilter.js'

export {
  generateWithDirectGemini
} from './services/geminiClient.js'

export {
  browsePlaylistStandalone,
  fetchTrackExtendedMeta,
  directSearchStandalone,
  searchYouTubeStandalone,
  searchYouTubeMusicList,
  importYouTubePlaylistStandalone,
  DEFAULT_YT_CHARTS_STATIONS,
  fetchOfficialYoutubeCharts
} from './services/innertubeClient.js'

export {
  resolveStandaloneAudio,
  prewarmTrack,
  getAudioSource,
  getTrackDownloadUrl,
  formatDurationSeconds
} from './services/audioResolver.js'

export {
  cleanTrackMetadataForLyrics,
  parseLrcLyrics,
  fetchTrackLyrics
} from './services/lyricsClient.js'

export {
  curateStandalone,
  analyzeTasteDnaStandalone
} from './services/geminiCurator.js'

export {
  fisherYatesShuffle,
  getRotationCursor,
  advanceRotationCursor,
  DEFAULT_SEED_IDS,
  AVAILABLE_CHARTS,
  resolveRankedChartBlocks,
  getInitialDiscoveryBlocks,
  THIRTY_MINUTES_MS,
  fetchListenTogetherFeed,
  rerollDiscoveryBlock,
  buildHybridRediscoverBlock,
  fetchRelatedCompanionTracks,
  loadBlockTracks
} from './services/discoveryEngine.js'
