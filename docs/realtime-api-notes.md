# Azure AI Foundry — Realtime API Contract Notes
**Spike ID:** `learn-spike`  
**Researched:** 2025-01  
**Status:** LOCKED for implementation  

---

## ⚠️ CRITICAL: GA vs Preview API Split

The Preview API is **deprecated as of April 30, 2026**. All implementation targets GA endpoints only.

| Aspect | Preview (DEPRECATED — do not implement) | GA (CURRENT — implement this) |
|---|---|---|
| Ephemeral token URL | `POST /openai/realtimeapi/sessions?api-version=2025-04-01-preview` | `POST /openai/v1/realtime/client_secrets` |
| WebRTC calls URL | `https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc` | `https://{resource}.openai.azure.com/openai/v1/realtime/calls` |
| WebSocket URL | `/openai/realtime?api-version=2025-04-01-preview&deployment=<name>` | `/openai/v1/realtime?model=<name>` |
| `api-version` param | Required | **Must be omitted** (causes 401 if present) |
| `session.type` in `session.update` | Not required | **Required** — must be `"realtime"` |

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide

---

## 1. Ephemeral Session Minting Endpoint

### 1.1 Exact URL

```
POST https://{your-resource-name}.openai.azure.com/openai/v1/realtime/client_secrets
```

- **No `api-version` query string** — the GA endpoint does not accept or require it.
- **Not region-scoped** — uses your Azure OpenAI resource hostname, not a regional subdomain.
- The legacy `/openai/realtimeapi/sessions` path is **deprecated**.

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc#step-1-set-up-service-to-procure-ephemeral-token

### 1.2 HTTP Method, Headers, Auth

| Item | Value |
|---|---|
| HTTP Method | `POST` |
| `Content-Type` | `application/json` |
| **Entra ID (recommended)** | `Authorization: Bearer <token>` |
| **Entra ID scope** | `https://ai.azure.com/.default` ← **NOT** `cognitiveservices.azure.com` |
| **API key (alternative)** | `api-key: <resource-key>` header |

> Source: Python sample in https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc
> (`get_bearer_token("https://ai.azure.com/.default")` is explicit in the sample code)

### 1.3 Request Body Schema (TypeScript interface)

```typescript
interface ClientSecretRequest {
  session: {
    /**
     * REQUIRED in GA. Must be "realtime" for speech-to-speech.
     * "transcription" for audio-transcription-only sessions.
     */
    type: "realtime" | "transcription";

    /** REQUIRED. Your Azure model deployment name (not the bare model ID). */
    model: string; // e.g. "gpt-realtime-mini"

    /** Optional. System prompt / instructions for the model. */
    instructions?: string;

    /** Optional. Output modalities. */
    output_modalities?: ("audio" | "text")[];

    audio?: {
      output?: {
        /**
         * Voice for audio output.
         * Values: "alloy" | "ash" | "ballad" | "coral" | "echo" |
         *         "marin" | "sage" | "shimmer" | "verse"
         */
        voice?: string;
        format?: {
          type?: string;   // e.g. "audio/pcm"
          rate?: number;   // e.g. 24000
        };
      };
      input?: {
        transcription?: {
          /**
           * Azure deviation: must be an existing DEPLOYMENT name, not a bare
           * model name. E.g. "my-whisper-deployment", not "whisper-1".
           */
          model?: string;
        };
        format?: { type?: string; rate?: number };
        turn_detection?: {
          type?: "server_vad" | "none";
          threshold?: number;           // default 0.5
          prefix_padding_ms?: number;   // default 300
          silence_duration_ms?: number; // default 200
          create_response?: boolean;    // default true
        };
      };
    };

    /** Optional. Tools/functions the model can call. */
    tools?: Array<{
      type: "function";
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  };
}
```

**Minimum viable request body for `gpt-realtime-mini`:**

```json
{
  "session": {
    "type": "realtime",
    "model": "gpt-realtime-mini",
    "instructions": "You are a helpful assistant.",
    "audio": {
      "output": { "voice": "alloy" }
    }
  }
}
```

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc (session config table + Python sample)  
> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio (session config example in JS quickstart)

### 1.4 Response Body (TypeScript interface)

```typescript
interface ClientSecretResponse {
  /**
   * The ephemeral token string. Use this directly as the Bearer token
   * in the WebRTC SDP exchange (step 2).
   *
   * Azure Foundry GA shape: flat `value` field.
   * This is NOT the OpenAI public API shape { client_secret: { value, expires_at } }.
   */
  value: string;

  // Other fields may be present; only `value` is documented and needed.
}
```

