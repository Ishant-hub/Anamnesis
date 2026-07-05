# Anamnesis — Complete Project Reference
### "Git for AI Memory" — WeMakeDevs × Cognee Hackathon Submission

---

## 1. What Is This, In One Breath

**Anamnesis makes an AI agent's memory visible, explainable, and reversible.**

Autonomous AI agents (LangGraph, CrewAI, OpenAI Agents SDK, AutoGen) now run for hours or days, making dozens of decisions using memory they build up along the way. When something goes wrong, developers have logs and traces — but no way to ask *why* the agent decided something, *which memory* caused it, or *why it chose one option over another*. Anamnesis is a small, focused tool that answers exactly those questions, live, with every claim traced back to a real memory — never invented.

It is built around **Cognee**, and deliberately uses all four of Cognee's core memory-lifecycle primitives — `remember()`, `recall()`, `improve()`, `forget()` — not just storage-and-search.

---

## 2. The Problem, Precisely

Current AI observability tools (LangSmith, Helicone, Langfuse) show **what happened** — the trace, the tool calls, the outputs. They do not show:
- *Why* a decision was made
- *Which memories* influenced it
- *What alternatives* were considered and rejected, and why
- Whether a new fact *contradicts* something the agent already believed
- What happens to a decision if *one single memory* is changed

Anamnesis answers all five, live, for a demo audience or a real developer, in under 3 seconds per question.

---

## 3. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS | Fast to build, clean two-panel layout, no unnecessary chrome |
| Icons | Lucide React | Consistent, lightweight icon set for event types |
| Backend | FastAPI (Python) | Async-friendly, pairs naturally with Cognee's Python SDK |
| Memory Layer | **Cognee** (local mode: Kuzu graph DB + LanceDB vector store) | The actual memory substrate — graph + vector reasoning |
| Event Index | SQLite (`anamnesis.db`) | Thin, fast index for timeline pagination/scrubbing — Cognee remains the real memory |
| LLM Provider | Groq (free tier, OpenAI-compatible endpoint, e.g. Llama 3.3) | Free, fast enough for live unscripted questions |
| Dev Environment | Python venv (`.venv`) + Node/npm | Standard, zero-cost local setup |

---

## 4. System Architecture — Flowchart

```
┌─────────────────────────────────────────────────────────────────┐
│                      SCRIPTED DEMO AGENT                          │
│         (10-step simulated Kubernetes deployment bot)             │
│                                                                     │
│  Step 1  → user_prompt        "Deploy payments-service"           │
│  Step 2  → memory_read        checks prior deployment history      │
│  Step 3  → memory_read        checks available tools               │
│  Step 4  → DECISION           chosen: Helm | rejected: raw kubectl │
│  Step 5  → system              sets namespace = prod-payment-v1    │
│  Step 6  → system (⚠ contradiction) overrides → prod-payment-v2    │
│  Step 7  → tool_call            executes Helm deploy               │
│  Step 8  → error                DB connection timeout               │
│  Step 9  → api_response         health-check response               │
│  Step 10 → final_output (⚠ contradiction) deployment FAILED,        │
│                                  rollback initiated                 │
└──────────────────────────┬──────────────────────────────────────┘
                            │  every step calls
                            ▼
                    cognee.remember()
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │        COGNEE MEMORY ENGINE            │
        │  ┌────────────┐      ┌──────────────┐  │
        │  │  Kuzu Graph │◀────▶│ LanceDB Vector│  │
        │  │  (entities, │      │ (semantic     │  │
        │  │  relations) │      │  search)      │  │
        │  └────────────┘      └──────────────┘  │
        └───────────┬───────────────┬────────────┘
                     │               │
        ┌────────────┘               └─────────────┐
        ▼                                            ▼
┌───────────────────┐                    ┌───────────────────────┐
│  SQLite Event Index │                    │  branch_snapshot/       │
│  (anamnesis.db)      │                    │  (frozen copy of Cognee │
│  events, qa_sessions │                    │  state right after      │
│  — fast pagination   │                    │  Step 5, for Branch &   │
│                       │                    │  Replay)                │
└──────────┬───────────┘                    └───────────┬────────────┘
           │                                              │
           ▼                                              │
┌───────────────────────────┐                            │
│      FASTAPI BACKEND        │                            │
│                              │                            │
│  GET  /timeline              │                            │
│  POST /ask ─────────────────┼─── cognee.recall() (1-hop, │
│         │                    │    widen to 2/3-hop if     │
│         │                    │    needed) → LLM (Groq,    │
│         │                    │    citation-bound) →       │
│         │                    │    write-back:             │
│         │                    │    cognee.remember(Q&A) +  │
│         │                    │    cognee.improve()        │
│         │                    │                             │
│  POST /forget/{memory_id} ───┼─── cognee.forget()          │
│                              │                            │
│  POST /branch-replay/run ────┼────────────────────────────┘
│  GET  /branch-replay/result  │   (copies branch_snapshot,
│                              │    mutates one fact, replays
│                              │    Step 6's decision logic)
└──────────────┬───────────────┘
               │  JSON over HTTP
               ▼
┌───────────────────────────────────────────────────┐
│                 NEXT.JS FRONTEND                     │
│  ┌─────────────────────┐  ┌───────────────────────┐ │
│  │   LEFT: TIMELINE      │  │  RIGHT: ANSWER PANEL   │ │
│  │  - 10 event rows      │  │  - Prose + citations,  │ │
│  │  - icons per type     │  │    OR                  │ │
│  │  - confidence badges  │  │  - Side-by-side        │ │
│  │  - red contradiction  │  │    comparison card     │ │
│  │    dots               │  │    (chosen vs rejected)│ │
│  │  - "Why?" button       │  │  - "Retract memory"    │ │
│  │  - arrow-key nav       │  │    button per citation │ │
│  │                        │  │  - "Share link" button │ │
│  └─────────────────────┘  └───────────────────────┘ │
│           ▲ clicking a citation scrolls + highlights   │
│           └── the corresponding timeline row ──────────┘
└───────────────────────────────────────────────────┘
```

