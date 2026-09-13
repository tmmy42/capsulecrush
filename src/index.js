// CapsuleCrush — 好きなところをカプセルに詰めてガシャポンで楽しむアプリ
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

function isValidPasscode(passcode) {
  return typeof passcode === "string" && passcode.length >= 4 && passcode.length <= 64;
}

async function requireAuth(c, next) {
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return c.json({ error: "認証が必要です" }, 401);

  const session = await c.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE token = ?`
  )
    .bind(token)
    .first();
  if (!session) return c.json({ error: "セッションが無効です" }, 401);

  c.set("userId", session.user_id);
  await next();
}

// ---------- auth ----------

app.post("/api/auth/signup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, passcode } = body;

  if (!isValidUsername(username)) {
    return c.json({ error: "ユーザー名は英数字とアンダースコアで3〜32文字にしてください" }, 400);
  }
  if (!isValidPasscode(passcode)) {
    return c.json({ error: "パスコードは4〜64文字にしてください" }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE username = ?`)
    .bind(username)
    .first();
  if (existing) {
    return c.json({ error: "そのユーザー名はすでに使われています" }, 409);
  }

  const userId = uuid();
  const passcodeHash = await sha256Hex(passcode);
  await c.env.DB.prepare(
    `INSERT INTO users (id, username, passcode_hash) VALUES (?, ?, ?)`
  )
    .bind(userId, username, passcodeHash)
    .run();

  const token = uuid();
  await c.env.DB.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`)
    .bind(token, userId)
    .run();

  return c.json({ token, username });
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, passcode } = body;

  if (!isValidUsername(username) || !isValidPasscode(passcode)) {
    return c.json({ error: "ユーザー名またはパスコードが正しくありません" }, 401);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, passcode_hash FROM users WHERE username = ?`
  )
    .bind(username)
    .first();
  if (!user) {
    return c.json({ error: "ユーザー名またはパスコードが正しくありません" }, 401);
  }

  const passcodeHash = await sha256Hex(passcode);
  if (passcodeHash !== user.passcode_hash) {
    return c.json({ error: "ユーザー名またはパスコードが正しくありません" }, 401);
  }

  const token = uuid();
  await c.env.DB.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`)
    .bind(token, user.id)
    .run();

  return c.json({ token, username });
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
  if (!capsule) return c.json({ error: "カプセルがまだありません" }, 404);
  return c.json({ capsule });
});

app.post("/api/capsules", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const { text, memo_date, image_key } = body;

  if (typeof text !== "string" || text.trim().length === 0) {
    return c.json({ error: "好きなところを入力してください" }, 400);
  }
  if (text.length > 2000) {
    return c.json({ error: "テキストが長すぎます" }, 400);
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
  if (!existing) return c.json({ error: "カプセルが見つかりません" }, 404);

  if (typeof text !== "string" || text.trim().length === 0) {
    return c.json({ error: "好きなところを入力してください" }, 400);
  }
  if (text.length > 2000) {
    return c.json({ error: "テキストが長すぎます" }, 400);
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
  if (!existing) return c.json({ error: "カプセルが見つかりません" }, 404);

  await c.env.DB.prepare(`DELETE FROM capsules WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();

  if (existing.image_key) {
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
  const userId = c.get("userId");
  const formData = await c.req.formData().catch(() => null);
  const file = formData?.get("image");

  if (!file || typeof file === "string") {
    return c.json({ error: "画像ファイルを送信してください" }, 400);
  }
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) {
    return c.json({ error: "対応していない画像形式です（jpg/png/webp/gif）" }, 400);
  }
  if (file.size > 8 * 1024 * 1024) {
    return c.json({ error: "画像サイズは8MB以下にしてください" }, 400);
  }

  const key = `${userId}/${uuid()}.${ext}`;
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  return c.json({ image_key: key });
});

app.get("/api/images/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});

export default app;