**Extraction pattern (confirmed in MS Learn Python sample):**

```python
data = response.json()
ephemeral_token = data.get('value', '')   # ← flat field, not data['client_secret']['value']
```

```typescript
const data = await response.json();
const ephemeralToken: string = data.value; // ← flat field
```

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc  
> (Python token service, line: `ephemeral_token = data.get('value', '')`)

⚠️ **UNCERTAIN** — `expires_at` / token lifetime: The docs do not document an `expires_at` field or the lifetime of the ephemeral token in the GA response. Verify at integration time.

---

## 2. WebRTC SDP Exchange (Browser-Side)

### 2.1 Exact URL

```
POST https://{your-resource-name}.openai.azure.com/openai/v1/realtime/calls
```

Optional useful query param: `?webrtcfilter=on` (filters data channel to safe subset of events, hiding instructions from browser client)

- **Not region-scoped** — uses resource hostname directly.
- Preview (deprecated) URL was: `https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc`

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc#step-2-set-up-your-browser-application

### 2.2 Request Details

| Item | Value |
|---|---|
| HTTP Method | `POST` |
| `Content-Type` | `application/sdp` |
| `Authorization` | `Bearer <ephemeral_token>` — use the `value` string from step 1 |
| Body | Raw SDP offer string (from `RTCPeerConnection.localDescription.sdp`) |
| `model` query param | ⚠️ **UNCERTAIN** — not documented as required for GA calls endpoint |

### 2.3 Response

| Item | Value |
|---|---|
| Success status | `201 Created` (NOT 200) |
| `Content-Type` | `application/sdp` |
| Body | Raw SDP answer string — pass to `peerConnection.setRemoteDescription()` |
| `Location` header | Path to WebSocket observer: `/openai/v1/realtime/calls/<call_id>` |

> Source: Python `perform_sdp_negotiation` function in MS Learn article:  
> `if response.status_code == 201:` confirms 201 not 200.

### 2.4 Complete Browser-Side TypeScript Pattern

```typescript
const AZURE_RESOURCE = "your-resource-name"; // e.g. "my-aoai-eastus2"

async function initWebRTCSession(ephemeralKey: string): Promise<{
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel;
}> {
  const pc = new RTCPeerConnection();

  // 1. Remote model audio → <audio> element
  const audio = document.createElement("audio");
  audio.autoplay = true;
  document.body.appendChild(audio);
  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0];
  };

  // 2. Local microphone → peer connection
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  pc.addTrack(stream.getAudioTracks()[0]);

  // 3. Data channel for Realtime API events
  const dataChannel = pc.createDataChannel("realtime-channel");

  // 4. SDP offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // 5. POST SDP to Azure GA endpoint
  const sdpResponse = await fetch(
    `https://${AZURE_RESOURCE}.openai.azure.com/openai/v1/realtime/calls?webrtcfilter=on`,
    {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    }
  );

  if (sdpResponse.status !== 201) {
    throw new Error(`SDP exchange failed: ${sdpResponse.status} ${sdpResponse.statusText}`);
  }

  // 6. Set SDP answer
  const answerSdp = await sdpResponse.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return { pc, dataChannel };
}
```

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc (HTML/JS browser sample + Python SDP negotiation function)

---

## 3. `gpt-realtime-mini` Model Availability

### 3.1 GA Status

`gpt-realtime-mini` is **Generally Available (GA)**.

| Model ID | Version | Status |
|---|---|---|
| `gpt-realtime-mini` | `2025-10-06` | ✅ GA |
| `gpt-realtime-mini` | `2025-12-15` | ✅ GA |

Also available (GA family):
- `gpt-realtime` (version `2025-08-28`) — GA
- `gpt-realtime-1.5` (version `2026-02-23`) — GA

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio#supported-models  
> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc (Supported models section)

### 3.2 Azure Regions

Global deployments available in:
- **East US 2**
- **Sweden Central**

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc  
> ("You can access the GPT real-time models for global deployments in the East US 2 and Sweden Central regions")

### 3.3 Context Window / Token Limits

| Model | Input tokens | Output tokens | Training cutoff |
|---|---|---|---|
| `gpt-realtime-mini` (all versions) | 32,000 | 4,096 | October 2023 |
| `gpt-realtime` | 32,000 | 4,096 | October 2023 |
| `gpt-4o-realtime-preview` (2024-12-17) | 16,000 | 4,096 | October 2023 |

Note: The general Realtime API limit stated in docs: "supports up to 32,000 input tokens and 4,096 output tokens."

> Source: https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#audio-models

### 3.4 Cost / Pricing

⚠️ **UNCERTAIN — verify at integration time.** No per-token pricing is documented in the referenced MS Learn pages. Check https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/ for current rates.

---

## 4. Data Channel Event Names

### 4.1 GA Event Name Changes vs OpenAI Public Spec and vs Preview

These names **changed** between Preview and GA. Coding agents must use the GA names:

| Old name (Preview / OpenAI public) | GA name (Azure Foundry GA) |
|---|---|
| `response.audio.delta` | `response.output_audio.delta` |
| `response.audio_transcript.delta` | `response.output_audio_transcript.delta` |
| `response.text.delta` | `response.output_text.delta` |

All other events below are **unchanged** from Preview to GA.

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide#modified-events

### 4.2 Client → Server Events

#### `session.update`

Inject/update page corpus into instructions and reconfigure session.

```typescript
// GA format — session.type IS REQUIRED
interface SessionUpdateEvent {
  type: "session.update";
  session: {
    type: "realtime" | "transcription"; // REQUIRED in GA (missing = error)
    model?: string;
    instructions?: string;   // ← inject page corpus here
    output_modalities?: ("audio" | "text")[];
    audio?: {
      input?: {
        turn_detection?: {
          type: "server_vad" | "none";
          threshold?: number;
          prefix_padding_ms?: number;
          silence_duration_ms?: number;
          create_response?: boolean;
        };
        transcription?: {
          model?: string; // Azure: must be deployment name
        };
      };
      output?: {
        voice?: string;
      };
    };
  };
}