---

## 5. Feature-by-Feature Breakdown

### 5.1 Memory Timeline
A chronological list of all 10 scripted agent events. Each row shows: type icon, timestamp, one-line summary, a confidence badge ("supported by X memories"), and a red dot if the event contradicts an earlier high-confidence memory (Steps 6 and 10 are the seeded contradictions). Arrow keys (↑/↓) move focus through rows and auto-trigger the "Why?" query on the focused row.

### 5.2 Ask Why (Memory Blame)
Click "Why?" on any row, or type a free-text question. The backend:
1. Classifies the question (general vs. comparison)
2. Retrieves narrowly first — `cognee.recall()` scoped to the 1-hop neighborhood of the relevant event — only widening to 2/3-hop if the answer would otherwise be incomplete
3. Generates an answer where the LLM is **only allowed to assert what it has a real memory ID for** — if a memory is missing, it says so explicitly instead of guessing
4. **Writes back**: stores the Q&A pair itself as a new memory via `cognee.remember()`, then calls `cognee.improve()` so the system gets sharper on similar future questions

This is the feature that proves Anamnesis uses Cognee's actual memory *lifecycle*, not just recall-as-search.

### 5.3 Comparison Questions (the headline differentiator)
When a question matches Step 4 — the "Helm vs. raw kubectl" decision — the answer renders as a dedicated **side-by-side card**, not prose: the chosen option (Helm, its confidence, its citing memories) next to the rejected option (raw kubectl, its confidence, its rejection reason, its citing memories). This only works because the rejected alternative was captured **at decision time**, not reconstructed afterward.

### 5.4 Branch & Replay
The single most powerful demo beat. A snapshot of Cognee's state was frozen immediately after Step 5 (`branch_snapshot/`). On demand, the backend copies that snapshot, mutates one fact (the namespace configuration), and replays Step 6's decision logic against the mutated copy. Result: the **original** run shows Helm deployment → **FAILED**; the **replayed** run (after mutation) shows raw kubectl manifests → **SAFE**. Two different outcomes, from one changed memory — shown side by side.

### 5.5 Forget (Memory Retraction)
The fourth Cognee primitive, added to close the lifecycle. Any citation in an Ask Why answer has a "Retract this memory" button, which calls `cognee.forget()` on that specific memory and flags it `retracted=true` in the SQLite index (struck-through in the timeline, not deleted). Re-asking the same question afterward either finds a different valid citation path, or honestly says "I don't have a record of that" — proving the system never hallucinates to paper over a gap, even a gap it created itself.

### 5.6 Shareable Permalinks
Every Q&A session can be copied as a deep link (`?event=<uuid>&qa=<uuid>`) that reloads and re-renders that exact answer.

---

## 6. How Cognee's Full Lifecycle Is Used

