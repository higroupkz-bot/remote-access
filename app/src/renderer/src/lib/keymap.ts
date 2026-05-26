// Maps browser KeyboardEvent.key values to robotjs key names
const KEY_MAP: Record<string, string> = {
  Backspace: 'backspace', Delete: 'delete', Enter: 'enter', Return: 'enter',
  Tab: 'tab', Escape: 'escape', Insert: 'insert',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
  F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
  ' ': 'space',
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '-': '-', '_': '-', '=': '=', '+': '=',
  '[': '[', '{': '[', ']': ']', '}': ']',
  '\\': '\\', '|': '\\',
  ';': ';', ':': ';', "'": "'", '"': "'",
  ',': ',', '<': ',', '.': '.', '>': '.',
  '/': '/', '?': '/',
  '`': '`', '~': '`',
  CapsLock: 'caps_lock', NumLock: 'num_lock', ScrollLock: 'scroll_lock',
  PrintScreen: 'printscreen', Pause: 'pause',
  AudioVolumeMute: 'audio_mute', AudioVolumeUp: 'audio_vol_up',
  AudioVolumeDown: 'audio_vol_down', MediaPlayPause: 'audio_play',
  MediaStop: 'audio_stop', MediaTrackNext: 'audio_next',
  MediaTrackPrevious: 'audio_prev',
}

export function toRobotKey(key: string): string | null {
  if (key.length === 1 && key.match(/[a-z]/i)) return key.toLowerCase()
  if (key.length === 1 && key.match(/[0-9]/)) return key
  return KEY_MAP[key] ?? null
}

export function toRobotModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = []
  if (e.shiftKey) mods.push('shift')
  if (e.ctrlKey) mods.push('control')
  if (e.altKey) mods.push('alt')
  if (e.metaKey) mods.push('command')
  return mods
}