// Minimal example to inject instructions:
const updateEvent: SessionUpdateEvent = {
  type: "session.update",
  session: {
    type: "realtime",
    instructions: `You are a helpful assistant. Page context: ${pageCorpus}`,
  },
};
dataChannel.send(JSON.stringify(updateEvent));
```

#### `conversation.item.create`

Send text input to the conversation.

```typescript
interface ConversationItemCreateEvent {
  type: "conversation.item.create";
  item: {
    type: "message";
    role: "user" | "assistant" | "system";
    /** object field: "realtime.item" (optional when creating) */
    object?: "realtime.item";
    content: Array<{
      type: "input_text" | "input_audio" | "input_image";
      text?: string;        // for input_text
      audio?: string;       // for input_audio: base64-encoded PCM
      transcript?: string;  // for input_audio: optional transcript hint
    }>;
  };
}

// Example:
const textInput: ConversationItemCreateEvent = {
  type: "conversation.item.create",
  item: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Hello!" }],
  },
};
```

#### `response.create`

Trigger the model to generate a response.

```typescript
interface ResponseCreateEvent {
  type: "response.create";
  response?: {
    modalities?: ("audio" | "text")[];
    instructions?: string;  // per-response instruction override
  };
}

// Minimal:
dataChannel.send(JSON.stringify({ type: "response.create" }));
```

### 4.3 Server → Client Events

#### Events returned with `?webrtcfilter=on`:

| Event Name | GA? | Description |
|---|---|---|
| `input_audio_buffer.speech_started` | ✅ unchanged | VAD detected speech start |
| `input_audio_buffer.speech_stopped` | ✅ unchanged | VAD detected speech stop |
| `output_audio_buffer.started` | ✅ unchanged | Model audio output started |
| `output_audio_buffer.stopped` | ✅ unchanged | Model audio output stopped |
| `conversation.item.input_audio_transcription.completed` | ✅ unchanged | User speech transcribed |
| `conversation.item.added` | 🆕 GA only | Conversation item added |
| `conversation.item.created` | ✅ unchanged | Conversation item created |
| `response.output_text.delta` | ⚠️ **RENAMED** from `response.text.delta` | Text response delta |
| `response.output_text.done` | ⚠️ **RENAMED** from `response.text.done` | Text response complete |
| `response.output_audio_transcript.delta` | ⚠️ **RENAMED** from `response.audio_transcript.delta` | Audio transcript delta |
| `response.output_audio_transcript.done` | ⚠️ **RENAMED** | Audio transcript complete |

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc  
> (webrtcfilter section: "only the following messages are returned to the browser on the data channel")

#### Key additional server events (non-filtered connections):

```typescript
// GA server event types — use these strings for event handlers
type ServerEventType =
  | "session.created"
  | "session.updated"
  | "conversation.created"
  | "conversation.item.created"
  | "conversation.item.added"           // GA new
  | "conversation.item.done"             // GA new
  | "conversation.item.input_audio_transcription.completed"
  | "input_audio_buffer.speech_started"
  | "input_audio_buffer.speech_stopped"
  | "response.created"
  | "response.output_item.added"
  | "response.output_audio.delta"                  // GA (was: response.audio.delta)
  | "response.output_audio.done"
  | "response.output_audio_transcript.delta"       // GA (was: response.audio_transcript.delta)
  | "response.output_audio_transcript.done"
  | "response.output_text.delta"                   // GA (was: response.text.delta)
  | "response.output_text.done"
  | "response.done"
  | "error";