| Primitive | Where It's Used | Why It Matters |
|---|---|---|
| `remember()` | Every one of the 10 scripted events, plus every Q&A pair from Ask Why | Builds the actual graph+vector memory — this is the substrate, not a bolt-on |
| `recall()` | Every Ask Why query (narrow-first, 1-hop → widen if needed) | Real retrieval, not a flat keyword search |
| `improve()` | After every Ask Why write-back | The system measurably sharpens on similar future questions — memory that gets better with use |
| `forget()` | The "Retract this memory" action | Proves the system can honestly lose knowledge and admit it, rather than hallucinate around a gap |

Almost no other project at this hackathon will demonstrate all four — most stop at `remember()`/`recall()`. This is the concrete, checkable answer to "Best Use of Cognee."

---

## 7. Data Model

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  agent_run_id TEXT NOT NULL DEFAULT 'demo-agent-1',
  event_type TEXT NOT NULL,           -- user_prompt | memory_read | memory_write |
                                       -- decision | tool_call | api_response |
                                       -- error | final_output | system
  summary TEXT NOT NULL,
  confidence REAL,
  memory_ids_used TEXT[],
  memory_ids_created TEXT[],
  chosen_option TEXT,                 -- decision events only
  rejected_alternatives JSONB,        -- [{option, confidence, rejection_reason, citing_memory_ids}]
  contradiction_flag BOOLEAN DEFAULT FALSE,
  retracted BOOLEAN DEFAULT FALSE,    -- set true after cognee.forget()
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE qa_sessions (
  id UUID PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  cited_memory_ids TEXT[],
  question_type TEXT,                 -- 'general' | 'comparison'
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 8. API Endpoints

```
GET  /timeline                    → paginated event list (incl. contradiction_flag)
POST /events                      → agent posts a new event (wraps cognee.remember())
POST /ask                         → { question, target_event_id? } → sourced answer
GET  /qa/{qa_id}                  → fetch a stored Q&A record (for permalinks)
POST /forget/{memory_id}          → retracts a memory (wraps cognee.forget())
POST /branch-replay/run           → triggers the hardcoded branch + mutate + replay
GET  /branch-replay/result        → original decision vs. replayed decision
```

---

## 9. Folder Structure

```
Cognee hackathon/
├── .env                     ← GROQ_API_KEY (never committed, never shared)
├── .gitignore
├── SPEC.md                  ← locked scope, read by Antigravity on every prompt
├── requirements.txt
├── anamnesis.db              ← SQLite event index
├── cognee_data/               ← live Cognee graph + vector store
├── branch_snapshot/            ← frozen Cognee state right after Step 5
├── backend/
│   ├── main.py                ← FastAPI app, all endpoints
│   ├── agent.py                ← scripted 10-step demo agent
│   ├── db.py                    ← SQLAlchemy models
│   ├── schemas.py                ← Pydantic validation
│   └── verify_cognee.py           ← health-check / verification script
└── frontend/
    └── src/app/
        └── page.tsx              ← two-panel UI (timeline + answer)
```

---
## 10. How to Run This — Step by Step (Windows / PowerShell)

### One-time setup (already done, listed for reference / a fresh machine)
```powershell
# From the project root: C:\Users\ISHANT\OneDrive\Desktop\Projects\Cognee hackathon

# 1. Python virtual environment
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# 2. .env file — created manually, NEVER via chat/agent, NEVER committed
#    Contents (one line):
#    GROQ_API_KEY=your-groq-key-here

# 3. Frontend dependencies
cd frontend
npm install
cd ..
```

### Every time you want to run a fresh demo (reseed the agent)
```powershell
# Clear old state (only if you want a completely fresh run)
Remove-Item -Path "cache.db*","cognee_db*","anamnesis.db" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "backend\__pycache__","cognee_data","branch_snapshot" -Recurse -Force -ErrorAction SilentlyContinue

# Re-run the scripted agent (seeds 10 events + takes the branch_snapshot)
.venv\Scripts\python -m backend.agent

# Verify everything is healthy
.venv\Scripts\python -m backend.verify_cognee
```

### Start the app (two terminals, keep both open)
```powershell
# Terminal 1 — backend
.venv\Scripts\python -m uvicorn backend.main:app --reload-dir backend --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Then open **http://localhost:3000** in your browser.

### Quick health check anytime
```powershell
.venv\Scripts\python -c "import sqlite3; conn = sqlite3.connect('anamnesis.db'); c = conn.cursor(); print('Events:', c.execute('SELECT COUNT(*) FROM events;').fetchone()[0]); print('QA:', c.execute('SELECT COUNT(*) FROM qa_sessions;').fetchone()[0])"
```

---

