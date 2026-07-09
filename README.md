# Quran Quest 🌙

Interactive web games that help young children memorize short surahs of the Quran — by playing, not drilling.

**Four games, twelve surahs**, all audio-first (no reading required):

- **🌟 Star Path** — fly through the sky catching word-stars in order; each star sings one word, each golden gate recites the full ayah.
- **🏰 Ayah Maze** — explore garden mazes and find the singing door that plays the *next* ayah.
- **⛵ Story Voyage** — sail island to island through the surah's story, hear each ayah and its meaning, then retell the story in order.
- **☁️ Sky Jumper** — bounce up the clouds to the moon; every cloud sings the next word of the surah.

Surahs included: Al-Fatiha, At-Tin, Al-Qadr, At-Takathur, Al-'Asr, Al-Fil, Al-Kafirun, An-Nasr, Al-Masad, Al-Ikhlas, Al-Falaq, An-Nas.

Recitation: Mishary Rashid Alafasy (verse audio local + [everyayah.com](https://everyayah.com) fallback; word-by-word audio from quran.com). Verse meanings are simplified, child-friendly retellings based on Dr. Mustafa Khattab's *The Clear Quran*, spoken aloud with browser text-to-speech.

## Run locally

Any static server works:

```
npx serve .
```

## Deploy

Pushing to `main` auto-deploys to GitHub Pages via the included workflow.

## Adding a surah

1. Add its verse data to `assets/js/surahs.js` (same shape as the others).
2. Drop verse MP3s named `SSSAAA.mp3` (e.g. `108001.mp3`) into `audio/` and add the keys to the `LOCAL` set in `assets/js/engine.js` — or skip this step and the games stream from everyayah.com automatically.
