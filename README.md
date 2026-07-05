# Anamnesis — "Git for AI Memory"

**Make AI agent memory visible, explainable, and reversible.**

An observability platform built on Cognee that helps developers debug autonomous AI agents by exposing their decision-making process, the memories that influenced each decision, and the ability to replay decisions with altered memories.

---

## The Problem

Autonomous AI agents (LangGraph, CrewAI, OpenAI Agents SDK, AutoGen) now run for hours or days, making dozens of decisions using memories they accumulate. When something breaks, developers have:
- Logs (what happened)
- Traces (which tools were called)
- Outputs (what came out)

But **not:**
- Why a decision was made
- Which memories influenced it
- What alternatives were considered and rejected
- Whether new beliefs contradict old ones
- What would happen if one memory changed

**Anamnesis answers all five.**

---

## Features

### 1. Memory Timeline
Every agent action becomes an inspectable event: user prompts, memory reads/writes, decisions, tool calls, errors, outputs. Each event shows:
- Type icon
- Timestamp
- Summary
- Confidence score ("supported by X memories")
- Red contradiction flag if it conflicts with earlier beliefs

### 2. Ask Why (Memory Blame)
Click "Why?" on any event, or ask a free-text question. Get an answer in under 3 seconds with citations to the exact memories that caused the decision. Click a citation to jump to that memory in the timeline.

### 3. Comparison Questions
When an agent chose between options, see them side-by-side:
- **Chosen:** Option A, confidence, citing memories
- **Rejected:** Option B, rejection reason, citing memories

Proves the agent actually deliberated, not just narrated after the fact.

### 4. Branch & Replay
Change one memory, replay the agent's decision, watch the outcome change. Live proof that decisions are driven by memories, not luck.

### 5. Memory Retraction (`forget()`)
Click "Retract this memory" on any citation. The memory is deleted from Cognee's graph. Re-ask the same question — the system either finds a different answer or honestly says "I don't have a record of that." No hallucinations.

### 6. Shareable Permalinks
Copy a link to any Q&A session. Recipients reload and see that exact explanation.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | Next.js + TypeScript + Tailwind CSS + Lucide Icons | Fast, clean, zero unnecessary chrome |
| **Backend** | FastAPI (Python) | Async-friendly, pairs naturally with Cognee SDK |
| **Memory** | **Cognee** (Kuzu graph + LanceDB vector) | Graph + vector reasoning for semantic retrieval |
| **Event Index** | SQLite | Fast timeline pagination (Cognee is the real memory substrate) |
| **LLM** | Groq (Llama 3.3, free tier) | Fast, free, OpenAI-compatible |

---

## How Anamnesis Uses Cognee

**All four memory primitives, not just two:**

### `cognee.remember()`
Every agent event and Q&A pair is stored as a graph node. This builds the actual memory foundation.

### `cognee.recall()`
Every "Ask Why" query calls `recall()` scoped to the 1-hop neighborhood, widening only if needed. Real semantic retrieval, not keyword search.

### `cognee.improve()`
After every answer, the Q&A pair is stored as a new memory event, then `improve()` reweights cited memories. The system gets sharper on similar future questions — it learns from use.

### `cognee.forget()`
Memory retraction calls `forget()` to permanently delete from Cognee's graph. The system can't use it, can't cite it, can't hallucinate around it. Proves the system admits ignorance rather than inventing.

**This is the complete memory lifecycle.** Most tools stop at `remember()` + `recall()`. We use all four.

---

## Quick Start (Local)

### Prerequisites
- Python 3.11+
- Node.js 18+
- Groq API key (free at console.groq.com)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR-USERNAME/Cognee-hackathon.git
cd Cognee\ hackathon

# 2. Create virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # macOS/Linux

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Create .env file
# Create a file named .env at the project root with:
# GROQ_API_KEY=your-groq-key-here

# 5. Seed the agent (generates 10 events + Cognee graph)
python -m backend.agent

# 6. Start backend (Terminal 1)
powershell

`.venv\Scripts\python -m uvicorn backend.main:app --reload-dir backend --port 8000`

**What you should see:**

