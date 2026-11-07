import React, { useState, useRef, useEffect } from 'react'
import { X, Camera, Trash2, Check, User, FolderOpen, Link2, Settings } from 'lucide-react'
import { Avatar, IconButton } from '../ui/primitives'
import { hasBackend, getApiBase } from '../standaloneApi'
import { navigate } from '../ui/router'

const PRESET_AVATARS = [
  {
    id: 'vinyl',
    label: 'Vinyl',
    svg: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#6366f1"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#g)"/><circle cx="60" cy="60" r="38" fill="#09090b"/><circle cx="60" cy="60" r="26" fill="none" stroke="#27272a" stroke-width="2"/><circle cx="60" cy="60" r="13" fill="#38bdf8"/><circle cx="60" cy="60" r="4" fill="#09090b"/></svg>'
    )}`
  },
  {
    id: 'synth',
    label: 'Synth',
    svg: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#g)"/><path d="M46 76V42l34-6v34" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="76" r="8" fill="#fff"/><circle cx="72" cy="70" r="8" fill="#fff"/></svg>'
    )}`
  },
  {
    id: 'aurora',
    label: 'Aurora',
    svg: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#14b8a6"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#g)"/><g fill="#fff" opacity="0.95"><rect x="30" y="52" width="8" height="22" rx="4"/><rect x="44" y="38" width="8" height="46" rx="4"/><rect x="58" y="30" width="8" height="60" rx="4"/><rect x="72" y="42" width="8" height="38" rx="4"/><rect x="86" y="54" width="8" height="18" rx="4"/></g></svg>'
    )}`
  },
  {
    id: 'midnight',
    label: 'Midnight',
    svg: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#g)"/><path d="M36 66a24 24 0 0 1 48 0" fill="none" stroke="#38bdf8" stroke-width="6" stroke-linecap="round"/><rect x="30" y="60" width="12" height="22" rx="6" fill="#fff"/><rect x="78" y="60" width="12" height="22" rx="6" fill="#fff"/></svg>'
    )}`
  },
  {
    id: 'sunset',
    label: 'Sunset',
    svg: `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f43f5e"/><stop offset="100%" stop-color="#fbbf24"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#g)"/><circle cx="60" cy="54" r="22" fill="#fff" opacity="0.92"/><path d="M24 84h72" stroke="#09090b" stroke-width="5" stroke-linecap="round" opacity="0.35"/></svg>'
    )}`
  }
]

/**
 * ProfileEditModal
 * Allows user to change display name and upload a profile picture from local device storage,
 * Mac native Finder, drag-and-drop, clipboard paste, URL, or preset avatars.
 */
