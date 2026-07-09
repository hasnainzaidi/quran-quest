// Quran Quest — shared engine: audio, speech, sfx, progress, helpers.
(function () {
  const QQ = (window.QQ = {});

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

  // Single shared player so sounds never overlap.
  const player = new Audio();
  let playToken = 0;
  QQ.stopAudio = () => {
    playToken++;
    player.pause();
    player.currentTime = 0;
    try { speechSynthesis.cancel(); } catch (e) {}
  };
  function playUrl(urls, rate) {
    if (!Array.isArray(urls)) urls = [urls];
    const token = ++playToken;
    return new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (token !== playToken) return;
        if (i >= urls.length) return resolve(false);
        player.pause();
        player.src = urls[i++];
        player.playbackRate = rate || 1;
        player.onended = () => token === playToken && resolve(true);
        player.onerror = () => tryNext(); // fall through to next source
        player.play().catch(() => tryNext());
      };
      tryNext();
      // safety: never hang callers forever
      setTimeout(() => token === playToken && resolve(false), 30000);
    });
  }
  QQ.playVerse = (surahId, n, rate) => playUrl(QQ.verseUrls(surahId, n), rate);
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
    const a = new Audio();
    a.preload = "auto";
    a.src = QQ.verseUrl(surahId, n);
  };
  QQ.wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- text-to-speech (all guidance is spoken; the child can't read) ----------
  let voice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    voice =
      vs.find((v) => /child|kids|junior/i.test(v.name)) ||
      vs.find((v) => /Samantha|Google US English|Zira|Aria/i.test(v.name)) ||
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
    if (!("speechSynthesis" in window) || (!opts.force && !QQ.voiceOn()))
      return Promise.resolve(false);
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = opts.rate || 0.95;
      u.pitch = opts.pitch || 1.05;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      setTimeout(() => resolve(false), 20000);
    });
  };

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