```

### 4.4 Azure-Specific Deviation

The `model` field in `input_audio_transcription` settings must be the name of an **existing Azure deployment**, not a bare model identifier.

```typescript
// ✅ CORRECT for Azure:
audio.input.transcription.model = "my-whisper-deployment";

// ❌ WRONG for Azure (correct for OpenAI public):
audio.input.transcription.model = "whisper-1";
```

> Source: https://learn.microsoft.com/en-us/azure/foundry/openai/realtime-audio-reference  
> ("Azure OpenAI requires the name of the existing model deployment for the field")

---

## 5. TypeScript Code Sample — WebRTC + Ephemeral Session (Azure Foundry)

The canonical Microsoft-published sample is the HTML/JS browser example in the MS Learn WebRTC article. Below is that sample adapted and condensed to TypeScript for backend (token service) + frontend (WebRTC init).

**Source:** https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc

```typescript
// ──────────────────────────────────────────────────────────────────────────
// BACKEND: Token service endpoint (Node.js / Express-style)
// Mints an ephemeral token using Entra ID credentials
// ──────────────────────────────────────────────────────────────────────────
import { DefaultAzureCredential } from "@azure/identity";

const AZURE_RESOURCE = process.env.AZURE_RESOURCE!;
// GA endpoint — no api-version param
const CLIENT_SECRETS_URL =
  `https://${AZURE_RESOURCE}.openai.azure.com/openai/v1/realtime/client_secrets`;

async function mintEphemeralToken(deploymentName: string): Promise<string> {
  // Scope is https://ai.azure.com/.default (NOT cognitiveservices.azure.com)
  const credential = new DefaultAzureCredential();
  const tokenObj = await credential.getToken("https://ai.azure.com/.default");

  const body = {
    session: {
      type: "realtime",          // Required in GA
      model: deploymentName,     // e.g. "gpt-realtime-mini"
      instructions: "You are a helpful assistant.",
      audio: { output: { voice: "alloy" } },
    },
  };

  const res = await fetch(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenObj.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Token mint HTTP ${res.status}`);

  const data = await res.json();
  // GA response: flat `value` field (NOT client_secret.value)
  return data.value as string;
}

// ──────────────────────────────────────────────────────────────────────────
// FRONTEND: WebRTC session initialization
// Adapted from MS Learn HTML/JS sample
// ──────────────────────────────────────────────────────────────────────────
const WEBRTC_CALLS_URL =
  `https://${AZURE_RESOURCE}.openai.azure.com/openai/v1/realtime/calls`;

async function startRealtimeSession(
  ephemeralKey: string,
  onTranscriptDelta: (delta: string) => void,
  onInputTranscriptionComplete: (transcript: string) => void
): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel }> {

  const pc = new RTCPeerConnection();

  // Remote audio (model voice) → <audio> element
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  document.body.appendChild(audioEl);
  pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

  // Local mic → peer connection
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  pc.addTrack(mic.getAudioTracks()[0]);

  // Data channel for Realtime API events
  const dc = pc.createDataChannel("realtime-channel");
  dc.addEventListener("message", (e) => {
    const event = JSON.parse(e.data as string);
    switch (event.type) {
      // GA event names — note the "output_" prefix vs preview
      case "response.output_audio_transcript.delta":
        onTranscriptDelta(event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        onInputTranscriptionComplete(event.transcript);
        break;
      case "response.done":
        console.log("Response complete:", event.response?.id);
        break;
      case "error":
        console.error("Realtime error:", event.error);
        break;
    }
  });

  // SDP exchange with GA endpoint
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(`${WEBRTC_CALLS_URL}?webrtcfilter=on`, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      "Content-Type": "application/sdp",
    },
  });
  // Expect 201 Created (not 200)
  if (sdpRes.status !== 201) throw new Error(`SDP exchange: HTTP ${sdpRes.status}`);

  const answerSdp = await sdpRes.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return { pc, dc };
}

