let lastSoundAt = 0
let sharedContext: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (!window.AudioContext) return null
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new AudioContext()
  return sharedContext
}

export function unlockChatSound(): void {
  try {
    const context = audioContext()
    if (context?.state === 'suspended') void context.resume().catch(() => undefined)
  } catch { /* The device may not expose audio output. */ }
}

export function playMentionSound(): void {
  try {
    if (localStorage.getItem('altgrid.preference.chat-sound') === 'false'
      || Date.now() - lastSoundAt < 1500 || !window.AudioContext) return
    lastSoundAt = Date.now()
    const context = audioContext()
    if (!context) return
    void context.resume().then(() => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.connect(gain)
      gain.connect(context.destination)
      const now = context.currentTime
      oscillator.frequency.setValueAtTime(660, now)
      oscillator.frequency.setValueAtTime(880, now + 0.12)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.24, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      oscillator.start(now)
      oscillator.stop(now + 0.32)
    }).catch(() => undefined)
  } catch { /* Audio support and OS mute settings vary by device. */ }
}
