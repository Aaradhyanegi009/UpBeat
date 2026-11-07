/**
 * UpBeat Unified Speech Recognition Engine
 * Cross-platform speech-to-text with support for:
 * 1. Native macOS WKWebView bridge (via SFSpeechRecognizer in UpBeatApp.swift)
 * 2. Standard Web Speech API (Chrome, Edge, Safari, Android WebView)
 * 3. Fallback error recovery with clear permission prompts
 */

export function isSpeechSupported() {
  if (typeof window === 'undefined') return false

  // 1. Native macOS App bridge
  if (window.webkit?.messageHandlers?.upbeatNative) return true

  // 2. Web Speech API (Chrome, Edge, Safari, mobile browsers)
  if (Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)) return true

  // 3. MediaDevices fallback
  if (typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)) return true

  return false
}

export function createSpeechRecognizer({
  onResult,
  onError,
  onStart,
  onEnd,
  lang = 'en-US'
}) {
  let activeWebRec = null
  let isListening = false

  // 1. Native macOS App with SFSpeechRecognizer Bridge
  const hasMacNative = typeof window !== 'undefined' && Boolean(window.webkit?.messageHandlers?.upbeatNative)

  const start = () => {
    if (isListening) return
    isListening = true

    if (hasMacNative) {
      window.onUpBeatSpeechStart = () => {
        isListening = true
        onStart?.()
      }
      window.onUpBeatSpeechResult = (text, isFinal) => {
        if (text) onResult?.(text, Boolean(isFinal))
        if (isFinal) {
          isListening = false
          onEnd?.()
        }
      }
      window.onUpBeatSpeechError = (errMsg) => {
        isListening = false
        onError?.(errMsg || 'Speech recognition failed')
        onEnd?.()
      }
      window.onUpBeatSpeechEnd = () => {
        isListening = false
        onEnd?.()
      }

      try {
        window.webkit.messageHandlers.upbeatNative.postMessage({
          action: 'startSpeechRecognition',
          lang: lang || navigator.language || 'en-US'
        })
        onStart?.()
      } catch (err) {
        isListening = false
        onError?.('Could not start native speech recognizer: ' + err.message)
        onEnd?.()
      }
      return
    }

    // 2. Web Speech API (SpeechRecognition / webkitSpeechRecognition)
    const SpeechRecClass = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecClass) {
      try {
        const rec = new SpeechRecClass()
        activeWebRec = rec
        rec.lang = lang || navigator.language || 'en-US'
        rec.continuous = true
        rec.interimResults = true
        rec.maxAlternatives = 1

        rec.onstart = () => {
          isListening = true
          onStart?.()
        }

        rec.onresult = (e) => {
          let interimTranscript = ''
          let finalTranscript = ''

          for (let i = 0; i < e.results.length; ++i) {
            const res = e.results[i]
            const text = res[0]?.transcript || ''
            if (res.isFinal) {
              finalTranscript += text + ' '
            } else {
              interimTranscript += text
            }
          }

          const combined = (finalTranscript + interimTranscript).trim()
          if (combined) {
            onResult?.(combined, Boolean(finalTranscript))
          }
        }

        rec.onerror = (e) => {
          console.warn('[UpBeat Speech] Recognition error:', e.error)
          let friendlyMsg = 'Speech recognition encountered an issue.'
          if (e.error === 'not-allowed') {
            friendlyMsg = 'Microphone access was denied. Please allow microphone permissions in your browser/system settings.'
          } else if (e.error === 'no-speech') {
            friendlyMsg = 'No speech detected. Please try speaking closer to your microphone.'
          } else if (e.error === 'network') {
            friendlyMsg = 'Speech service unreachable. Check your internet connection.'
          } else if (e.error === 'audio-capture') {
            friendlyMsg = 'No microphone was found. Please ensure a microphone is connected.'
          }
          isListening = false
          onError?.(friendlyMsg)
          onEnd?.()
        }

        rec.onend = () => {
          isListening = false
          activeWebRec = null
          onEnd?.()
        }

        rec.start()
      } catch (err) {
        console.warn('[UpBeat Speech] Start error:', err)
        isListening = false
        activeWebRec = null
        onError?.('Failed to start speech recognition: ' + (err.message || 'permission required'))
        onEnd?.()
      }
      return
    }

    // 3. Fallback: Request microphone permission directly to alert the user
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          // Microphone works, but Web Speech API is missing in this browser (e.g. Firefox)
          stream.getTracks().forEach((t) => t.stop())
          isListening = false
          onError?.('Speech recognition is not supported in this browser. Please use Chrome, Safari, Edge, or the UpBeat app.')
          onEnd?.()
        })
        .catch((err) => {
          isListening = false
          onError?.('Microphone permission denied. Please grant microphone access in settings.')
          onEnd?.()
        })
    } else {
      isListening = false
      onError?.('Speech recognition is not supported on this platform.')
      onEnd?.()
    }
  }

  const stop = () => {
    isListening = false
    if (hasMacNative) {
      try {
        window.webkit?.messageHandlers?.upbeatNative?.postMessage({
          action: 'stopSpeechRecognition'
        })
      } catch {}
    }
    if (activeWebRec) {
      try {
        activeWebRec.stop()
      } catch {}
      activeWebRec = null
    }
    onEnd?.()
  }

  return {
    start,
    stop,
    getIsListening: () => isListening
  }
}
