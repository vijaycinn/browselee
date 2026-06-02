# Demo Runbook: City of Sacramento

**Objective:** Demonstrate Browselee's ability to ground AI responses in real-world government website content, showcase real-time voice interaction, and highlight GCC/Azure architectural benefits for public sector.

**Audience:** City of Sacramento stakeholders, procurement, IT leadership | Sales & executives

**Duration:** 8–10 minutes | Equipment: Laptop, Chrome, speaker/headphones

---

## Pre-Flight Checklist

### 5 minutes before demo

- [ ] **Backend health**
  ```powershell
  curl http://localhost:8080/healthz
  # Expected: { "ok": true }
  ```
  Or verify Azure Container App is running:
  ```powershell
  az containerapp show --name browselee-dev-api --resource-group rg-browselee-dev --query properties.provisioningState
  # Expected: "Succeeded"
  ```

- [ ] **Extension loaded in Chrome**
  - Open `chrome://extensions`
  - Search for "Browselee" — should show installed, enabled, version 0.1.0+
  - If missing: click "Load unpacked" → `C:\workspace\browselee\extension\dist`

- [ ] **Microphone permissions granted**
  - Open any webpage
  - Look for mic icon in address bar
  - Click → "Always allow browselee to access your microphone"

- [ ] **Test tab open**
  - Open `https://www.cityofsacramento.gov/` in a new tab
  - Verify page loads (may take 2–3s due to city's infrastructure)

- [ ] **Audio/output device ready**
  - Speaker or headphones connected
  - Volume at 50%+
  - No meeting mute active

---

## Demo Flow (8 steps)

### 1. **Open the demo page** (30s)

Navigate to `https://www.cityofsacramento.gov/` in Chrome. Page should load completely.

> **Talking point:** "This is the official City of Sacramento website — thousands of pages, navigation menus, sidebar links, job boards, PDFs. Without Browselee, you'd manually search this entire site. With Browselee, you get instant, grounded answers."

---

### 2. **Activate Browselee widget** (15s)

Look for the **pulsing circle** in the bottom-right corner of the page.

- Click it
- Widget slides up from bottom-right
- Status shows: "Initializing" → "Extracting" → "Page extracted"

> **Screenshot checklist:**
> - [ ] Pulsing circle visible before click
> - [ ] Widget panel open, status bar visible

---

### 3. **Wait for corpus extraction** (~3–5s)

Widget status shows:
- "Extracting..." — fetching current page + same-origin linked pages
- "Page extracted" — corpus ready (usually 8–12 linked pages collected)

> **Talking point:** "Browselee is doing three things in parallel: extracting the current page with Defuddle (removes navigation noise), discovering linked pages, and fetching them all via concurrent HTTP requests. This is what makes the answers grounded — we're not just asking ChatGPT in the dark. We've pre-loaded the actual city website content."

---

### 4. **Ask a text question** (1m)

Type the first question into the chat box:

**"What services does the city offer for housing assistance?"**

Press Enter. The assistant responds within 2–3 seconds (SSE streaming starts immediately).

**Expected response includes:**
- Reference to "Community Development Department" or "Housing & Community Development"
- Mentions of assistance programs (emergency assistance, weatherization, down payment help)
- Citations to specific pages/sections extracted from the corpus

> **Screenshot checklist:**
> - [ ] Chat message appears in widget
> - [ ] Assistant response streams in real-time
> - [ ] Source text visible (e.g., "From: /housing-assistance.html")

---

### 5. **Ask a voice question** (1.5m)

Click the **microphone icon** (near the text input).

**Say aloud:**
> "How do I report a pothole in my street?"

The widget:
1. Records audio → text transcription appears in real-time in the chat (Whisper)
2. Sends transcription to backend → Realtime session established
3. Streams audio response back (gpt-realtime-mini voice)
4. Shows transcript in chat: "User: How do I report a pothole…" + "Assistant: To report a pothole, contact the Department of Public Works at…"

**Expected response includes:**
- Department of Public Works contact info
- Online portal or phone number
- Reference to "Citizen's Request System" (if available in corpus)

> **Talking point (during response):** "Notice there's no round-trip to our backend for the audio. The WebRTC connection is directly between your browser and Azure AI Foundry — that's why the latency is so low. Audio stays on Azure infrastructure, which is critical for government security and data residency compliance. And all of this uses the same Azure that Sacramento already uses — no exotic government clouds, no separate vendor infrastructure."

> **Screenshot checklist:**
> - [ ] Microphone active icon
> - [ ] Transcription appears in real-time
> - [ ] Assistant voice audio plays (check system volume)
> - [ ] Final transcript shown in chat

---

### 6. **Multi-turn conversation** (1m)

Follow up with a second voice question:

**"Can you tell me more about their business permits process?"**

The assistant should:
- Draw from previous context (knows you're asking about Sacramento city)
- Reference permit application pages from the corpus
- Maintain conversation history

> **Talking point:** "This is multi-turn awareness. The model has context from the page extraction and the previous questions — it's not starting from scratch each time."

---

### 7. **Switch model + compare** (45s)

Open the **widget settings** (gear icon):
- Find "Model" dropdown → currently set to `realtime`
- Switch to `text`
- Close settings

Re-ask the pothole question as **text only** (type it this time):

**"How do I report a pothole?"**

Response comes back the same (grounded in corpus), but no voice playback — just streaming text.

> **Talking point:** "We support two modes: Realtime for low-latency voice interactions, and text-mode streaming via SSE for broader compatibility. The same backend serves both. We fall back to text mode automatically if Realtime is unavailable."

---

### 8. **Show DevTools + corpus intelligence** (1m)

Open **Chrome DevTools** (F12):
1. Go to **Console**
2. Filter for `crawl:` logs
   ```
   crawl:complete → { pagesAdded: 8, totalBytes: 2.3MB, duration: 3200ms }
   ```
3. Show logs:
   - `crawl:fetch` → pages being fetched
   - `crawl:error` → any timeouts (OK, we handle them gracefully)
   - `crawl:complete` → final corpus stats

> **Talking point (for technical audience):** "Defuddle is stripping out nav, sidebars, ads, and duplicate boilerplate before we send content to the model. That means the model sees 80% less noise and can focus on answering the actual question. And all of this happens in an isolated offscreen document — no security risk to the page itself."

---

## Talking Points for Sales/Exec Audience

### 1. **GCC Parity Story**
> "Browselee uses the same Azure services that Sacramento already uses for M365. We're not using a separate government cloud or exotic infrastructure. The backend runs in Azure Container Apps (commercial). The AI model runs in Azure AI Foundry (commercial Azure). This is the same architecture as any commercial customer — just with GCC-compliant networking. No vendor lock-in, no separate approval process."

### 2. **Data Residency + Security**
> "Audio never goes through our backend. The WebRTC connection is direct from the browser to Azure AI Foundry — your audio stays on Microsoft's infrastructure. Even the ephemeral tokens we mint are scoped to 15 minutes and specific to a single session. No persistent API keys, no credentials in environment variables."

### 3. **No Audio Proxy = Lowest Latency**
> "Because we use Azure AI Foundry's GA Realtime API, we eliminate the middle-man. The browser talks directly to the model. Traditional voice assistants proxy audio through a backend service — that adds latency, cost, and a privacy surface. Browselee eliminates that."

### 4. **Content Grounding = Hallucination Prevention**
> "Large language models are trained on internet data from years ago. They can confidently give you wrong answers. Browselee pre-loads the actual City of Sacramento website into the conversation context. The model can only draw from real, current content. That's why we can cite sources."

### 5. **Accessible to Anyone, Any Website**
> "This is a Chrome extension. It works on any webpage — government, business, internal portals. No API integration needed, no custom development for each site. City staff can load this extension, point it at any webpage they work with, and get instant chat/voice access."

---

## Recovery Playbook

### Problem: Microphone Blocked or No Permissions

**Symptom:** Click mic icon → nothing happens, or error "Microphone access denied"

**Fix:**
1. Click the lock icon in the Chrome address bar
2. Find "Microphone" → click dropdown → select "Allow"
3. Refresh the page
4. Try the mic again

---

### Problem: 401 Unauthorized from Backend

**Symptom:** Chat box shows "Error: 401 Unauthorized"

**Causes & fixes:**
- **Local dev:** `az login` token expired
  - Run: `az login` again in PowerShell
  - Restart backend: `pnpm --filter @browselee/backend dev`
  
- **Azure Container Apps:** UAMI permissions missing or wrong
  - Run: `az role assignment list --assignee <uamiPrincipalId> --scope /subscriptions/<subId>/resourceGroups/rg-browselee-dev`
  - Should see `Cognitive Services OpenAI User` role on `smec-poc-vcinn-resource`
  - If missing: [Re-run Bicep deploy](../infra/README.md)

---

### Problem: CORS Error in Console

**Symptom:** Console shows "Access-Control-Allow-Origin not allowed"

**Fix:**
- Verify backend CORS config: check `backend/src/server.ts`
- Should have: `await app.register(cors, { origin: true, methods: ['POST', 'GET'] })`
- Restart backend

---

### Problem: "Page Extraction Failed" or Timeout

**Symptom:** Widget shows "Extracting..." for >15 seconds, then error

**Causes:**
- Website is very large (>3 MB of content) — normal, we cap corpus size
- Website blocks automated requests — some sites have aggressive rate limits
- Internet connection is slow — rare, but re-try in a few seconds

**Fix:**
- Refresh the page → re-click Browselee
- Or switch to a smaller website for demo (e.g., `sacramento.gov` instead of full government domain)

---

### Problem: No Audio Output from Realtime Response

**Symptom:** Chat shows text response, but no voice playback

**Causes:**
- Speaker/headphones not connected or muted
- Browser volume is 0 (check browser audio mixer in system settings)
- Audio output device is wrong (check system audio settings)
- Model is set to `text` instead of `realtime`

**Fix:**
1. Check system audio settings
2. Verify widget settings → Model = `realtime`
3. Re-ask a question with voice enabled

---

### Problem: Slow First Response (10+ seconds)

**Symptom:** Widget shows "Extracting..." for 5+ seconds; first chat response takes 10+ seconds

**Causes:**
- Crawl is still in progress (fetching linked pages concurrently)
- Normal for large websites — just means we're being thorough

**Fix:**
- Wait for "Page extracted" status to appear
- First response will be fast after extraction completes

---

### Fallback: WebRTC Fails Mid-Demo

**Symptom:** Realtime session drops, user gets connection error

**Recovery:**
1. Switch model to `text` in settings
2. Re-ask the question as **text input** (not voice)
3. Response comes back via SSE streaming (same backend, different mode)
4. Explain: "Realtime is the default, but Browselee gracefully falls back to text-mode streaming if WebRTC is unavailable. Same grounded answers, just no voice."

---

## Post-Demo Follow-Up Email

### Template

**Subject:** Browselee Demo — City of Sacramento | Architecture + Next Steps

---

**Hi [Name],**

**Thank you for joining the Browselee demo.** Here's a summary of what you saw and recommended next steps.

**What we demonstrated:**
- Real-time voice + text chat grounded in cityofsacramento.gov content
- Automatic extraction of 8+ linked pages (3–5s initial crawl)
- Multi-turn conversation with source citations
- Fallback to text-mode streaming (no voice) for broad compatibility

**Key takeaways:**
1. **GCC-native architecture** — uses commercial Azure (portal.azure.com) and Azure AI Foundry; no exotic government clouds
2. **Direct WebRTC to Foundry** — audio never proxied; lowest latency, data stays on Azure backbone
3. **No integration required** — works as-is on any webpage via Chrome extension; no API custom development

**Next steps:**
- **For IT/Security:** Review [Azure AI Foundry GCC support](https://learn.microsoft.com/en-us/azure/ai-services/openai/) and [Brownselee architecture docs](../README.md)
- **For Procurement:** Browselee is built on Azure services already available in your GCC tenant
- **For Pilot:** We can set up a demo environment (small Container App + your test sites) in 1–2 weeks
- **Licensing:** Browselee is open-source (MIT); Azure AI Foundry licensing follows standard per-token/per-request models

**Questions?** Feel free to reach out — happy to dive deeper into architecture, security, or the demo.

**Links:**
- [Project README](../README.md)
- [Infrastructure setup](../infra/README.md)
- [Azure AI Foundry docs](https://learn.microsoft.com/en-us/azure/ai-services/openai/)

---

**Best,**

[Your Name]  
[Your Title]  
[Contact]

---

### Customization for Other Audiences

| Audience | Focus | Key Link |
|---|---|---|
| **City CTO / IT leadership** | GCC parity, security, infrastructure cost | [`infra/README.md`](../infra/README.md), [Azure Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/) |
| **Procurement / Procurement** | Licensing, vendor lock-in, open-source | MIT License in repo root; no proprietary components |
| **Department heads (Parks, Public Works, etc.)** | Ease of use, time savings, accessibility | Demo runbook; any website works out-of-the-box |
| **Developers** | API contract, extension architecture, Realtime API | [`realtime-api-notes.md`](./realtime-api-notes.md), [`.github/workflows/README.md`](../.github/workflows/README.md) |

