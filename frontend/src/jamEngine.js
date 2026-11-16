/**
 * UpBeat Jam Session & Bidirectional Social Engine barrel (Strangler facade).
 * Delegates cleanly to modular layers under `./jam/*` while preserving
 * 100% backward-compatible imports across existing components and tests.
 */

export {
  sanitizePayloadForCloud,
  renderEmoji,
  JAM_AVATARS,
  JAM_REACTIONS,
  JAM_REACTION_PRESETS,
  normalizeRoomCode,
  normalizeFriendCode,
  normalizeFriendId,
  getAppBaseUrl,
  buildJamInviteUrl,
  buildFriendInviteUrl,
  extractDeepLinkParams,
  sanitizeStoredJamAndSocialData,
  loadJamUserProfile,
  saveJamUserProfile,
  sortFriendsDeterministically,
  evaluateAudioDrift
} from './jam/jamUtils.js'

export { JamSessionManager, jamManager } from './jam/JamSessionManager.js'
