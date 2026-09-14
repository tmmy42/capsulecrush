(() => {
  const state = {
    token: localStorage.getItem("cc_token") || null,
    username: localStorage.getItem("cc_username") || null,
    partnerName: localStorage.getItem("cc_partner_name") || null,
    capsules: [],
    editingId: null,
    isGashaRunning: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const screens = {
    auth: $("#screen-auth"),
    home: $("#screen-home"),
    post: $("#screen-post"),
    list: $("#screen-list"),
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
    requestAnimationFrame(updateScrollHint);
  }

  // ---------- auth ----------

  function setLoggedIn(token, username, partnerName) {
    state.token = token;
    state.username = username;
    state.partnerName = partnerName;
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
      setLoggedIn(data.token, data.username, data.partner_name);
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
      setLoggedIn(data.token, data.username, data.partner_name);
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
    showScreen("auth");
  });

  // ---------- navigation ----------

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.nav === "post") { state.editingId = null; }
      showScreen(el.dataset.nav);
    });
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

  function buildAlbumMarkup(capsules, partnerName) {
    const name = escapeHtml(partnerName || "them");
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

    return `
      <div class="album-header">
        <img src="logo.png" class="album-logo" alt="" />
        <div class="album-title">Favorite things about ${name} &#9829;</div>
      </div>
      <div class="album-grid">${cards}</div>
      <div class="album-footer">Made with CapsuleCrush &#9829;</div>
    `;
  }

  async function generateAlbum() {
    if (state.capsules.length === 0) return;
    const btn = $("#btn-create-album");
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-rotate"/></svg> Generating...`;

    const container = $("#album-render");
    try {
      container.innerHTML = buildAlbumMarkup(state.capsules, state.partnerName);

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
      $("#album-modal").classList.remove("hidden");
    } catch (err) {
      alert("Couldn't create the album: " + err.message);
    } finally {
      container.innerHTML = "";
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }

  $("#btn-create-album").addEventListener("click", generateAlbum);
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
    const shareData = {
      files: [file],
      title: "CapsuleCrush Album",
      text: `Favorite things about ${state.partnerName || "them"}`,
    };
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
    if (!state.partnerName) {
      try {
        const me = await api("/api/auth/me");
        state.partnerName = me.partner_name;
        localStorage.setItem("cc_partner_name", me.partner_name);
      } catch (_) {
        // session invalid/expired — send back to auth
        state.token = null;
        localStorage.removeItem("cc_token");
        localStorage.removeItem("cc_username");
        localStorage.removeItem("cc_partner_name");
        showScreen("auth");
        return;
      }
    }
    applyPersonalization();
    showScreen("home");
  }

  init();
})();
