# NexOS — Backend API Reference

Base URL: `http://localhost:3000` (dev) · `https://yourdomain.com` (prod)

All responses use `Content-Type: application/json`.

---

## `GET /api/health`

Returns server health status.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "version": "2.0.0",
  "node": "v20.10.0",
  "uptime": "3600s"
}
```

---

## `POST /api/chat`

Sends one message to NexAI (Gemini). The server saves your message and the reply, so chats survive refreshes. Requires login. Nothing is saved if the AI call fails.

**Limits:** 30 requests/minute and 500/day per signed-in user. A message can be up to 4000 characters, a chat holds up to 200 messages, and each user keeps up to 100 chats (oldest are removed).

**Request body:**
```json
{
  "chatId": "66f0c0ffee...",
  "message": "Help me prioritize my tasks",
  "system": "You are NexAI ... (the user's task context)"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `chatId` | `string` | no | Omit to start a new chat |
| `message` | `string` | yes | Max 4000 characters |
| `system` | `string` | no | Context for the model, max 6000 characters |

**Response 200:**
```json
{ "text": "Here are your priorities...", "chatId": "66f0c0ffee...", "title": "Help me prioritize my tasks", "updatedAt": "2026-10-16T10:30:00.000Z" }
```

**Errors** always look like `{ "error": "<message safe to show the user>", "code": "..." }`:
| Status | `code` | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST`, `TOO_LONG`, `CHAT_FULL` | Invalid message, too long, or the chat is full |
| 404 | `NOT_FOUND` | Chat does not exist |
| 429 | `RATE_LIMIT`, `DAILY_LIMIT` | Too many messages |
| 500 | `AI_CONFIG`, `SERVER_ERROR` | API key or server problem |
| 502 / 503 | `AI_ERROR`, `AI_BUSY` | Gemini failed or is over its quota (retried once automatically) |

---

## `GET /api/chats`

Lists the signed-in user's chats, newest first: `{ "chats": [{ "id", "title", "updatedAt" }] }`.

## `GET /api/chats/:id`

Returns one chat with all messages: `{ "chat": { "id", "title", "updatedAt", "messages": [{ "role", "content", "ts" }] } }`.

## `DELETE /api/chats/:id`

Deletes one chat: `{ "ok": true }`.

## `PUT /api/me`

Changes the signed-in user's display name. Body: `{ "name": "..." }` (1 to 60 characters, extra spaces are removed). Returns `{ "name", "email", "picture" }`. A name chosen here is kept when the user signs in again.

## `DELETE /api/me`

Deletes the signed-in user's NexOS workspace state, saved NexAI chats, NexOS push subscriptions and reminder preference. The shared Google identity record is intentionally retained because other independently deployed apps may use the same database. Body must be `{ "confirm": "DELETE" }`, otherwise the server answers 400. Returns `{ "ok": true }` and clears the login cookie.

---

## `POST /api/complete`

Single-shot prompt completion. Simpler than `/api/chat`.

**Limits:** shares the `/api/chat` limits (per signed-in user). Not saved.

**Request body:**
```json
{
  "prompt": "Give me a one-line description for this task: 'Deep work session'",
  "system": "You are a helpful assistant. Be concise."
}
```

**Response 200:**
```json
{
  "text": "Uninterrupted 90-minute focus block for high-priority work."
}
```

---

## `GET /api/version`

Returns app name and version.

**Response 200:**
```json
{
  "name": "NexOS",
  "version": "2.0.0"
}
```

---

## Frontend ↔ Backend Integration

When running with the backend, `app.js` calls `/api/chat` and `/api/complete` instead of hitting Gemini directly. The API key is never exposed to the browser.

There is no standalone mode. All AI calls go through the backend, which calls Google Gemini with `GEMINI_API_KEY`.

