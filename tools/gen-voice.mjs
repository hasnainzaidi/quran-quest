// Pre-generates every spoken line in the games as an MP3 via the ElevenLabs API.
// Runs in GitHub Actions (see .github/workflows/voice.yml) with ELEVENLABS_API_KEY.
// Output: audio/voice/<textKey>.mp3 + assets/js/voice-manifest.js
// Idempotent: existing clips are skipped, so partial runs resume safely.
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.log("ELEVENLABS_API_KEY not set — skipping voice generation.");
  process.exit(0);
}

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const OUT = path.join(ROOT, "audio", "voice");
fs.mkdirSync(OUT, { recursive: true });

// --- must match QQ.normText / QQ.textKey in assets/js/engine.js exactly ---
const norm = (s) => String(s).replace(/[\[\]()]/g, "").replace(/\s+/g, " ").trim();
const textKey = (s) => {
  s = norm(s);
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0;
  return x.toString(36);
};

// --- collect every spoken line ---
const window = {};
new Function("window", fs.readFileSync(path.join(ROOT, "assets/js/surahs.js"), "utf8"))(window);
const surahs = window.QURAN_DATA.surahs;

const texts = new Map(); // key -> text
const add = (t) => { t = norm(t); if (t) texts.set(textKey(t), t); };

for (const s of surahs) {
  add("Surah " + s.englishName + "! " + s.kidIntro); // QQ.introText
  for (const v of s.verses) {
    add(v.meaning);
    for (const w of v.words) add(w.gloss);
  }
}

// UI lines — keep in sync with the strings spoken in the HTML/JS files.
[
  "I will tell you what the words mean!",
  "Mashallah! You did it! You finished the whole surah!",
  "Welcome to Quran Quest! Pick a surah card. Press the headphones to listen. Then pick a game! Catch the star words on Star Path. Find the singing doors in the Maze. Sail the story boat. Or jump up the clouds! Every game teaches you the surah. Have fun!",
  "Welcome to Star Path! Fly with the arrows, and catch the glowing word stars in order. Each star sings one word of the surah. When you catch them all, fly through the golden gate!",
  "Find the glowing star first!",
  "Welcome to the Ayah Maze! Walk with the arrows. Listen to the ayah, then find the singing doors. Walk into the door that sings the next ayah of the surah. Collect the blue gems to hear the ayah again!",
  "Now find the singing door with the next ayah!",
  "Find the golden door!",
  "Hmm, that ayah is not next. Listen and try another door!",
  "All aboard the story boat! We will sail to every island of the surah. At each island, listen to the ayah, tap the words, and try saying it yourself with the microphone button. Then sail on!",
  "Your turn! Say it out loud!",
  "Beautiful!",
  "Now tell the story! Tap the islands in order, from the first ayah to the last!",
  "Yes!",
  "That comes next!",
  "Great remembering!",
  "Hmm, which ayah comes first? Listen carefully!",
  "Hmm, which ayah comes next? Listen carefully!",
  "Time to jump up to the moon! Steer with the arrows. Bounce on the glowing clouds — each cloud sings one word of the surah in order. Land on the golden star to hear the whole ayah!",
].forEach(add);

console.log(`${texts.size} unique lines, ~${[...texts.values()].join("").length} characters`);

// --- pick a warm storytelling voice ---
const api = (p, opts = {}) =>
  fetch("https://api.elevenlabs.io/v1" + p, {
    ...opts,
    headers: { "xi-api-key": KEY, "content-type": "application/json", ...(opts.headers || {}) },
  });

const DEFAULT_VOICE = "XrExE9yKIg1WjnnlVkGX"; // Matilda — warm premade storytelling voice
let voiceId = process.env.ELEVEN_VOICE_ID;
if (!voiceId) {
  try {
    const res = await api("/voices");
    if (res.ok) {
      const { voices } = await res.json();
      const prefs = ["hope", "matilda", "dorothy", "alice", "lily", "jessica", "sarah", "rachel", "bella"];
      for (const p of prefs) {
        const v = voices.find((v) => v.name && v.name.toLowerCase().includes(p));
        if (v) { voiceId = v.voice_id; console.log("Voice:", v.name, voiceId); break; }
      }
      if (!voiceId && voices[0]) { voiceId = voices[0].voice_id; console.log("Voice (first available):", voices[0].name); }
    } else {
      console.warn("Could not list voices (" + res.status + ") — using default premade voice.");
    }
  } catch (e) {
    console.warn("Voice listing failed — using default premade voice.");
  }
}
if (!voiceId) { voiceId = DEFAULT_VOICE; console.log("Voice: Matilda (default premade)", voiceId); }

// --- generate ---
let made = 0, skipped = 0, failed = 0;
for (const [key, text] of texts) {
  const file = path.join(OUT, key + ".mp3");
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { skipped++; continue; }
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const res = await api(`/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
      method: "POST",
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.25 },
      }),
    });
    if (res.ok) {
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      made++; ok = true;
      if (made % 25 === 0) console.log(`...${made} generated`);
    } else {
      const body = await res.text();
      if (res.status === 401) { console.error("Invalid API key."); process.exit(1); }
      if (body.includes("quota")) { console.error("Quota exhausted — stopping. Generated so far are kept."); attempt = 3; failed++; texts.clear(); break; }
      console.warn(`retry ${attempt} for "${text.slice(0, 40)}": ${res.status}`);
      await new Promise((r) => setTimeout(r, attempt * 2500));
      if (attempt === 3) failed++;
    }
  }
  await new Promise((r) => setTimeout(r, 250)); // be gentle
}

// --- manifest from what actually exists ---
const have = fs.readdirSync(OUT).filter((f) => f.endsWith(".mp3")).map((f) => f.replace(".mp3", ""));
const manifest = "// Auto-generated by tools/gen-voice.mjs\nwindow.QQ_VOICE = {" +
  have.map((k) => JSON.stringify(k) + ":1").join(",") + "};\n";
fs.writeFileSync(path.join(ROOT, "assets/js/voice-manifest.js"), manifest);
console.log(`done: ${made} new, ${skipped} existing, ${failed} failed, manifest lists ${have.length} clips`);
