

## Plan: Play music while logo spins

### What
Copy the uploaded MP3 to the project and play/pause it in sync with the `logoSpinning` state. Music pauses (not resets) when spinning stops, and only resets on page reload.

### Implementation

**1. Copy the audio file**
- Copy `user-uploads://vibium-valentine-_4-2026-02.mp3` to `public/vibium-valentine.mp3`

**2. Add audio playback logic in `RecordStudio.jsx`**
- Create a persistent `useRef` for an `Audio` object, initialized once with the MP3 path
- Add a `useEffect` that watches `logoSpinning`:
  - `true` → call `audioRef.current.play()`
  - `false` → call `audioRef.current.pause()` (preserves position automatically)
- No cleanup resets the `currentTime` — only a page reload recreates the Audio object, which naturally resets

```js
const logoAudioRef = useRef(new Audio("/vibium-valentine.mp3"));
logoAudioRef.current.loop = true;

useEffect(() => {
  if (logoSpinning) {
    logoAudioRef.current.play().catch(() => {});
  } else {
    logoAudioRef.current.pause();
  }
}, [logoSpinning]);
```

The `.catch(() => {})` handles browser autoplay restrictions gracefully (first interaction will be user-initiated so it should work fine).

