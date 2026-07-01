# Anamnesis (MVP) — PRD, 7-Day Build Workflow, and Antigravity Prompts

Scope lock: **Memory Timeline + Ask Why (Memory Blame)** and **Branch & Replay (demo-only)**. Nothing else. Every decision below was made to survive a 7-day build by 1-4 people and a 3-minute live demo, while still genuinely exercising Cognee's `remember()` → `recall()` → `improve()` lifecycle (not just `recall()`-as-RAG) — this is what the "Best Use of Cognee" judging criterion is actually going to be scored on.

---

# PART 1 — PRODUCT REQUIREMENTS DOCUMENT (PRD)

## 1.1 Product Name & Tagline
**Anamnesis** — "Git for AI Memory." MVP scope only: a single scripted demo agent, two features.

## 1.2 Problem Statement
Developers building autonomous agents (LangGraph, CrewAI, OpenAI Agents SDK, AutoGen) have logs and traces but cannot answer *why* the agent decided something, *which memory* caused it, or *why it chose Tool A over Tool B*. Current observability tools (LangSmith, Helicone, Langfuse) show what executed — they don't capture what was considered and rejected, because traces only record the path actually taken.

## 1.3 Goals (this build, 7 days)
- **G1:** Make every agent decision inspectable — what happened, why, and which exact memories caused it, with citations.
- **G2:** Answer comparative questions ("why Tool A, not Tool B") using alternatives captured *at decision time*, never reconstructed after the fact.
- **G3:** Prove, live, that changing one memory changes agent behavior (Branch & Replay).
- **G4:** Never assert anything that isn't traceable to a real memory node; say so explicitly when it can't.

## 1.4 Non-Goals (explicitly out of scope — do not build, do not let an agent "improve" into these)
Memory PR / governance workflow · Memory Health Score / drift alerting · CLI · SDK · multi-agent fleet view · enterprise features (SSO, multi-tenant orgs, audit retention) · open protocol publication · general arbitrary-timestamp branching engine · decorative dashboards or animations.

## 1.5 Target User (for the demo)
A hackathon judge / AI engineer who needs to grasp the value in under 3 minutes — ideally by asking an unscripted question themselves and watching it get answered correctly, live.

## 1.6 Core Use Cases
- **UC1:** Scrub a timeline of a scripted agent run; click "Why?" on any event.
- **UC2:** Ask a free-text question about an arbitrary moment; get a sourced answer in under ~3 seconds.
- **UC3:** Ask "why Tool A instead of Tool B"; get a side-by-side citing both the chosen and rejected option's reasoning.
- **UC4:** Pick the one supported branch point, mutate a memory, replay forward, watch the decision change live.

## 1.7 Functional Requirements

**FR-1 — Event Capture.** Every agent action becomes an event via `cognee.remember()`. Types: `user_prompt`, `memory_read`, `memory_write`, `decision`, `tool_call`, `api_response`, `error`, `final_output`. Every event stores: timestamp, event_type, summary, confidence (0–1), memory_ids_used, memory_ids_created. **Decision events additionally store** `chosen_option` and `rejected_alternatives[]` (each with its own confidence + rejection_reason). This field is the single most important schema decision in the whole build — it cannot be retrofitted later.

**FR-2 — Contradiction Flagging.** On write, check whether the new event conflicts with an existing high-confidence node on the same entity. If so, set `contradiction_flag = true` so it's visible on the timeline without anyone having to query for it.

**FR-3 — Timeline View.** Chronological event list. Each row: timestamp · type icon · one-line summary · confidence badge · contradiction indicator (if any) · a **"Why?" button** (no typing required — it auto-fires a templated question scoped to that event).

**FR-4 — Ask Why (Memory Blame).** Input: a clicked row, or free text. Process: classify the question (general vs. comparison) → retrieve narrow first (1-hop via `cognee.recall()`), widen to 2/3-hop only if the chain is incomplete → LLM answers using **only** retrieved node content, with inline citations → if a required memory is missing, say so explicitly rather than inventing it. **Write-back (do not skip this):** store the question+answer pair itself as a new memory event linked to the nodes it cites, then call `cognee.improve()` so the system measurably sharpens on similar future questions. This is what makes the feature use Cognee's memory lifecycle instead of being RAG with extra steps.

