import React, { useState, useRef } from 'react'
import { X, Camera, Trash2, Check, User } from 'lucide-react'
import { Avatar, IconButton } from '../ui/primitives'

/**
 * ProfileEditModal
 * Allows user to change display name and upload a profile picture from local device storage.
 * Automatically downsamples images using canvas to prevent localStorage quota exhaustion.
 */
export default function ProfileEditModal({ isOpen, onClose, user, onSave, onNotify }) {
  const [name, setName] = useState(() => user?.name || '')
  const [picture, setPicture] = useState(() => user?.picture || '')
  const [isProcessing, setIsProcessing] = useState(false)
  const fileInputRef = useRef(null)

  if (!isOpen) return null

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      onNotify?.('Please select a valid image file', 'error')
      return
    }

    setIsProcessing(true)
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        try {
          // Scale down to max 280x280 for lightweight, fast localStorage persistence
          const maxDim = 280
          let w = img.width
          let h = img.height
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
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, w, h)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
          setPicture(dataUrl)
        } catch {
          setPicture(event.target.result)
        } finally {
          setIsProcessing(false)
        }
      }
      img.onerror = () => {
        setIsProcessing(false)
        onNotify?.('Failed to process selected image', 'error')
      }
      img.src = event.target.result
    }
    reader.onerror = () => {
      setIsProcessing(false)
      onNotify?.('Failed to read file from storage', 'error')
    }
    reader.readAsDataURL(file)
  }

  const handleRemovePhoto = () => {
    setPicture('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const cleanName = (name || '').trim() || 'You'
    onSave({
      ...(user || {}),
      name: cleanName,
      picture: picture.trim(),
      updatedAt: Date.now()
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-[#141417] border border-white/10 p-6 shadow-2xl text-white select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <h2 className="text-xl font-bold tracking-tight">Edit profile</h2>
          <IconButton label="Close" onClick={onClose} size={36}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6 pt-5">
          {/* Avatar Preview & Storage Upload */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative group">
              <Avatar name={name || 'You'} picture={picture} size={96} className="shadow-lg ring-2 ring-white/10" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                title="Choose photo from device"
                aria-label="Choose photo from device"
                className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity cursor-pointer text-white"
              >
                <Camera className="w-6 h-6" />
                <span className="text-[11px] font-bold">Change</span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="h-8 px-3 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                {picture ? 'Replace photo' : 'Upload photo'}
              </button>

              {picture && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="h-8 px-3 rounded-full bg-white/5 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              )}
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
                autoFocus
                className="flex-1 bg-transparent text-sm font-semibold text-white placeholder:text-white/30 focus:outline-none"
              />
            </div>
            <span className="text-[11px] text-white/40">Visible to friends in Live Jam and presence feed.</span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.08]">
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
