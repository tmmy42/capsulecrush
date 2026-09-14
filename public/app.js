(() => {
  // Real-device fallback for the "100vh doesn't cover the status bar / is
  // wrong while the mobile toolbar animates" class of bugs: mirror the true
  // visible screen height into a CSS custom property so the fixed
  // background layers (see .bg-checker-layer etc. in style.css) can use it
  // as a last-resort height even on engines where dvh alone isn't enough.
  function syncViewportHeight() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty("--app-vh", `${h}px`);
  }
  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("orientationchange", syncViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewportHeight);
  }

  // ---------- background themes ----------
  // Same checker pattern + star style everywhere — only the two checker
  // colors and the six star colors change between themes (see
  // scratchpad/gen_themes.py: each variant asset is a straight hex-code
  // swap of the original bg-checker.svg / bg-stars.svg, nothing redrawn).
  const BACKGROUND_THEMES = {
    "mint-pink": {
      label: "Mint & Pink",
      checkerUrl: "bg-checker.svg",
      starsUrl: "bg-stars.svg",
      previewColors: ["#CBF3DC", "#FFD9EA"],
      dotColors: ["#FF1F8F", "#8B3DFF", "#00C4FF"],
      // Pink-on-pink (against the FFD9EA checker square) read poorly —
      // swapped from the usual pink-fill/purple-stroke pairing so the
      // fill is a hue that isn't already in this theme's own background.
      nameFill: "#8B3DFF",
      nameStroke: "#FF1F8F",
      cloudFill: "#00C4FF",
    },
    "lavender-yellow": {
      label: "Lavender & Yellow",
      checkerUrl: "bg-checker-lavender-yellow.svg",
      starsUrl: "bg-stars-lavender-yellow.svg",
      previewColors: ["#E4DBFF", "#FFF1B8"],
      dotColors: ["#FFC400", "#8B3DFF", "#FF8FD8"],
      nameFill: "#FFC400",
      nameStroke: "#8B3DFF",
      cloudFill: "#FF8FD8",
    },
    "sky-coral": {
      label: "Sky & Coral",
      checkerUrl: "bg-checker-sky-coral.svg",
      starsUrl: "bg-stars-sky-coral.svg",
      previewColors: ["#CFEFFF", "#FFD6C9"],
      dotColors: ["#FF6B4A", "#00A3FF", "#FF5FA0"],
      nameFill: "#FF6B4A",
      nameStroke: "#00A3FF",
      cloudFill: "#FF5FA0",
    },
    "grape-peach": {
      label: "Grape & Peach",
      checkerUrl: "bg-checker-grape-peach.svg",
      starsUrl: "bg-stars-grape-peach.svg",
      previewColors: ["#EAD8FF", "#FFE3CC"],
      dotColors: ["#FF8A4C", "#8B3DFF", "#FF5FA0"],
      nameFill: "#FF8A4C",
      nameStroke: "#8B3DFF",
      cloudFill: "#FF5FA0",
    },
  };
  const DEFAULT_THEME = "mint-pink";

  function applyBackgroundTheme(themeId) {
    const theme = BACKGROUND_THEMES[themeId] ? themeId : DEFAULT_THEME;
    const cfg = BACKGROUND_THEMES[theme];
    // Uses document.querySelector directly rather than the $ shorthand,
    // since this runs before $ is declared (called immediately on load
    // so a returning user's theme applies with no flash of the default).
    document.querySelector(".bg-checker-layer").style.backgroundImage = `url('${cfg.checkerUrl}')`;
    document.querySelector(".stars-overlay").style.backgroundImage = `url('${cfg.starsUrl}')`;
    state.backgroundTheme = theme;
    localStorage.setItem("cc_bg_theme", theme);
  }

  const state = {
    token: localStorage.getItem("cc_token") || null,
    username: localStorage.getItem("cc_username") || null,
    partnerName: localStorage.getItem("cc_partner_name") || null,
    backgroundTheme: localStorage.getItem("cc_bg_theme") || DEFAULT_THEME,
    capsules: [],
    editingId: null,
    isGashaRunning: false,
  };
  // Apply immediately (even before any login check) so a returning user's
  // chosen background shows with no flash of the default theme.
  applyBackgroundTheme(state.backgroundTheme);

  const $ = (sel) => document.querySelector(sel);
  const screens = {
    auth: $("#screen-auth"),
    home: $("#screen-home"),
    post: $("#screen-post"),
    list: $("#screen-list"),
    settings: $("#screen-settings"),
  };
  const bottomNav = $("#bottom-nav");

  async function api(path, options = {}) {
    const headers = options.headers || {};
    if (state.token) headers["authorization"] = `Bearer ${state.token}`;
    if (options.body && !(options.body instanceof FormData)) {
      headers["content-type"] = "application/json";
    }
    const res = await fetch(path, { ...options, headers });
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      throw new Error((data && data.error) || `Something went wrong (${res.status})`);
    }
    return data;
  }

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => el.classList.toggle("hidden", key !== name));
    bottomNav.classList.toggle("hidden", name === "auth");
    if (name !== "auth") {
      document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.nav === name);
      });
    }
    if (name === "home") refreshHome();
    if (name === "list") refreshList();
    if (name === "post" && !state.editingId) resetPostForm();
    if (name === "settings") renderSettingsScreen();
    requestAnimationFrame(updateScrollHint);
  }

  // ---------- auth ----------

  function setLoggedIn(token, username, partnerName, backgroundTheme) {
    state.token = token;
    state.username = username;
    state.partnerName = partnerName;
    applyBackgroundTheme(backgroundTheme || DEFAULT_THEME);
    localStorage.setItem("cc_token", token);
    localStorage.setItem("cc_username", username);
    localStorage.setItem("cc_partner_name", partnerName);
    applyPersonalization();
    showScreen("home");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function nameSpan(name) {
    return `<span class="partner-name">${escapeHtml(name)}</span>`;
  }

  function applyPersonalization() {
    const name = state.partnerName || "them";
    const n = nameSpan(name);
    $("#home-subtitle").innerHTML = `Favorite things about ${n}`;
    $("#post-text-label").innerHTML = `What do you love about ${n}?`;
    $("#list-title").innerHTML = `${n}'s Capsules`;
    const heart = `<svg class="icon icon-inline icon-heart" aria-hidden="true"><use href="#icon-heart"/></svg>`;
    const collectionLine = `What do you love about ${n}?<br class="collection-break"> — Start the collection ${heart}`;
    $("#empty-state-text").innerHTML = collectionLine;
    $("#list-empty-text").innerHTML = collectionLine;
  }

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#login-error");
    errorEl.textContent = "";
    try {
      const username = $("#login-username").value.trim();
      const partner_name = $("#login-passcode").value;
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, partner_name }),
      });
      setLoggedIn(data.token, data.username, data.partner_name, data.background_theme);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  $("#form-signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#signup-error");
    errorEl.textContent = "";
    try {
      const username = $("#signup-username").value.trim();
      const partner_name = $("#signup-passcode").value;
      const data = await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ username, partner_name }),
      });
      setLoggedIn(data.token, data.username, data.partner_name, data.background_theme);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  // ---------- button press feedback (pop/bounce on every button-like control) ----------

  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("button, .file-trigger");
    if (!btn) return;
    btn.classList.remove("btn-pop");
    void btn.offsetWidth; // reflow so a repeated tap restarts the animation
    btn.classList.add("btn-pop");
  });
  document.addEventListener("animationend", (e) => {
    if (e.animationName === "btn-pop") e.target.classList.remove("btn-pop");
  });

  // ---------- scroll-down hint ----------

  const scrollHint = $("#scroll-hint");
  function updateScrollHint() {
    const doc = document.documentElement;
    const canScrollMore = doc.scrollHeight - window.innerHeight - window.scrollY > 24;
    scrollHint.classList.toggle("hidden", !canScrollMore);
  }
  window.addEventListener("scroll", updateScrollHint, { passive: true });
  window.addEventListener("resize", updateScrollHint);
  document.addEventListener("load", updateScrollHint, true); // images loading can change page height
  new MutationObserver(updateScrollHint).observe($("#app"), { childList: true, subtree: true, attributes: true });

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const isLogin = tab.dataset.tab === "login";
      $("#form-login").classList.toggle("hidden", !isLogin);
      $("#form-signup").classList.toggle("hidden", isLogin);
    });
  });

  $("#btn-logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (_) { /* ignore */ }
    state.token = null;
    state.username = null;
    state.partnerName = null;
    localStorage.removeItem("cc_token");
    localStorage.removeItem("cc_username");
    localStorage.removeItem("cc_partner_name");
    localStorage.removeItem("cc_bg_theme");
    applyBackgroundTheme(DEFAULT_THEME);
    showScreen("auth");
  });

  // ---------- navigation ----------

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.nav === "post") { state.editingId = null; }
      showScreen(el.dataset.nav);
    });
  });

  $("#btn-settings").addEventListener("click", () => showScreen("settings"));
  $("#btn-settings-back").addEventListener("click", () => showScreen("home"));

  // ---------- settings / background theme ----------

  // Shared swatch-grid builder — used both for the persistent Settings
  // theme picker and the one-off album-background picker in the album
  // setup modal, which has its own separate (non-persisted) selection.
  function buildThemeSwatchGrid(container, selectedId, onSelect) {
    container.innerHTML = "";
    Object.entries(BACKGROUND_THEMES).forEach(([id, cfg]) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "theme-swatch" + (id === selectedId ? " active" : "");
      const gradient = `linear-gradient(135deg, ${cfg.previewColors[0]} 50%, ${cfg.previewColors[1]} 50%)`;
      swatch.innerHTML = `
        <div class="theme-swatch-preview" style="background:${gradient}">
          <div class="theme-swatch-dots">
            ${cfg.dotColors.map((c) => `<span style="background:${c}"></span>`).join("")}
          </div>
        </div>
        <span class="theme-swatch-check"><svg class="icon" aria-hidden="true"><use href="#icon-check"/></svg></span>
        <span>${escapeHtml(cfg.label)}</span>
      `;
      swatch.addEventListener("click", () => onSelect(id));
      container.appendChild(swatch);
    });
  }

  function renderThemeGrid() {
    buildThemeSwatchGrid($("#theme-grid"), state.backgroundTheme, selectBackgroundTheme);
  }

  function renderSettingsScreen() {
    renderThemeGrid();
    $("#profile-username").value = state.username || "";
    $("#profile-partner-name").value = state.partnerName || "";
    $("#profile-error").textContent = "";
    $("#profile-success").classList.add("hidden");
  }

  async function selectBackgroundTheme(themeId) {
    if (themeId === state.backgroundTheme) return;
    const previous = state.backgroundTheme;
    applyBackgroundTheme(themeId);
    renderThemeGrid();
    try {
      await api("/api/auth/theme", {
        method: "PUT",
        body: JSON.stringify({ background_theme: themeId }),
      });
    } catch (err) {
      applyBackgroundTheme(previous);
      renderThemeGrid();
      alert("Couldn't save that background: " + err.message);
    }
  }

  // ---------- settings / profile ----------

  $("#form-profile").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#profile-error");
    const successEl = $("#profile-success");
    errorEl.textContent = "";
    successEl.classList.add("hidden");
    const submitBtn = $("#profile-submit");
    submitBtn.disabled = true;
    try {
      const username = $("#profile-username").value.trim();
      const partner_name = $("#profile-partner-name").value.trim();
      const data = await api("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify({ username, partner_name }),
      });
      // The session token is tied to the account, not the credentials, so
      // this takes effect immediately without needing to log back in —
      // only the next login will require the new "their name" passcode.
      state.username = data.username;
      state.partnerName = data.partner_name;
      localStorage.setItem("cc_username", data.username);
      localStorage.setItem("cc_partner_name", data.partner_name);
      applyPersonalization();
      successEl.classList.remove("hidden");
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- home / gasha ----------

  async function refreshHome() {
    try {
      const data = await api("/api/capsules");
      state.capsules = data.capsules;
      const hasCapsules = state.capsules.length > 0;
      $("#empty-state").classList.toggle("hidden", hasCapsules);
      $(".gasha-stage").style.display = "flex";
    } catch (err) {
      console.error(err);
    }
  }

  const lever = $("#lever");
  const fallingCapsule = $("#falling-capsule");
  const btnGasha = $("#btn-gasha");
  let leverRotation = 0;

  async function runGasha() {
    if (state.isGashaRunning) return;
    if (state.capsules.length === 0) {
      showScreen("post");
      return;
    }
    state.isGashaRunning = true;
    btnGasha.disabled = true;

    // Spin only the dial (720deg), forward each time rather than snapping
    // back, then let the capsule drop once it's done turning.
    leverRotation += 720;
    lever.style.transform = `rotate(${leverRotation}deg)`;
    await wait(600);

    let capsule;
    try {
      const data = await api("/api/capsules/random");
      capsule = data.capsule;
    } catch (err) {
      alert(err.message);
      state.isGashaRunning = false;
      btnGasha.disabled = false;
      return;
    }

    fallingCapsule.classList.remove("hidden", "dropping", "popping");
    void fallingCapsule.offsetWidth; // reflow to restart animation
    fallingCapsule.classList.add("dropping");
    await wait(1100);

    fallingCapsule.classList.add("popping");
    await wait(400);

    fallingCapsule.classList.add("hidden");
    fallingCapsule.classList.remove("dropping", "popping");

    showResult(capsule);
    state.isGashaRunning = false;
    btnGasha.disabled = false;
  }

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  btnGasha.addEventListener("click", runGasha);
  lever.addEventListener("click", runGasha);

  function showResult(capsule) {
    $("#result-text").textContent = capsule.text;
    const dateStr = capsule.memo_date || capsule.created_at.slice(0, 10);
    $("#result-date").textContent = formatDate(dateStr);
    const img = $("#result-image");
    if (capsule.image_key) {
      img.src = `/api/images/${capsule.image_key}`;
      img.classList.remove("hidden");
    } else {
      img.classList.add("hidden");
      img.src = "";
    }
    $("#result-modal").classList.remove("hidden");
  }

  $("#result-close").addEventListener("click", () => $("#result-modal").classList.add("hidden"));
  $("#result-again").addEventListener("click", () => {
    $("#result-modal").classList.add("hidden");
    runGasha();
  });

  const dateFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });
  function formatDate(str) {
    const d = new Date(str + (str.length <= 10 ? "T00:00:00" : ""));
    if (isNaN(d.getTime())) return str;
    return dateFormatter.format(d);
  }

  // ---------- post ----------

  let pendingImageKey = null;
  let pendingImageBlob = null; // cropped image ready to upload, overrides pendingImageKey

  function resetPostForm() {
    state.editingId = null;
    pendingImageKey = null;
    pendingImageBlob = null;
    $("#post-title").innerHTML = `New Capsule for ${nameSpan(state.partnerName || "them")}`;
    $("#post-text").value = "";
    $("#post-date").value = "";
    $("#post-image").value = "";
    $("#post-image-filename").textContent = "No file chosen";
    $("#post-image-preview").classList.add("hidden");
    $("#post-image-preview").src = "";
    $("#post-submit").textContent = "Seal the Capsule";
    $("#post-cancel-edit").classList.add("hidden");
    $("#post-error").textContent = "";
  }

  // ---------- photo crop ----------
  // The crop frame's aspect ratio matches how photos actually render in the
  // app (the list-view capsule card thumbnail: a fixed-height, object-fit:
  // cover strip), so what the user crops is exactly what they'll see later.
  const CROP_ASPECT_RATIO = 3 / 2;

  const cropModal = $("#crop-modal");
  const cropImage = $("#crop-image");
  const cropZoom = $("#crop-zoom");
  let cropper = null;

  function openCropModal(dataUrl) {
    cropImage.src = dataUrl;
    cropModal.classList.remove("hidden");
    if (cropper) cropper.destroy();
    cropper = new Cropper(cropImage, {
      aspectRatio: CROP_ASPECT_RATIO,
      viewMode: 1,
      dragMode: "move",
      autoCropArea: 1,
      background: false,
      responsive: true,
      zoomOnWheel: true,
      ready() {
        // Match the slider's starting position to cropper's own initial
        // fit-to-frame zoom ratio so the first drag doesn't jump the image
        const img = cropper.getImageData();
        const ratio = img.width / img.naturalWidth;
        cropZoom.min = (ratio * 0.4).toFixed(2);
        cropZoom.max = (ratio * 4).toFixed(2);
        cropZoom.value = ratio.toFixed(2);
      },
    });
  }
  // Keep the slider in sync when the user pinches/scroll-wheels to zoom
  cropImage.addEventListener("zoom", (e) => {
    cropZoom.value = e.detail.ratio;
  });

  function closeCropModal() {
    cropModal.classList.add("hidden");
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
  }

  cropZoom.addEventListener("input", () => {
    if (cropper) cropper.zoomTo(parseFloat(cropZoom.value));
  });

  $("#crop-cancel").addEventListener("click", () => {
    closeCropModal();
    $("#post-image").value = "";
    $("#post-image-filename").textContent = "No file chosen";
  });

  $("#crop-confirm").addEventListener("click", () => {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
      width: 900,
      height: Math.round(900 / CROP_ASPECT_RATIO),
      imageSmoothingQuality: "high",
    });
    canvas.toBlob((blob) => {
      pendingImageBlob = blob;
      $("#post-image-preview").src = canvas.toDataURL("image/jpeg", 0.9);
      $("#post-image-preview").classList.remove("hidden");
      closeCropModal();
    }, "image/jpeg", 0.9);
  });

  $("#post-image").addEventListener("change", () => {
    const file = $("#post-image").files[0];
    $("#post-image-filename").textContent = file ? file.name : "No file chosen";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => openCropModal(reader.result);
    reader.readAsDataURL(file);
  });

  $("#post-cancel-edit").addEventListener("click", () => {
    resetPostForm();
    showScreen("list");
  });

  $("#form-post").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#post-error");
    errorEl.textContent = "";
    const submitBtn = $("#post-submit");
    submitBtn.disabled = true;

    try {
      const text = $("#post-text").value.trim();
      const memo_date = $("#post-date").value || null;

      let image_key = pendingImageKey;
      if (pendingImageBlob) {
        const fd = new FormData();
        fd.append("image", pendingImageBlob, "capsule.jpg");
        const uploadRes = await api("/api/upload", { method: "POST", body: fd });
        image_key = uploadRes.image_key;
      }

      if (state.editingId) {
        await api(`/api/capsules/${state.editingId}`, {
          method: "PUT",
          body: JSON.stringify({ text, memo_date, image_key }),
        });
      } else {
        await api("/api/capsules", {
          method: "POST",
          body: JSON.stringify({ text, memo_date, image_key }),
        });
      }

      resetPostForm();
      showScreen("list");
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- list ----------

  async function refreshList() {
    try {
      const data = await api("/api/capsules");
      state.capsules = data.capsules;
      renderList();
    } catch (err) {
      console.error(err);
    }
  }

  function renderList() {
    const grid = $("#list-grid");
    const empty = $("#list-empty");
    grid.innerHTML = "";
    empty.classList.toggle("hidden", state.capsules.length > 0);
    $("#btn-create-album").classList.toggle("hidden", state.capsules.length === 0);

    state.capsules.forEach((capsule) => {
      const card = document.createElement("div");
      card.className = "capsule-card";

      const img = capsule.image_key
        ? `<img src="/api/images/${capsule.image_key}" alt="Attached memory photo" />`
        : "";
      const dateStr = capsule.memo_date || capsule.created_at.slice(0, 10);

      card.innerHTML = `
        ${img}
        <div class="card-date">${formatDate(dateStr)}</div>
        <div class="card-text" lang="ja"></div>
        <div class="card-actions">
          <button data-action="edit"><svg class="icon" aria-hidden="true"><use href="#icon-pen"/></svg>Edit</button>
          <button data-action="delete" class="danger"><svg class="icon" aria-hidden="true"><use href="#icon-trash"/></svg>Delete</button>
        </div>
      `;
      card.querySelector(".card-text").textContent = capsule.text;

      card.querySelector('[data-action="edit"]').addEventListener("click", () => startEdit(capsule));
      card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteCapsule(capsule.id));

      grid.appendChild(card);
    });
  }

  function startEdit(capsule) {
    state.editingId = capsule.id;
    pendingImageKey = capsule.image_key || null;
    pendingImageBlob = null;
    $("#post-title").innerHTML = `Edit Capsule for ${nameSpan(state.partnerName || "them")}`;
    $("#post-text").value = capsule.text;
    $("#post-date").value = capsule.memo_date || "";
    $("#post-image").value = "";
    $("#post-image-filename").textContent = "No file chosen";
    if (capsule.image_key) {
      $("#post-image-preview").src = `/api/images/${capsule.image_key}`;
      $("#post-image-preview").classList.remove("hidden");
    } else {
      $("#post-image-preview").classList.add("hidden");
    }
    $("#post-submit").textContent = "Save Changes";
    $("#post-cancel-edit").classList.remove("hidden");
    $("#post-error").textContent = "";
    showScreen("post");
  }

  async function deleteCapsule(id) {
    if (!confirm("Delete this capsule? This cannot be undone.")) return;
    try {
      await api(`/api/capsules/${id}`, { method: "DELETE" });
      await refreshList();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- album ----------

  let albumBlob = null;
  let albumSetupTheme = DEFAULT_THEME;

  // Custom thought-bubble icon appended right after the tagline text — a
  // bumpy cloud silhouette with two small trailing circles beneath it,
  // the classic "thinking" bubble shape. Not in Lucide's set, so hand-
  // drawn here rather than adapted from an existing icon. Fixed black
  // outline / white fill regardless of theme, per spec. Encoded as a
  // base64 data-URI <img> rather than an inline <svg> — testing showed
  // html2canvas silently drops raw inline SVG subtrees but handles
  // actual <img> elements (data URIs included) reliably via plain
  // drawImage.
  function buildTaglineIcon() {
    // A simple 3-lobe cloud (three rounded arcs — left, top, right — plus
    // a flat bottom edge). The two trailing circles sit further left of
    // the cloud (viewBox extended into negative x to make room), so
    // cloud -> near circle -> far circle flows as one diagonal down-left
    // line instead of stacking near-vertically. The whole icon is placed
    // lower via its own CSS vertical-align rather than shifting
    // coordinates here.
    const svgMarkup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="-6 0 60 60">` +
      `<path d="M15,34 A6.5,6.5 0 0 1 15,21 A9,9 0 0 1 33,18 A8,8 0 0 1 46,27 A6.5,6.5 0 0 1 42,34 Z" ` +
      `fill="#FFFFFF" stroke="#1A1A1A" stroke-width="2.2" stroke-linejoin="round"/>` +
      `<circle cx="8" cy="45" r="5.5" fill="#FFFFFF" stroke="#1A1A1A" stroke-width="2.2"/>` +
      `<circle cx="-2" cy="55" r="3" fill="#FFFFFF" stroke="#1A1A1A" stroke-width="2.2"/>` +
      `</svg>`;
    const dataUri = `data:image/svg+xml;base64,${btoa(svgMarkup)}`;
    return `<img class="album-tagline-icon" src="${dataUri}" width="60" height="60" alt="" />`;
  }

  // Diagonal accent "blades" flanking each side of the from/to names,
  // like "\\ Name /" — two tapered polygons per side (wide flat top
  // edge, narrower flat bottom edge — a trapezoid, not a point), a
  // primary blade plus a shorter, steeper-angled one further outside it
  // (away from the text), so the pair reads like a bent "く" mark rather
  // than a single flourish. Same fill/outline/taper style on both. Sharp
  // mitered corners throughout (no rounded caps, no pointed tip) — round
  // line caps on an earlier thick-stroke version extended past the
  // declared viewBox and got silently clipped by the SVG's own default
  // overflow:hidden, which this avoids by keeping every vertex safely
  // inside the box with a margin. Left leans "\", right leans "/" (a
  // mirror of the left pair), framing the text.
  function buildAccentLine(fillColor, strokeColor, side) {
    const w = 48;
    const primaryLeft = [
      [20, 10],
      [32, 4],
      [46, 38],
      [42, 40],
    ];
    // Same shape/angle as before, just translated straight down (x
    // unchanged) so its bottom tip lines up with the primary blade's
    // bottom edge (y 38/40) instead of sitting up near the top.
    // Shifted +3 in x from the first pass to sit closer to the primary
    // blade (narrower gap), y unchanged so the bottom-tip alignment
    // holds.
    // Shifted +2 more in x from the previous pass, bringing it even
    // closer to the primary blade. y unchanged so bottom-tip alignment
    // still holds.
    const outerLeft = [
      [6, 31],
      [12, 25],
      [21, 38],
      [19, 40],
    ];
    const mirror = (pts) => pts.map(([x, y]) => [w - x, y]);
    const primary = side === "left" ? primaryLeft : mirror(primaryLeft);
    const outer = side === "left" ? outerLeft : mirror(outerLeft);
    const toAttr = (pts) => pts.map(([x, y]) => `${x},${y}`).join(" ");
    const polygon = (pts) =>
      `<polygon points="${toAttr(pts)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" stroke-linejoin="miter"/>`;
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="44" viewBox="0 0 ${w} 44">${polygon(outer)}${polygon(primary)}</svg>`;
    const dataUri = `data:image/svg+xml;base64,${btoa(svgMarkup)}`;
    return `<img class="album-names-accent" src="${dataUri}" width="${w}" height="44" alt="" />`;
  }

  // Faux text-stroke via eight stacked, unblurred text-shadows — far more
  // reliably rasterized by html2canvas than -webkit-text-stroke, which it
  // doesn't consistently render.
  function textOutlineStyle(strokeColor) {
    const offsets = ["-2px -2px", "2px -2px", "-2px 2px", "2px 2px", "0 -2px", "0 2px", "-2px 0", "2px 0"];
    const shadow = offsets.map((o) => `${o} 0 ${strokeColor}`).join(", ");
    return `text-shadow: ${shadow};`;
  }

  // Hiragana, katakana, and CJK ideographs — if a from/to name contains
  // any, it renders in the app's Japanese font instead of the Latin
  // display serif, matching every other Japanese text field in the app.
  function containsJapanese(str) {
    return /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/.test(str);
  }
  function nameFontStyle(text) {
    return containsJapanese(text)
      ? "font-family: var(--font-ja); font-style: normal; font-weight: 700;"
      : "font-family: var(--font-heading); font-style: italic; font-weight: 800;";
  }

  function buildAlbumMarkup(capsules, fromName, toName, theme) {
    const bgClasses = ["", "album-card-b", "album-card-c"];
    const cards = capsules
      .map((c, i) => {
        const dateStr = c.memo_date || c.created_at.slice(0, 10);
        const rotate = i % 2 === 0 ? -2 : 1.6;
        const bgClass = bgClasses[i % bgClasses.length];
        const img = c.image_key
          ? `<img src="/api/images/${c.image_key}" class="album-card-img" alt="" />`
          : "";
        return `
          <div class="album-card ${bgClass}" style="transform: rotate(${rotate}deg)">
            ${img}
            <div class="album-card-date">${escapeHtml(formatDate(dateStr))}</div>
            <div class="album-card-text">${escapeHtml(c.text)}</div>
          </div>
        `;
      })
      .join("");

    // No wordmark here on purpose — the gift is the from/to pairing and
    // the collected memories, not a branded template.
    const nameColorStyle = `color:${theme.nameFill}; ${textOutlineStyle(theme.nameStroke)}`;
    return `
      <div class="album-header">
        <div class="album-names" style="${nameColorStyle}">
          ${buildAccentLine(theme.nameFill, theme.nameStroke, "left")}
          <span style="${nameFontStyle(fromName)}">${escapeHtml(fromName)}</span>
          <span class="album-names-to">to</span>
          <span style="${nameFontStyle(toName)}">${escapeHtml(toName)}</span>
          ${buildAccentLine(theme.nameFill, theme.nameStroke, "right")}
        </div>
        <div class="album-tagline">Things I love about you&hellip; ${buildTaglineIcon()}</div>
      </div>
      <div class="album-grid">${cards}</div>
    `;
  }

  function renderAlbumThemeGrid() {
    buildThemeSwatchGrid($("#album-theme-grid"), albumSetupTheme, (id) => {
      albumSetupTheme = id;
      renderAlbumThemeGrid();
    });
  }

  function openAlbumSetup() {
    if (state.capsules.length === 0) return;
    $("#album-from-name").value = state.username || "";
    $("#album-to-name").value = state.partnerName || "";
    albumSetupTheme = state.backgroundTheme;
    renderAlbumThemeGrid();
    $("#album-setup-modal").classList.remove("hidden");
  }

  async function generateAlbum(fromName, toName, themeId) {
    const btn = $("#album-setup-generate");
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-rotate"/></svg> Generating...`;

    const container = $("#album-render");
    try {
      const theme = BACKGROUND_THEMES[themeId] || BACKGROUND_THEMES[DEFAULT_THEME];
      container.style.backgroundImage = `url('${theme.checkerUrl}')`;
      container.innerHTML = buildAlbumMarkup(state.capsules, fromName || "me", toName || "you", theme);

      const imgs = Array.from(container.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
              })
        )
      );
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      const canvas = await html2canvas(container, {
        backgroundColor: "#CBF3DC",
        scale: 2,
        useCORS: true,
      });

      albumBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      $("#album-preview-img").src = URL.createObjectURL(albumBlob);
      $("#album-setup-modal").classList.add("hidden");
      $("#album-modal").classList.remove("hidden");
    } catch (err) {
      alert("Couldn't create the album: " + err.message);
    } finally {
      container.innerHTML = "";
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }

  $("#btn-create-album").addEventListener("click", openAlbumSetup);
  $("#album-setup-close").addEventListener("click", () => $("#album-setup-modal").classList.add("hidden"));
  $("#album-setup-generate").addEventListener("click", () => {
    const fromName = $("#album-from-name").value.trim();
    const toName = $("#album-to-name").value.trim();
    generateAlbum(fromName, toName, albumSetupTheme);
  });
  $("#album-close").addEventListener("click", () => $("#album-modal").classList.add("hidden"));

  $("#album-download").addEventListener("click", () => {
    if (!albumBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(albumBlob);
    a.download = `capsulecrush-album-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  $("#album-share").addEventListener("click", async () => {
    if (!albumBlob) return;
    const file = new File([albumBlob], "capsulecrush-album.png", { type: "image/png" });
    const shareData = { files: [file], title: "Things I love about you" };
    // Web platforms have no API to write straight into the camera roll —
    // routing through the native share sheet (which offers "Save Image"/
    // "Save to Photos" on iOS and Android) is the closest equivalent.
    if (navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== "AbortError") alert(err.message);
      }
    } else {
      $("#album-download").click();
    }
  });

  // ---------- init ----------

  async function init() {
    if (!state.token) {
      showScreen("auth");
      return;
    }
    try {
      // Always sync from the server (not just when partnerName is missing)
      // so a background theme chosen on another device also applies here.
      const me = await api("/api/auth/me");
      state.partnerName = me.partner_name;
      localStorage.setItem("cc_partner_name", me.partner_name);
      applyBackgroundTheme(me.background_theme);
    } catch (_) {
      // session invalid/expired — send back to auth
      state.token = null;
      localStorage.removeItem("cc_token");
      localStorage.removeItem("cc_username");
      localStorage.removeItem("cc_partner_name");
      showScreen("auth");
      return;
    }
    applyPersonalization();
    showScreen("home");
  }

  init();
})();