// ──────────────────────────────────────────────────────────────────────────
// USAGE: Inject page corpus via session.update after data channel opens
// ──────────────────────────────────────────────────────────────────────────
function injectPageCorpus(dc: RTCDataChannel, pageText: string): void {
  dc.send(JSON.stringify({
    type: "session.update",
    session: {
      type: "realtime",  // Required in GA
      instructions: `You are a helpful assistant. Use this page context to answer questions:\n\n${pageText}`,
    },
  }));
}
```

**Note on `Azure-Samples/aisearch-openai-rag-audio`:** This official Microsoft sample repo uses **WebSocket** (not WebRTC) and **Preview** event names (`response.audio.delta`, `response.audio_transcript.delta`). It is not updated to GA. Do not copy event names from that repo without updating them.

> Repo: https://github.com/Azure-Samples/aisearch-openai-rag-audio  
> Specific file: `app/frontend/src/hooks/useRealtime.tsx` (uses preview event names)

---

## DECISIONS LOCKED — Implementation Reference Table

| Decision | Locked Value | Citation |
|---|---|---|
| **Ephemeral token URL** | `POST https://{resource}.openai.azure.com/openai/v1/realtime/client_secrets` | [WebRTC how-to](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **`api-version` query param** | **NONE — omit entirely** (401 if present) | [Migration guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide) |
| **Entra ID scope** | `https://ai.azure.com/.default` | [WebRTC how-to Python sample](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **Auth header name (Entra)** | `Authorization: Bearer <token>` | [WebRTC how-to](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **Auth header name (key)** | `api-key: <resource-key>` | [WebSockets how-to](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets) |
| **Ephemeral token response field** | `data.value` (flat string) | [WebRTC Python sample](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **`session.type` in request body** | `"realtime"` — **Required in GA** | [Migration guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide#modified-events) |
| **WebRTC calls URL** | `POST https://{resource}.openai.azure.com/openai/v1/realtime/calls` | [WebRTC how-to Step 2](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc#step-2-set-up-your-browser-application) |
| **SDP offer Content-Type** | `application/sdp` | [WebRTC Python SDP function](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **SDP auth header** | `Authorization: Bearer <ephemeral_token_value>` | [WebRTC browser sample](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **SDP response HTTP status** | `201 Created` | [WebRTC Python SDP function](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **webrtcfilter param** | `?webrtcfilter=on` — recommended | [WebRTC how-to](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **`gpt-realtime-mini` status** | **GA** | [Supported models](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **`gpt-realtime-mini` regions** | East US 2, Sweden Central (global deploy) | [WebRTC supported models](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **`gpt-realtime-mini` context** | Input: 32,000 tokens; Output: 4,096 tokens | [Audio models table](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#audio-models) |
| **`session.update` event** | `type: "session.update"` — **add `session.type:"realtime"`** | [Migration guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide) |
| **`conversation.item.create` event** | `type: "conversation.item.create"` — **unchanged** | [WebRTC browser sample](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **`response.create` event** | `type: "response.create"` — **unchanged** | [WebRTC browser sample](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **Audio transcript delta event** | `response.output_audio_transcript.delta` (**renamed** from `response.audio_transcript.delta`) | [Migration guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide#modified-events) |
| **Audio output delta event** | `response.output_audio.delta` (**renamed** from `response.audio.delta`) | [Migration guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide#modified-events) |
| **Input transcription complete event** | `conversation.item.input_audio_transcription.completed` — **unchanged** | [WebRTC filter list](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc) |
| **Azure transcription model field** | Must be deployment name (e.g. `"my-whisper-deploy"`), NOT `"whisper-1"` | [Realtime API reference](https://learn.microsoft.com/en-us/azure/foundry/openai/realtime-audio-reference) |
| **WebSocket base URL (non-WebRTC)** | `wss://{resource}.openai.azure.com/openai/v1/realtime?model=<deployment>` | [WebSockets how-to](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets) |

---

## Sources (All MS Learn URLs)

1. **WebRTC how-to (GA):** https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc
2. **Realtime audio overview:** https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio
3. **WebSockets how-to:** https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets
4. **Preview → GA migration guide:** https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide
5. **Realtime API reference:** https://learn.microsoft.com/en-us/azure/foundry/openai/realtime-audio-reference
6. **Models sold by Azure (audio section):** https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#audio-models
7. **Azure-Samples RAG+audio (WebSocket reference, Preview API):** https://github.com/Azure-Samples/aisearch-openai-rag-audio