`INFO:     Started server process [5864]
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000`

# 7. Start frontend (Terminal 2)
cd frontend
npm install
npm run dev

# 8. Open http://localhost:3000
```

---

## Architecture

```
Agent Events
    ↓ cognee.remember()
Cognee Graph (Kuzu + LanceDB)
    ↓ cognee.recall()
FastAPI Backend (/ask, /timeline, /forget, /branch-replay)
    ↓ HTTP/JSON
Next.js Frontend (two-panel UI: timeline + answer)
    ↓ User clicks, types questions
```

---

## Demo Walkthrough (3 minutes)

1. **Timeline visible** — All 10 events with icons, badges, contradiction dots
2. **Ask unscripted question** — "Why did step 6 fail?" → Answer with citations
3. **Click citation** — Timeline row highlights, scrolls into view
4. **Comparison question** — "Why Helm instead of kubectl?" → Side-by-side comparison cards
5. **Branch & Replay** — Change one memory, replay decision, see different outcome
6. **Retract memory** — Click "Retract," re-ask, get honest "I don't have a record" instead of hallucination

---

## Deployment

### Deploy on Railway (Easiest, Free)

1. Push to GitHub
2. Go to railway.app, sign up with GitHub
3. Click "New Project" → "Deploy from GitHub"
4. Select your repo
5. Set environment variable: `GROQ_API_KEY=your-key`
6. Railway auto-deploys both frontend and backend
7. Get live URLs for both

Or use Vercel (frontend) + Render (backend) separately.

**Live demo:** `https://anamnesis-production-xxxx.railway.app`

---

## Project Structure

```
Cognee hackathon/
├── .env                    ← GROQ_API_KEY (never commit)
├── .gitignore
├── SPEC.md                 ← Locked scope
├── README.md               ← This file
├── requirements.txt
├── anamnesis.db            ← SQLite event index
├── cognee_data/            ← Cognee graph + vectors (live)
├── branch_snapshot/        ← Frozen Cognee state (for demo)
├── backend/
│   ├── main.py             ← FastAPI app + all endpoints
│   ├── agent.py            ← Scripted demo agent (10 events)
│   ├── db.py               ← SQLAlchemy models
│   ├── schemas.py          ← Pydantic validation
│   └── verify_cognee.py    ← Health check script
└── frontend/
    └── src/app/
        └── page.tsx        ← Two-panel React UI
```

---

## Key Endpoints

```
GET  /timeline                    → Paginated event list
POST /events                      → Agent posts new event
POST /ask                         → { question, target_event_id? } → sourced answer
GET  /qa/{qa_id}                  → Fetch stored Q&A (for permalinks)
POST /forget/{memory_id}          → Retract a memory
POST /branch-replay/run           → Mutate memory + replay decision
GET  /branch-replay/result        → Original vs. replayed decision
```

---

## Why This Matters

As AI agents become autonomous and run in production:
- Debugging becomes impossible with logs alone
- Memory corruption (wrong beliefs) is hard to catch
- Decision causality is hidden
- Hallucinations go undetected

**Anamnesis makes all of that visible.**

It's the infrastructure layer the agentic AI economy needs — the same way Git made code state inspectable and reversible.

---

## What's Next (Post-Hackathon)

- [ ] Integration with LangGraph / CrewAI / OpenAI Agents SDK
- [ ] Multi-agent comparison (see how different agents handle the same scenario)
- [ ] Memory health scoring (drift detection, contradiction alerts)
- [ ] Compliance-grade audit trails
- [ ] Memory PR governance (human review before beliefs merge into permanent memory)
- [ ] Cross-company anonymized memory patterns (benchmark your agent against others)

---

## Built For

**WeMakeDevs × Cognee Hackathon** — "The Hangover Part AI: Where's My Context?"

**Team:** 1 builder, 7 days, 100% Cognee lifecycle usage.

---

## License

MIT

---

## Questions?

See the full project documentation in `ANAMNESIS_FINAL_DOC.md` (includes architecture diagrams, API contracts, and the complete demo script).

---

**This is memory-native infrastructure for AI. Not another chatbot. Not a wrapper. A real tool.**
