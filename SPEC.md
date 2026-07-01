# Anamnesis MVP — Locked Scope
Building EXACTLY two features, nothing else:
1. Memory Timeline + Ask Why (Memory Blame)
2. Branch & Replay (demo-only: one hardcoded point, dataset duplication, not a general branching engine)

Explicitly NOT building: Memory PR, Memory Health Score, CLI, SDK, multi-agent support,
enterprise features, open protocol, fancy dashboards, animations, decorative UI.

Tech stack: Next.js + Tailwind (frontend) · FastAPI (backend) · Cognee (memory layer,
local mode: Kuzu/LanceDB) · SQLite (thin event index only — Cognee is the
real memory substrate) · one LLM provider (OpenAI gpt-4o-mini) for reasoning.

Non-negotiable design rules:
- Decision events MUST store chosen_option AND rejected_alternatives[] (each with its
  own confidence + rejection_reason), captured at decision time. Never reconstruct
  alternatives after the fact.
- Every "Ask Why" answer must cite real memory IDs. If a memory is missing, say so
  explicitly. Never invent information.
- Every Ask Why session writes back: store the Q&A as a new memory event, then call
  cognee.improve() so future similar questions resolve faster.
- UI is exactly two panels: timeline (left) and answer (right). No extra dashboards.
- Timeline events flag contradiction_flag = true (shown as a red indicator) when they conflict with an existing high-confidence memory about the same entity. This must be visible on the timeline itself, with no query required.
- Questions matching a decision event's rejected_alternatives MUST render as a dedicated side-by-side comparison (chosen option vs. each rejected option, with confidence and citations on both sides) — never collapsed into plain prose. This is the headline differentiator of the demo; do not simplify it under time pressure.


Branch & Replay Snapshot Rule:
- During the initial scripted agent run, take a one-time snapshot of the Cognee database directory immediately after the chosen branch-point event is written (before any later events are written), and save that as a fixed `branch_snapshot/` folder committed to the repo.
- The live Branch & Replay action will copy from this fixed snapshot, apply the mutation, and replay the next decision step from there.
