// CapsuleCrush — capsule the things you love, one gashapon pull at a time
// Cloudflare Workers + Hono + D1 + R2

import { Hono } from "hono";

const app = new Hono();

const uuid = () => crypto.randomUUID();

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidUsername(username) {
  return typeof username === "string" && /^[a-zA-Z0-9_]{3,32}$/.test(username);
}

function isValidPartnerName(partnerName) {
  return typeof partnerName === "string" && partnerName.trim().length >= 1 && partnerName.trim().length <= 64;
}

async function requireAuth(c, next) {
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return c.json({ error: "Authentication required" }, 401);

  const session = await c.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE token = ?`
  )
    .bind(token)
    .first();
  if (!session) return c.json({ error: "Session is invalid" }, 401);

  c.set("userId", session.user_id);
  await next();
}

// ---------- auth ----------

app.post("/api/auth/signup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, partner_name } = body;

  if (!isValidUsername(username)) {
    return c.json({ error: "Your name must be 3-32 characters (letters, numbers, underscore)" }, 400);
  }
  if (!isValidPartnerName(partner_name)) {
    return c.json({ error: "Their name must be 1-64 characters" }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE username = ?`)
    .bind(username)
    .first();
  if (existing) {
    return c.json({ error: "That username is already taken" }, 409);
  }

  const userId = uuid();
  const partnerName = partner_name.trim();
  const passcodeHash = await sha256Hex(partnerName);
  await c.env.DB.prepare(
    `INSERT INTO users (id, username, partner_name, passcode_hash) VALUES (?, ?, ?, ?)`
  )
    .bind(userId, username, partnerName, passcodeHash)
    .run();

  const token = uuid();
  await c.env.DB.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`)
    .bind(token, userId)
    .run();

  return c.json({ token, username, partner_name: partnerName });
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, partner_name } = body;

  if (!isValidUsername(username) || !isValidPartnerName(partner_name)) {
    return c.json({ error: "Your name or their name is incorrect" }, 401);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, partner_name, passcode_hash FROM users WHERE username = ?`
  )
    .bind(username)
    .first();
  if (!user) {
    return c.json({ error: "Your name or their name is incorrect" }, 401);
  }

  const passcodeHash = await sha256Hex(partner_name.trim());
  if (passcodeHash !== user.passcode_hash) {
    return c.json({ error: "Your name or their name is incorrect" }, 401);
  }

  const token = uuid();
  await c.env.DB.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`)
    .bind(token, user.id)
    .run();

  return c.json({ token, username, partner_name: user.partner_name });
});

app.get("/api/auth/me", requireAuth, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare(`SELECT username, partner_name FROM users WHERE id = ?`)
    .bind(userId)
    .first();
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ username: user.username, partner_name: user.partner_name });
});

app.post("/api/auth/logout", requireAuth, async (c) => {
  const auth = c.req.header("authorization") || "";
  const token = auth.slice(7);
  await c.env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
  return c.json({ ok: true });
});

// ---------- capsules ----------

app.get("/api/capsules", requireAuth, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    `SELECT id, text, memo_date, image_key, created_at, updated_at
       FROM capsules
      WHERE user_id = ?
      ORDER BY created_at DESC`
  )
    .bind(userId)
    .all();
  return c.json({ capsules: results });
});

app.get("/api/capsules/random", requireAuth, async (c) => {
  const userId = c.get("userId");
  const capsule = await c.env.DB.prepare(
    `SELECT id, text, memo_date, image_key, created_at, updated_at
       FROM capsules
      WHERE user_id = ?
      ORDER BY RANDOM()
      LIMIT 1`
  )
    .bind(userId)
    .first();
  if (!capsule) return c.json({ error: "No capsules yet" }, 404);
  return c.json({ capsule });
});

app.post("/api/capsules", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const { text, memo_date, image_key } = body;

  if (typeof text !== "string" || text.trim().length === 0) {
    return c.json({ error: "Please write what you love" }, 400);
  }
  if (text.length > 2000) {
    return c.json({ error: "Text is too long" }, 400);
  }

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO capsules (id, user_id, text, memo_date, image_key) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, userId, text.trim(), memo_date || null, image_key || null)
    .run();

  const capsule = await c.env.DB.prepare(
    `SELECT id, text, memo_date, image_key, created_at, updated_at FROM capsules WHERE id = ?`
  )
    .bind(id)
    .first();

  return c.json({ capsule }, 201);
});

app.put("/api/capsules/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const { text, memo_date, image_key } = body;

  const existing = await c.env.DB.prepare(
    `SELECT id FROM capsules WHERE id = ? AND user_id = ?`
  )
    .bind(id, userId)
    .first();
  if (!existing) return c.json({ error: "Capsule not found" }, 404);

  if (typeof text !== "string" || text.trim().length === 0) {
    return c.json({ error: "Please write what you love" }, 400);
  }
  if (text.length > 2000) {
    return c.json({ error: "Text is too long" }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE capsules SET text = ?, memo_date = ?, image_key = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
  )
    .bind(text.trim(), memo_date || null, image_key || null, id, userId)
    .run();

  const capsule = await c.env.DB.prepare(
    `SELECT id, text, memo_date, image_key, created_at, updated_at FROM capsules WHERE id = ?`
  )
    .bind(id)
    .first();

  return c.json({ capsule });
});

app.delete("/api/capsules/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const existing = await c.env.DB.prepare(
    `SELECT id, image_key FROM capsules WHERE id = ? AND user_id = ?`
  )
    .bind(id, userId)
    .first();
  if (!existing) return c.json({ error: "Capsule not found" }, 404);

  await c.env.DB.prepare(`DELETE FROM capsules WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();

  if (existing.image_key && c.env.IMAGES) {
    await c.env.IMAGES.delete(existing.image_key).catch(() => {});
  }

  return c.json({ ok: true });
});

// ---------- images ----------

const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

app.post("/api/upload", requireAuth, async (c) => {
  if (!c.env.IMAGES) {
    return c.json({ error: "Image uploads are not available yet" }, 503);
  }
  const userId = c.get("userId");
  const formData = await c.req.formData().catch(() => null);
  const file = formData?.get("image");

  if (!file || typeof file === "string") {
    return c.json({ error: "Please attach an image file" }, 400);
  }
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) {
    return c.json({ error: "Unsupported image format (jpg/png/webp/gif only)" }, 400);
  }
  if (file.size > 8 * 1024 * 1024) {
    return c.json({ error: "Image size must be 8MB or less" }, 400);
  }

  const key = `${userId}/${uuid()}.${ext}`;
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  return c.json({ image_key: key });
});

app.get("/api/images/:key{.+}", async (c) => {
  if (!c.env.IMAGES) return c.notFound();
  const key = c.req.param("key");
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});

export default app;
