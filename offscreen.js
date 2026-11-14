// Offscreen document: service workers cannot play audio, so the background
// asks this page to play the alert sound.
import { MSG } from './shared.js';

const BEEPS = [
    { frequency: 800, startAt: 0 },
    { frequency: 1000, startAt: 0.25 }
];
const BEEP_DURATION_S = 0.2;
const MAX_GAIN = 0.3; // full volume is scaled down for comfort

let audioContext = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === MSG.PLAY_SOUND) {
        playAlert(message.volume).catch((error) => console.error('Error playing sound:', error));
        sendResponse(); // acknowledge, so the background's sendMessage settles cleanly
    }
});

async function playAlert(volume) {
    const gain = (Math.min(Math.max(volume, 0), 100) / 100) * MAX_GAIN;
    if (!(gain > 0)) return;

    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    const now = audioContext.currentTime;
    for (const { frequency, startAt } of BEEPS) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gainNode.gain.value = gain;

        oscillator.connect(gainNode).connect(audioContext.destination);
        oscillator.start(now + startAt);
        oscillator.stop(now + startAt + BEEP_DURATION_S);
    }
}
