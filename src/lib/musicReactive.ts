/**
 * Captures the PC's own audio output and drives the "React to music"
 * setting: a cheap Web Audio AnalyserNode measures the current volume level
 * roughly once per animation frame. Only the instantaneous level (0-1) goes
 * over IPC to main — main turns that into an actual color (see
 * electron/main.ts's REPORT_AUDIO_LEVEL handler), which keeps all the color
 * math in one place, shared conceptually with Ambient Sync.
 *
 * This has to live in the renderer rather than the main process: capturing
 * system audio needs `getUserMedia`, which only exists in a DOM/media
 * context. Electron's main process doesn't have one.
 *
 * Only meaningful inside the packaged Electron app — it needs
 * window.hare.getAudioLoopbackSource, which comes from electron/preload.ts
 * calling Electron's real desktopCapturer. The plain-browser dev fallback
 * (src/lib/browserBackend.ts) has no equivalent, so this quietly no-ops
 * there; see isMusicReactiveSupported().
 */

let audioContext: AudioContext | null = null;
let activeStream: MediaStream | null = null;
let rafHandle: number | null = null;
let running = false;

import { BeatDetector, computeBands } from "../../electron/backend/audioAnalysis";

export function isMusicReactiveSupported(): boolean {
  return typeof window !== "undefined" && !!window.hare;
}

export function isMusicReactiveRunning(): boolean {
  return running;
}

export async function startMusicReactive(): Promise<void> {
  if (running) return;
  if (!isMusicReactiveSupported()) {
    console.warn("[HARE] Music Reactive isn't available outside the packaged app.");
    return;
  }

  const sourceId = await window.hare!.getAudioLoopbackSource();
  if (!sourceId) {
    console.warn("[HARE] Music Reactive: no capturable audio source was found.");
    return;
  }

  let media: MediaStream;
  try {
    // Electron's system-audio-loopback trick: Chromium only grants access
    // to the PC's own audio output through this legacy `mandatory`
    // constraint shape tied to a desktopCapturer source id, and Electron
    // only honors it if a matching video track is requested in the same
    // call. The video track is discarded immediately below — only the
    // audio track is actually used.
    media = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
      } as unknown as MediaTrackConstraints,
      video: {
        mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
      } as unknown as MediaTrackConstraints,
    });
  } catch (err) {
    console.warn("[HARE] Music Reactive: couldn't start audio capture:", err);
    // Told to the backend rather than only to the console, so the effect
    // says why it isn't doing anything instead of sitting there silently.
    window.hare?.reportEffectProblem?.(
      "music-reactive",
      "HARE can't hear anything. Windows only shares system audio while something is playing, and some security software blocks it entirely."
    );
    return;
  }

  media.getVideoTracks().forEach((track) => {
    track.stop();
    media.removeTrack(track);
  });
  if (media.getAudioTracks().length === 0) {
    media.getTracks().forEach((t) => t.stop());
    console.warn("[HARE] Music Reactive: capture started but had no audio track.");
    window.hare?.reportEffectProblem?.(
      "music-reactive",
      "Windows shared a screen but no sound. Play something, then turn the effect on again."
    );
    return;
  }
  // Working. Anything recorded from a previous attempt no longer applies.
  window.hare?.reportEffectProblem?.("music-reactive", null);
  activeStream = media;

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(activeStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const beats = new BeatDetector();
  running = true;

  const tick = () => {
    if (!running) return;
    analyser.getByteTimeDomainData(data);
    // RMS of the waveform around its silent midpoint (128), normalized 0-1.
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const centered = (data[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    // Typical music rarely pushes RMS past ~0.3 — scale up so the lighting
    // actually reaches full brightness on loud passages instead of always
    // looking dim.
    const level = Math.min(1, rms * 3.2);

    // The spectrum is what lets lighting tell bass from treble and land on a
    // beat; the level above is kept as the fallback for anything with one LED.
    analyser.getByteFrequencyData(spectrum);
    const bands = computeBands(spectrum);
    const beat = beats.push(bands[0] ?? 0);
    window.hare?.reportAudioSpectrum(bands.length > 0 ? bands : [level], beat);
    rafHandle = requestAnimationFrame(tick);
  };
  rafHandle = requestAnimationFrame(tick);
}

export function stopMusicReactive(): void {
  running = false;
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
}