**FR-5 — Comparison Questions (Tool A vs Tool B).** When a question matches a decision event that has `rejected_alternatives`, render a dedicated side-by-side: chosen option + confidence + citing memory IDs, next to each rejected option + confidence + rejection reason + citing memory IDs.

**FR-6 — Branch & Replay (demo-only).** One specific, pre-chosen point in the scripted run. "Branch" = duplicate the Cognee dataset up to that point into a second, isolated dataset. Mutate exactly one fact in the copy. "Replay" = re-run the agent's next decision step against the mutated copy. Display original vs. replayed decision side by side.

## 1.8 Non-Functional Requirements
- Ask Why must answer in well under ~3 seconds on the demo dataset — it has to survive an unscripted question live, not just a rehearsed one.
- Zero hallucinated citations, ever — every claim maps to a real memory ID or the system admits it doesn't know.
- UI: exactly two panels (timeline + answer), minimal palette (gray / yellow / red), no extra chrome, keyboard-navigable.

## 1.9 Data Model (minimal, single-tenant — this is intentionally NOT the full multi-org schema from earlier drafts)
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id TEXT NOT NULL DEFAULT 'demo-agent-1',
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL,
  memory_ids_used TEXT[],
  memory_ids_created TEXT[],
  chosen_option TEXT,
  rejected_alternatives JSONB,
  contradiction_flag BOOLEAN DEFAULT FALSE,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE qa_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  cited_memory_ids TEXT[],
  question_type TEXT, -- 'general' | 'comparison'
  created_at TIMESTAMPTZ DEFAULT now()
);
```
*(Postgres here is just a fast index for timeline pagination/scrubbing — Cognee remains the actual memory substrate. If Postgres setup eats into day 1, SQLite is an acceptable substitution; it changes nothing else in this spec.)*

## 1.10 API Contracts
```
POST /events                  agent posts a new event   (wraps cognee.remember())
GET  /timeline                 paginated event list for the UI
POST /ask                      { question, target_event_id? } -> sourced answer
POST /branch-replay/run         triggers the one hardcoded branch+mutate+replay
GET  /branch-replay/result       original vs. replayed decision
```

## 1.11 Success Metrics (for this hackathon, not a company)
A judge asks one unscripted question live and gets a correct, sourced answer. The Tool A/B reveal cites both options correctly. Branch & Replay visibly produces a different decision than the original run. Zero hallucinated citations during the live demo.

## 1.12 Risks
Negative-space capture (`rejected_alternatives`) must be in the toy agent's logging from day one — it cannot be bolted on day 6. Fluent LLM narration without citation-binding is a correctness trap, not a polish issue. The whole demo runs on rehearsed, deterministic data — zero live external dependencies that could fail on stage.

---

# PART 2 — 7-DAY BUILD WORKFLOW

**Day 1 — Schema + scaffolding.** Lock the decision-event JSON schema (Section 1.7/FR-1) first — this is the one decision that's expensive to change later. Scaffold Next.js + Tailwind frontend, FastAPI backend, Postgres (or SQLite), local Cognee (Kuzu/LanceDB defaults). Write the toy scripted agent skeleton — pick something simple (an ops/deployment bot is easiest): 8–12 scripted events, including **at least one explicit Tool A vs. Tool B decision**, one fact that will later get contradicted, one error, one final output.

**Day 2 — Wire `remember()` end-to-end.** Every event type calls `cognee.remember()` with the FR-1 schema. Run the full scripted agent once, confirm the Cognee graph builds correctly locally. Implement the contradiction check (FR-2) — a simple entity + conflicting-claim heuristic is enough. Build `POST /events` (writes to both Postgres index and Cognee).

**Day 3 — Timeline.** Build `GET /timeline` (paginated, includes `contradiction_flag`). Build the timeline UI: rows with type icon, summary, confidence badge, red contradiction dot, "Why?" button — no text input required for this interaction.

**Day 4 — Ask Why (general questions).** Build `POST /ask`: classify → narrow-then-widen `cognee.recall()` → citation-bound LLM call → explicit "I don't have a record of that" path when memories are missing. **Add the write-back**: store the Q&A as a new event, call `cognee.improve()`. Build the answer panel UI: prose answer, numbered clickable citations that jump back to the timeline row.

**Day 5 — Comparison questions.** This is the headline differentiator — give it real time. Extend `/ask` to detect comparison-type questions and pull `rejected_alternatives` directly from the matched decision event. Build the dedicated side-by-side UI. Test it specifically with rephrased, unscripted versions of the question, since this is the part most likely to be probed live by a judge.

**Day 6 — Branch & Replay.** Pick the one hardcoded commit point ahead of time. Build `POST /branch-replay/run` (duplicate dataset → mutate one fact → replay the next decision) and `GET /branch-replay/result`. Build the before/after decision UI.

**Day 7 — Polish + rehearse.** Sub-one-day adds: clickable permalink for a Q&A, arrow-key timeline navigation, confidence-badge wording ("supported by 3 memories"). Full rehearsal of the exact 3-minute sequence: unscripted question → Tool A/B reveal → Branch & Replay → revert. Record a backup video. Write the README explicitly naming which Cognee primitives are used where (`remember`/`recall`/`improve`) — this directly feeds the "Best Use of Cognee" criterion.

---
# PART 3 — PROMPTS FOR GOOGLE ANTIGRAVITY

Antigravity plans, executes, and verifies tasks across your editor/terminal/browser, and produces Artifacts (plans, screenshots, walkthroughs) you review for trust. Two practical implications for this build:

- **Use Plan Mode for Prompt 1.** The schema and architecture decisions in Day 1–2 are foundational and hard to undo — review the Plan Artifact before letting it execute. Fast Mode is fine from Prompt 2 onward, where the work is more mechanical.
- **Persist the spec in the repo, not just the chat.** Paste the block below into a file at your project root named `SPEC.md` *before* your first prompt, and commit it. Reference it in every prompt ("per SPEC.md") so the agent's context doesn't drift back toward the cut features across a multi-day session — agentic coding tools left to their own judgment tend to "improve" scope unless explicitly fenced in.

### `SPEC.md` (paste this at the project root first)
```markdown
# Anamnesis MVP — Locked Scope
Building EXACTLY two features, nothing else:
1. Memory Timeline + Ask Why (Memory Blame)
2. Branch & Replay (demo-only: one hardcoded point, dataset duplication, not a general branching engine)

