// Quran Quest — shared engine: audio, speech, sfx, progress, helpers.
(function () {
  const QQ = (window.QQ = {});

  // ---------- error safety net + debug ----------
  const errs = [];
  QQ.frameError = (e) => {
    const msg = (e && (e.stack || e.message)) || String(e);
    if (!errs.includes(msg)) { errs.push(msg); console.error("[QQ frame]", e); }
  };
  window.addEventListener("error", (ev) => errs.push(String(ev.message)));
  window.addEventListener("unhandledrejection", (ev) =>
    errs.push("rej: " + ((ev.reason && ev.reason.message) || ev.reason)));
  if (new URLSearchParams(location.search).get("debug")) {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;bottom:4px;left:4px;z-index:99;font:11px monospace;" +
      "background:rgba(0,0,0,.75);color:#0f0;padding:4px 8px;border-radius:6px;max-width:92vw;white-space:pre-wrap;pointer-events:none";
    let frames = 0, last = performance.now();
    (function tick() {
      frames++;
      const now = performance.now();
      if (now - last > 1000) {
        d.textContent = "fps " + frames + (errs.length ? "\nERR " + errs[errs.length - 1].slice(0, 300) : "");
        frames = 0; last = now;
      }
      requestAnimationFrame(tick);
    })();
    addEventListener("DOMContentLoaded", () => document.body.appendChild(d));
    setTimeout(() => document.body && !d.parentNode && document.body.appendChild(d), 1500);
  }

  // ---------- data helpers ----------
  QQ.surahs = () => window.QURAN_DATA.surahs;
  QQ.getSurah = (slug) =>
    window.QURAN_DATA.surahs.find((s) => s.slug === slug) || null;
  QQ.param = (k) => new URLSearchParams(location.search).get(k);

  // ---------- verse audio (local file first, everyayah fallback) ----------
  // Files present locally in /audio (copied from the user's collection):
  const LOCAL = new Set([
    "001001","001003","001004","001005","001006","001007",
    "097001","097002","097003","097004","097005",
    "102001","102002","102003","102004","102005","102006","102007","102008",
    "103001","103002","103003",
    "105001","105002","105003","105004","105005",
    "109001","109002","109003","109004","109005","109006",
    "110001","110002","110003",
    "111001","111002","111003","111004","111005",
    "113001","113002","113003","113004","113005",
  ]);
  const REMOTE = "https://everyayah.com/data/Alafasy_128kbps/";
  // pages in /games load engine with data-audio-base="../audio/"
  const BASE =
    (document.currentScript && document.currentScript.dataset.audioBase) ||
    "audio/";
  const pad = (x, n) => String(x).padStart(n, "0");
  // candidate URLs, best first; player falls through on error
  QQ.verseUrls = (surahId, n) => {
    const key = pad(surahId, 3) + pad(n, 3);
    return LOCAL.has(key)
      ? [BASE + key + ".mp3", REMOTE + key + ".mp3"]
      : [REMOTE + key + ".mp3"];
  };
  QQ.verseUrl = (surahId, n) => QQ.verseUrls(surahId, n)[0];

  // ---------- playback core ----------
  // Primary path: WebAudio buffers (fetch + decode). No <audio> element reuse,
  // no media-pipeline churn — rapid word/verse/voice sequences stay smooth.
  // Fallback path (file:// or fetch failure): a FRESH <audio> element per play.
  let playToken = 0, curSrc = null, curEl = null;
  const canFetch = typeof fetch === "function" && location.protocol !== "file:";
  const bufCache = new Map(); // url -> Promise<AudioBuffer>
  function fetchBuf(url) {
    if (!bufCache.has(url)) {
      if (bufCache.size > 150) bufCache.delete(bufCache.keys().next().value);
      const p = fetch(url)
        .then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.arrayBuffer(); })
        .then((b) => ac().decodeAudioData(b));
      p.catch(() => bufCache.delete(url));
      bufCache.set(url, p);
    }
    return bufCache.get(url);
  }
  QQ.stopAudio = () => {
    playToken++;
    try { if (curSrc) curSrc.stop(); } catch (e) {}
    curSrc = null;
    try { if (curEl) curEl.pause(); } catch (e) {}
    curEl = null;
    try { speechSynthesis.cancel(); } catch (e) {}
  };
  function playBuf(buf, rate, token) {
    return new Promise((resolve) => {
      const src = ac().createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate || 1;
      src.connect(ac().destination);
      curSrc = src;
      src.onended = () => { if (curSrc === src) curSrc = null; resolve(token === playToken); };
      try { src.start(); } catch (e) { resolve(false); }
      setTimeout(() => resolve(false), (buf.duration / (rate || 1)) * 1000 + 5000);
    });
  }
  function playUrlEl(urls, rate, token) {
    return new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (token !== playToken) return resolve(false);
        if (i >= urls.length) return resolve(false);
        const el = new Audio(urls[i++]); // fresh element every time
        curEl = el;
        el.playbackRate = rate || 1;
        el.onended = () => resolve(token === playToken);
        el.onerror = () => tryNext();
        el.play().catch(() => tryNext());
        setTimeout(() => { if (token === playToken && curEl === el && (el.paused || el.error)) tryNext(); }, 8000);
      };
      tryNext();
      setTimeout(() => resolve(false), 30000); // absolute safety
    });
  }
  async function playUrl(urls, rate) {
    if (!Array.isArray(urls)) urls = [urls];
    QQ.stopAudio();
    const token = playToken;
    if (canFetch) {
      for (const url of urls) {
        let buf = null;
        try { buf = await fetchBuf(url); } catch (e) { continue; }
        if (token !== playToken) return false; // superseded while fetching
        return playBuf(buf, rate, token);
      }
    }
    return playUrlEl(urls, rate, token);
  }
  QQ.playVerse = (surahId, n, rate) => playUrl(QQ.verseUrls(surahId, n), rate);
  QQ.preloadWords = (verse) => {
    if (canFetch && verse && verse.words)
      verse.words.forEach((w) => fetchBuf(w.audio).catch(() => {}));
  };
  QQ.playWord = (url) => playUrl(url);
  QQ.playSurah = async (surah, onVerse) => {
    for (const v of surah.verses) {
      if (onVerse) onVerse(v);
      const done = await QQ.playVerse(surah.id, v.n);
      if (!done) return false; // stopped or failed
      await QQ.wait(350);
    }
    return true;
  };
  // Preload upcoming verses quietly.
  QQ.preload = (surahId, n) => {
    const urls = QQ.verseUrls(surahId, n);
    if (canFetch)
      fetchBuf(urls[0]).catch(() => urls[1] && fetchBuf(urls[1]).catch(() => {}));
  };
  QQ.wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- spoken guidance (all guidance is spoken; the child can't read) ----------
  // Pre-generated ElevenLabs clips (see tools/gen-voice.mjs) are used when
  // available (looked up by text hash in window.QQ_VOICE); otherwise falls
  // back to the browser's speech synthesis.
  QQ.normText = (s) =>
    String(s).replace(/[\[\]()]/g, "").replace(/\s+/g, " ").trim();
  QQ.textKey = (s) => {
    s = QQ.normText(s);
    let x = 5381;
    for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0;
    return x.toString(36);
  };
  let voice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    voice =
      vs.find((v) => /child|kids|junior/i.test(v.name)) ||
      vs.find((v) => /Samantha|Google US English|Zira|Aria|Karen|Moira/i.test(v.name)) ||
      vs.find((v) => /female/i.test(v.name)) ||
      vs[0] || null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  QQ.voiceOn = () => localStorage.getItem("qq_voice") !== "off";
  QQ.setVoice = (on) => localStorage.setItem("qq_voice", on ? "on" : "off");
  QQ.speak = (text, opts) => {
    opts = opts || {};
    if (!opts.force && !QQ.voiceOn()) return Promise.resolve(false);
    // 1) pre-generated warm voice clip
    const key = QQ.textKey(text);
    if (window.QQ_VOICE && window.QQ_VOICE[key])
      return playUrl(BASE + "voice/" + key + ".mp3");
    // 2) browser speech synthesis fallback
    if (!("speechSynthesis" in window)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(QQ.normText(text));
      if (voice) u.voice = voice;
      u.rate = opts.rate || 0.92;
      u.pitch = opts.pitch || 1.08;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      setTimeout(() => resolve(false), 20000);
    });
  };
  // one warm intro clip per surah, shared by hub and all games
  QQ.introText = (s) => "Surah " + s.englishName + "! " + s.kidIntro;
  QQ.speakIntro = (s, opts) => QQ.speak(QQ.introText(s), opts);

  // ---------- tiny synth sfx (no audio files needed) ----------
  let ctx = null;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, t0, dur, type, vol) {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, c.currentTime + t0);
    g.gain.setValueAtTime(0, c.currentTime + t0);
    g.gain.linearRampToValueAtTime(vol || 0.18, c.currentTime + t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + t0);
    o.stop(c.currentTime + t0 + dur + 0.05);
  }
  QQ.sfx = {
    pop: () => { tone(880, 0, 0.12, "triangle", 0.22); tone(1320, 0.05, 0.1, "sine", 0.15); },
    ding: () => { tone(1047, 0, 0.25, "sine", 0.2); tone(1568, 0.08, 0.3, "sine", 0.14); },
    soft: () => tone(220, 0, 0.25, "sine", 0.12),
    hm: () => { tone(330, 0, 0.15, "triangle", 0.12); tone(262, 0.12, 0.22, "triangle", 0.12); },
    whoosh: () => { const c = ac(); for (let i = 0; i < 10; i++) tone(300 + i * 60, i * 0.02, 0.08, "sine", 0.05); },
    fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.3, "triangle", 0.2)); tone(1319, 0.55, 0.5, "sine", 0.18); },
    bounce: () => tone(392, 0, 0.1, "sine", 0.15),
    step: () => tone(660, 0, 0.05, "sine", 0.06),
  };

  // ---------- progress (stars per game per surah) ----------
  function store() {
    try { return JSON.parse(localStorage.getItem("qq_progress") || "{}"); }
    catch (e) { return {}; }
  }
  QQ.getStars = (game, slug) => (store()[game + ":" + slug] || 0);
  QQ.setStars = (game, slug, stars) => {
    const s = store();
    const k = game + ":" + slug;
    s[k] = Math.max(s[k] || 0, stars);
    localStorage.setItem("qq_progress", JSON.stringify(s));
  };
  QQ.totalStars = (slug) =>
    ["starpath", "maze", "story", "jumper"].reduce(
      (a, g) => a + QQ.getStars(g, slug), 0);
  QQ.getLevel = (game, slug) => +(store()["lvl:" + game + ":" + slug] || 1);
  QQ.setLevel = (game, slug, lvl) => {
    const s = store();
    s["lvl:" + game + ":" + slug] = Math.min(3, Math.max(1, lvl));
    localStorage.setItem("qq_progress", JSON.stringify(s));
  };

  // ---------- shared UI bits ----------
  // Big start overlay: needed for audio autoplay policies AND to speak instructions.
  QQ.startOverlay = (title, emoji, spoken, onStart) => {
    const el = document.createElement("div");
    el.className = "qq-start";
    el.innerHTML =
      '<div class="qq-start-card"><div class="qq-start-emoji">' + emoji +
      '</div><div class="qq-start-title">' + title +
      '</div><button class="qq-start-btn" aria-label="Play">▶</button></div>';
    document.body.appendChild(el);
    el.querySelector(".qq-start-btn").addEventListener("click", async () => {
      ac(); // unlock audio
      el.classList.add("qq-hide");
      setTimeout(() => el.remove(), 600);
      if (spoken) await QQ.speak(spoken);
      onStart && onStart();
    });
    return el;
  };

  QQ.hud = (surah, gameName) => {
    const el = document.createElement("div");
    el.className = "qq-hud";
    el.innerHTML =
      '<a class="qq-hud-btn" href="' + (location.pathname.includes("/games/") ? "../index.html" : "index.html") + '" aria-label="Home">🏠</a>' +
      '<div class="qq-hud-title"><span class="qq-hud-emoji">' + surah.emoji + '</span><span class="qq-hud-ar">' + surah.arabicName + "</span></div>" +
      '<button class="qq-hud-btn" id="qqVoiceBtn" aria-label="Meaning voice">' + (QQ.voiceOn() ? "🗣️" : "🤫") + "</button>";
    document.body.appendChild(el);
    el.querySelector("#qqVoiceBtn").addEventListener("click", (e) => {
      QQ.setVoice(!QQ.voiceOn());
      e.target.textContent = QQ.voiceOn() ? "🗣️" : "🤫";
      if (QQ.voiceOn()) QQ.speak("I will tell you what the words mean!");
    });
    return el;
  };

  // Confetti burst on a canvas ctx (games call inside their loop) — or DOM version:
  QQ.domConfetti = (n) => {
    for (let i = 0; i < (n || 40); i++) {
      const p = document.createElement("div");
      p.className = "qq-confetti";
      p.textContent = ["⭐", "✨", "🌟", "💛", "🎉"][i % 5];
      p.style.left = Math.random() * 100 + "vw";
      p.style.animationDelay = Math.random() * 0.8 + "s";
      p.style.fontSize = 14 + Math.random() * 22 + "px";
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 3500);
    }
  };

  // Big celebratory finish screen, shared by all games.
  QQ.finish = async (surah, game, stars, replayFn) => {
    QQ.setStars(game, surah.slug, stars);
    const el = document.createElement("div");
    el.className = "qq-finish";
    el.innerHTML =
      '<div class="qq-finish-card">' +
      '<div class="qq-finish-emoji">' + surah.emoji + '</div>' +
      '<div class="qq-finish-stars">' + "⭐".repeat(stars) + "☆".repeat(3 - stars) + "</div>" +
      '<div class="qq-finish-ar">' + surah.arabicName + "</div>" +
      '<div class="qq-finish-row">' +
      '<button class="qq-big-btn" id="qqAgain" aria-label="Play again">🔁</button>' +
      '<button class="qq-big-btn" id="qqListen" aria-label="Listen">🎧</button>' +
      '<a class="qq-big-btn" href="' + (location.pathname.includes("/games/") ? "../index.html" : "index.html") + '" aria-label="Home">🏠</a>' +
      "</div></div>";
    document.body.appendChild(el);
    QQ.domConfetti(50);
    QQ.sfx.fanfare();
    el.querySelector("#qqAgain").onclick = () => { el.remove(); QQ.stopAudio(); replayFn(); };
    el.querySelector("#qqListen").onclick = async () => {
      QQ.stopAudio();
      const ar = el.querySelector(".qq-finish-ar");
      await QQ.playSurah(surah, (v) => { ar.textContent = v.ar; ar.classList.remove("qq-pulse"); void ar.offsetWidth; ar.classList.add("qq-pulse"); });
      ar.textContent = surah.arabicName;
    };
    await QQ.speak("Mashallah! You did it! You finished the whole surah!");
    return el;
  };

  // Keyboard + touch directional controls; returns {left,right,up,down} live state.
  QQ.controls = (opts) => {
    opts = opts || {};
    const state = { left: false, right: false, up: false, down: false };
    const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "up", a: "left", d: "right", w: "up", s: "down" };
    addEventListener("keydown", (e) => { const k = map[e.key]; if (k) { state[k] = true; e.preventDefault(); } });
    addEventListener("keyup", (e) => { const k = map[e.key]; if (k) state[k] = false; });
    // on-screen buttons for touch/mouse
    const pad = document.createElement("div");
    pad.className = "qq-pad";
    const btns = opts.buttons || ["left", "up", "right"];
    const icon = { left: "◀", right: "▶", up: "⬆", down: "⬇" };
    btns.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "qq-pad-btn";
      btn.textContent = icon[b];
      btn.setAttribute("aria-label", b);
      const on = (e) => { e.preventDefault(); state[b] = true; };
      const off = (e) => { e.preventDefault(); state[b] = false; };
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointerleave", off);
      btn.addEventListener("pointercancel", off);
      pad.appendChild(btn);
    });
    document.body.appendChild(pad);
    return state;
  };

  // Fit a canvas to the window with devicePixelRatio.
  QQ.fitCanvas = (canvas) => {
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener("resize", fit);
    return canvas.getContext("2d");
  };

  // Rounded rect path helper for canvases.
  QQ.rr = (c, x, y, w, h, r) => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
})();
