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

Multi-turn conversational AI endpoint. Proxies to Claude Sonnet 4.

**Rate limit:** 20 requests/minute per IP.

**Request body:**
```json
{
  "messages": [
    { "role": "user",      "content": "Help me prioritize my tasks" },
    { "role": "assistant", "content": "Sure! Tell me about your tasks..." },
    { "role": "user",      "content": "I have 5 tasks due today..." }
  ],
  "system": "You are a productivity coach with access to the user's task data...",
  "max_tokens": 1000
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `messages` | `Message[]` | ✅ | Alternating user/assistant. Last 20 kept. |
| `system` | `string` | ❌ | System prompt for the model |
| `max_tokens` | `number` | ❌ | Default: 1000. Max: 4096 |

**Response 200:**
```json
{
  "text": "Here are your prioritized tasks...",
  "usage": {
    "input_tokens": 245,
    "output_tokens": 312
  }
}
```

**Error responses:**
| Code | Meaning |
|---|---|
| 400 | Missing or malformed `messages` array |
| 429 | Rate limit exceeded |
| 500 | Server error / Anthropic API error |
| 503 | Anthropic API unavailable |

---

## `POST /api/complete`

Single-shot prompt completion. Simpler than `/api/chat`.

**Rate limit:** 20 requests/minute per IP.

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

When running with the backend, `app.js` calls `/api/chat` and `/api/complete` instead of hitting Anthropic directly. The API key is never exposed to the browser.

**Standalone mode** (no backend): the frontend calls `https://api.anthropic.com/v1/messages` directly. Requires the API key to be embedded in the JS — only use for local development, never deploy publicly.

To switch between modes, update the fetch target in `callClaude()` and `callClaudeWithHistory()` in `app.js`:

```javascript
// Backend mode (default in production)
const endpoint = '/api/chat';

// Standalone mode (local dev only)
const endpoint = 'https://api.anthropic.com/v1/messages';
```