Explicitly NOT building: Memory PR, Memory Health Score, CLI, SDK, multi-agent support,
enterprise features, open protocol, fancy dashboards, animations, decorative UI.

Tech stack: Next.js + Tailwind (frontend) · FastAPI (backend) · Cognee (memory layer,
local mode: Kuzu/LanceDB) · Postgres or SQLite (thin event index only — Cognee is the
real memory substrate) · one LLM provider for reasoning.

Non-negotiable design rules:
- Decision events MUST store chosen_option AND rejected_alternatives[] (each with its
  own confidence + rejection_reason), captured at decision time. Never reconstruct
  alternatives after the fact.
- Every "Ask Why" answer must cite real memory IDs. If a memory is missing, say so
  explicitly. Never invent information.
- Every Ask Why session writes back: store the Q&A as a new memory event, then call
  cognee.improve() so future similar questions resolve faster.
- UI is exactly two panels: timeline (left) and answer (right). No extra dashboards.
```

### Prompt 1 — Foundation (Day 1–2, use Plan Mode)
```
Read SPEC.md at the project root before doing anything else and follow it exactly —
do not add features beyond what it lists.

Set up the project: Next.js + Tailwind frontend, FastAPI backend, Postgres (or SQLite
if faster to set up locally) with the `events` and `qa_sessions` tables exactly as
defined in SPEC.md, and a local Cognee instance using its default local backends.

Then build a small scripted demo agent (a toy deployment/ops bot is fine — it does not
need to be a real working system, just realistic-looking) that produces 8-12 events
covering: at least one decision event with an explicit "chose Tool A over Tool B"
scenario (with a real rejection_reason, not a placeholder), one fact that a LATER event
will contradict, one error event, and one final_output event.

Wire every event to call cognee.remember() using the schema in SPEC.md, including
chosen_option and rejected_alternatives for decision events. Run the full scripted
agent once and confirm the Cognee graph actually contains these nodes — show me how
you verified this, don't just claim it works.

