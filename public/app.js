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

  function applyPersonalization() {
    const name = state.partnerName || "them";
    $("#home-subtitle").textContent = `Favorite things about ${name}`;
    $("#post-text-label").textContent = `What you love about ${name}`;
    $("#list-title").textContent = `${name}'s Capsules`;
    const emptyText = `No favorite things about ${name} yet — start the collection.`;
    $("#empty-state-text").textContent = emptyText;
    $("#list-empty-text").textContent = emptyText;
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

  async function runGasha() {
    if (state.isGashaRunning) return;
    if (state.capsules.length === 0) {
      showScreen("post");
      return;
    }
    state.isGashaRunning = true;
    btnGasha.disabled = true;

    lever.classList.add("pulled");
    await wait(250);
    lever.classList.remove("pulled");

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

  function resetPostForm() {
    state.editingId = null;
    pendingImageKey = null;
    $("#post-title").textContent = `New Capsule for ${state.partnerName || "them"}`;
    $("#post-text").value = "";
    $("#post-date").value = "";
    $("#post-image").value = "";
    $("#post-image-preview").classList.add("hidden");
    $("#post-image-preview").src = "";
    $("#post-submit").textContent = "Seal the Capsule";
    $("#post-cancel-edit").classList.add("hidden");
    $("#post-error").textContent = "";
  }

  $("#post-image").addEventListener("change", () => {
    const file = $("#post-image").files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $("#post-image-preview").src = reader.result;
      $("#post-image-preview").classList.remove("hidden");
    };
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
      const file = $("#post-image").files[0];

      let image_key = pendingImageKey;
      if (file) {
        const fd = new FormData();
        fd.append("image", file);
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
    $("#post-title").textContent = `Edit Capsule for ${state.partnerName || "them"}`;
    $("#post-text").value = capsule.text;
    $("#post-date").value = capsule.memo_date || "";
    $("#post-image").value = "";
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