export default function ProfileEditModal({ isOpen, onClose, user, onSave, onNotify }) {
  const [name, setName] = useState(() => user?.name || '')
  const [picture, setPicture] = useState(() => user?.picture || '')
  const [urlInput, setUrlInput] = useState('')
  const [showUrlField, setShowUrlField] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const fileInputRef = useRef(null)

  // Always sync modal fields with latest user prop when opened
  useEffect(() => {
    if (isOpen) {
      setName(user?.name || '')
      setPicture(user?.picture || '')
      setUrlInput('')
      setShowUrlField(false)
      setIsProcessing(false)
    }
  }, [isOpen, user])

  // Listen for native macOS photo selection events from UpBeatApp.swift
  useEffect(() => {
    const onNativeSelected = (e) => {
      const dataUrl = e.detail?.dataUrl
      if (dataUrl) {
        setPicture(dataUrl)
        setIsProcessing(false)
        onNotify?.('Photo selected — click Save changes to apply', 'info')
      }
    }
    const onNativeCancelled = () => {
      setIsProcessing(false)
    }
    window.addEventListener('upbeat-native-photo-selected', onNativeSelected)
    window.addEventListener('upbeat-native-photo-cancelled', onNativeCancelled)
    return () => {
      window.removeEventListener('upbeat-native-photo-selected', onNativeSelected)
      window.removeEventListener('upbeat-native-photo-cancelled', onNativeCancelled)
    }
  }, [onNotify])

  if (!isOpen) return null

  const processImageFile = (file) => {
    if (!file) return
    const isImage = file.type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|bmp|svg)$/i.test(file.name || '')
    if (!isImage) {
      onNotify?.('Please select a valid image file (PNG, JPG, WEBP, GIF)', 'error')
      return
    }

    setIsProcessing(true)
    const reader = new FileReader()
    reader.onload = (event) => {
      const rawDataUrl = event.target?.result
      if (typeof rawDataUrl !== 'string') {
        setIsProcessing(false)
        return
      }
      const img = new Image()
      img.onload = () => {
        try {
          // Scale down to max 320x320 for crisp avatar display & fast persistence
          const maxDim = 320
          let w = img.naturalWidth || img.width || 320
          let h = img.naturalHeight || img.height || 320
          if (w > h) {
            if (w > maxDim) {
              h = Math.round((h * maxDim) / w)
              w = maxDim
            }
          } else {
            if (h > maxDim) {
              w = Math.round((w * maxDim) / h)
              h = maxDim
            }
          }

          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, w)
          canvas.height = Math.max(1, h)
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
          setPicture(dataUrl)
          onNotify?.('Photo selected — click Save changes to apply', 'info')
        } catch {
          setPicture(rawDataUrl)
        } finally {
          setIsProcessing(false)
        }
      }
      img.onerror = () => {
        // Still allow raw data URL if browser couldn't decode onto canvas
        setPicture(rawDataUrl)
        setIsProcessing(false)
      }
      img.src = rawDataUrl
    }
    reader.onerror = () => {
      setIsProcessing(false)
      onNotify?.('Failed to read file from storage', 'error')
    }
    reader.readAsDataURL(file)
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) processImageFile(file)
    e.target.value = ''
  }

  // Unified photo picker: triggers native macOS NSOpenPanel in UpBeat.app or standard file input in browser
  const handleChoosePhoto = () => {
    if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.upbeatNative) {
      setIsProcessing(true)
      try {
        window.webkit.messageHandlers.upbeatNative.postMessage({ action: 'pickProfilePhoto' })
        return
      } catch (err) {
        console.warn('Native message handler error, falling back to input:', err)
      }
    }
    fileInputRef.current?.click()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) {
      processImageFile(file)
      return
    }
    const droppedUrl = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain')
    if (droppedUrl && /^https?:\/\/|^data:image\//i.test(droppedUrl.trim())) {
      setPicture(droppedUrl.trim())
    }
  }

  const handlePaste = (e) => {
    const items = e.clipboardData?.items || []
    for (const item of items) {
      if (item.type?.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          processImageFile(file)
          return
        }
      }
    }
  }

  const handleRemovePhoto = () => {
    setPicture('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleApplyUrl = () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setPicture(trimmed)
    setShowUrlField(false)
    setUrlInput('')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const cleanName = (name || '').trim() || 'You'
    const finalPicture = (urlInput.trim() && showUrlField ? urlInput.trim() : picture || '').trim()
    onSave({
      ...(user || {}),
      name: cleanName,
      picture: finalPicture,
      customPicture: Boolean(finalPicture),
      updatedAt: Date.now()
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
      onPaste={handlePaste}
    >
      <div
        className={`relative w-full max-w-md max-h-[calc(100dvh-24px)] overflow-y-auto overflow-x-hidden box-border rounded-3xl bg-[#141417] border p-5 sm:p-6 shadow-2xl text-white select-none transition-colors ${
          isDraggingOver ? 'border-accent bg-[#181B22]' : 'border-white/10'
        }`}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDraggingOver(true)
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <h2 className="text-xl font-bold tracking-tight">Edit profile</h2>
          <IconButton label="Close" onClick={onClose} size={36}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 pt-5">
          {/* Hidden file input linked via htmlFor for native WebKit & browser compatibility */}
          <input
            ref={fileInputRef}
            id="upbeat-profile-photo-input"
            type="file"
            accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.heic"
            onChange={handleFileChange}
            className="sr-only"
          />

          {/* Avatar Preview & Storage Upload */}
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleChoosePhoto}
              disabled={isProcessing}
              title="Choose photo from device, gallery, or Finder (or drag & drop here)"
              className="relative group cursor-pointer rounded-full"
            >
              <Avatar name={name || 'You'} picture={picture} size={96} className="shadow-lg ring-2 ring-white/15" />
              <span className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity text-white">
                <Camera className="w-6 h-6" />
                <span className="text-[11px] font-bold">{isProcessing ? 'Opening…' : 'Change'}</span>
              </span>
            </button>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleChoosePhoto}
                disabled={isProcessing}
                className="h-8 px-3.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Opening file…' : picture ? 'Replace photo' : 'Upload photo'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowUrlField((v) => !v)}
                className="h-8 px-3 rounded-full bg-white/[0.07] hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Image URL</span>
              </button>

              {picture && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="h-8 px-3 rounded-full bg-white/5 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>

            {showUrlField && (
              <div className="w-full min-w-0 flex items-center gap-2 mt-1">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                  className="flex-1 min-w-0 h-9 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={handleApplyUrl}
                  className="h-9 px-3 shrink-0 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  Use URL
                </button>
              </div>
            )}

            {/* Quick Preset Avatars */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] font-semibold text-white/40 mr-1">Or pick:</span>
              {PRESET_AVATARS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPicture(p.svg)}
                  title={p.label}
                  className={`w-7 h-7 rounded-full overflow-hidden ring-2 transition-transform hover:scale-110 cursor-pointer ${
                    picture === p.svg ? 'ring-white scale-110' : 'ring-transparent opacity-80 hover:opacity-100'
                  }`}
                >
                  <img src={p.svg} alt={p.label} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {/* Display Name Input */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="profile-name-input" className="text-xs font-bold uppercase tracking-wider text-white/60">
              Display name
            </label>
            <div className="h-12 rounded-xl bg-white/[0.06] border border-white/10 flex items-center px-3.5 focus-within:border-white/30 focus-within:ring-1 focus-within:ring-white/20 transition-all">
              <User className="w-4 h-4 text-white/40 mr-2.5 shrink-0" />
              <input
                id="profile-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                maxLength={40}
                className="flex-1 bg-transparent text-sm font-semibold text-white placeholder:text-white/30 focus:outline-none"
              />
            </div>
            <span className="text-[11px] text-white/40">Visible to friends in Live Jam and presence feed. You can also drag & drop or paste an image anywhere here.</span>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between text-xs text-white/50">
            <span>Audio & app preferences</span>
            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/settings')
              }}
              className="inline-flex items-center gap-1.5 text-white/80 hover:text-white font-semibold cursor-pointer transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Open Settings →</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl text-sm font-bold text-white/70 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isProcessing}
              className="h-10 px-5 rounded-xl bg-white hover:bg-white/90 text-[#0A0A0B] text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-md active:scale-95 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