Do not build the timeline UI, Ask Why, or Branch & Replay yet — this task is scoped to
schema + scripted agent + verified Cognee writes only.
```

### Prompt 2 — Timeline (Day 3)
```
Per SPEC.md, build:
1. A GET /timeline endpoint that returns the paginated event list from Postgres,
   including a contradiction_flag per event. Implement a simple contradiction check on
   write: if a new event's content conflicts with an existing high-confidence memory
   about the same entity, set contradiction_flag = true.
2. The timeline UI: a vertical list, one row per event, showing timestamp, a type icon,
   the one-line summary, a confidence badge, a red dot if contradiction_flag is true,
   and a "Why?" button on every row.

The "Why?" button does not need to do anything yet except be visibly present and
clickable — Ask Why itself is the next task. Keep the UI to exactly this one panel for
now, no extra dashboard elements, per SPEC.md.
```

### Prompt 3 — Ask Why, general questions (Day 4)
```
Per SPEC.md, build the POST /ask endpoint:
- Accept either a target_event_id (from a timeline row's "Why?" click, which should
  auto-generate a templated question scoped to that event) or free-text `question`.
- Retrieve narrow first: call cognee.recall() scoped to the 1-hop neighborhood of the
  relevant event/entity. Only widen to 2-hop or 3-hop if the retrieved context is
  insufficient to answer the question.
- Generate the answer with an LLM call that is ONLY allowed to assert things it has a
  retrieved memory ID for. If a required memory genuinely isn't in the retrieved set,
  the answer must say so explicitly instead of guessing.
- Write back: after answering, store the question+answer pair as a new memory event
  (linked to the memory IDs it cited) via cognee.remember(), then call
  cognee.improve(). This step is required, not optional — do not skip it.

Build the right-hand answer panel UI: short prose answer, then a numbered list of cited
memory IDs underneath, each clickable, jumping back to and highlighting that row in the
timeline.

Test this by clicking "Why?" on at least 3 different timeline rows and confirming the
citations are real, correct memory IDs, not invented ones.
```

### Prompt 4 — Comparison questions (Day 5)
```
Per SPEC.md, extend POST /ask to detect comparison-type questions (e.g. "why did it
choose X instead of Y", "why not Tool B") and, when the matched event is a decision
event with rejected_alternatives, render a dedicated side-by-side instead of the normal
prose answer: the chosen option with its confidence and citing memory IDs, next to each
rejected alternative with its confidence, rejection reason, and citing memory IDs.

Test this with at least 3 different phrasings of the same underlying question (not just
the exact wording from your own seeded data) to confirm the comparison-detection is
robust enough to survive an unscripted question, since this is the centerpiece of the
demo.
```

### Prompt 5 — Branch & Replay (Day 6)
```
Per SPEC.md, this is explicitly the demo-only version, not a general branching engine.

Pick ONE specific event in the scripted agent's timeline as the fixed branch point
(tell me which one you picked and why). Build:
- POST /branch-replay/run: duplicate the current Cognee dataset up to that point into a
  second, separate dataset; apply one specific, hardcoded mutation to a single memory
  in the duplicate; then re-run only the next decision step of the scripted agent
  against the mutated duplicate.
- GET /branch-replay/result: return both the original decision and the replayed
  decision so they can be shown side by side.

Build a simple UI for this: a button that triggers the run, and a side-by-side view of
"original decision" vs. "replayed decision" once it completes. Confirm for me that the
replayed decision is actually different from the original, not coincidentally the same.
```

### Prompt 6 — Polish + rehearsal (Day 7)
```
Per SPEC.md, do only these small additions, nothing else:
1. A copy/share permalink for any individual Q&A from Ask Why.
2. Arrow-key navigation up/down through the timeline rows.
3. Review the confidence badge wording across the UI so it reads like "supported by 3
   memories" rather than a raw decimal score.
4. Do a pass confirming the color palette is only gray (normal), yellow (low
   confidence), and red (contradiction/error) — remove any other colors or decorative
   UI elements you may have added along the way.

Then walk me through the full demo sequence end to end as a judge would experience it:
ask one question you pick yourself (not from a prepared script) about an arbitrary
timeline event, then trigger the Tool A vs Tool B comparison, then run Branch & Replay.
Show me each step's actual output so I can confirm nothing is hallucinated or broken
before I rehearse this myself.
```
