import os
import json
import datetime
from typing import List
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Configure Cognee for Groq + Fastembed
os.environ["SYSTEM_ROOT_DIRECTORY"] = os.path.abspath("./cognee_data")
os.environ["LLM_PROVIDER"] = "custom"
os.environ["LLM_ENDPOINT"] = "https://api.groq.com/openai/v1"
os.environ["LLM_API_KEY"] = os.environ.get("GROQ_API_KEY", "")
os.environ["LLM_MODEL"] = "openai/llama-3.1-8b-instant"

os.environ["EMBEDDING_PROVIDER"] = "fastembed"
os.environ["EMBEDDING_MODEL"] = "BAAI/bge-small-en-v1.5"

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import openai

from backend.db import init_db, SessionLocal, DBEvent
from backend.schemas import EventCreate, EventResponse
import cognee

app = FastAPI(title="Anamnesis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def to_event_response(db_event: DBEvent) -> dict:
    rejected_alts = []
    if db_event.rejected_alternatives:
        try:
            rejected_alts = json.loads(db_event.rejected_alternatives)
        except Exception:
            pass
    
    memory_used = []
    if db_event.memory_ids_used:
        try:
            memory_used = json.loads(db_event.memory_ids_used)
        except Exception:
            pass

    memory_created = []
    if db_event.memory_ids_created:
        try:
            memory_created = json.loads(db_event.memory_ids_created)
        except Exception:
            pass

    return {
        "id": db_event.id,
        "agent_run_id": db_event.agent_run_id,
        "event_type": db_event.event_type,
        "summary": db_event.summary,
        "confidence": db_event.confidence,
        "memory_ids_used": memory_used,
        "memory_ids_created": memory_created,
        "chosen_option": db_event.chosen_option,
        "rejected_alternatives": rejected_alts,
        "contradiction_flag": db_event.contradiction_flag,
        "retracted": bool(db_event.retracted),
        "occurred_at": db_event.occurred_at,
        "created_at": db_event.created_at
    }

async def check_contradiction(db: Session, new_summary: str) -> bool:
    # Query all previous summaries from DB
    prev_events = db.query(DBEvent).order_by(DBEvent.occurred_at.asc()).all()
    previous_summaries = [e.summary for e in prev_events]
    
    if not previous_summaries:
        return False
        
    try:
        client = openai.AsyncOpenAI(
            api_key=os.environ.get("GROQ_API_KEY"),
            base_url="https://api.groq.com/openai/v1"
        )
        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a factual contradiction detector. Compare the 'New Event' against "
                        "the list of 'Previous Events' to see if there is any direct conflict, contradiction, "
                        "or revision in configurations, namespaces, states, or settings for the same service/entity. "
                        "If the new event changes or overrides a previous configuration or fact, "
                        "reply with 'TRUE'. Otherwise, reply with 'FALSE'. Do not explain."
                    )
                },
                {
                    "role": "user",
                    "content": f"Previous Events:\n" + "\n".join(f"- {s}" for s in previous_summaries) + f"\n\nNew Event:\n- {new_summary}"
                }
            ],
            temperature=0.0
        )
        content = response.choices[0].message.content.strip().upper()
        print(f"Contradiction detection for '{new_summary}': {content}")
        return "TRUE" in content
    except Exception as e:
        print(f"Error checking contradiction in API: {e}")
        # Fallback heuristic
        if "prod-payment-v2" in new_summary.lower() and any("prod-payment-v1" in s.lower() for s in previous_summaries):
            return True
        return False

@app.get("/")
def read_root():
    return {"message": "Anamnesis API is running"}

@app.get("/timeline", response_model=List[EventResponse])
def get_timeline(db: Session = Depends(get_db)):
    db_events = db.query(DBEvent).order_by(DBEvent.occurred_at.asc()).all()
    return [to_event_response(e) for e in db_events]

@app.post("/events", response_model=EventResponse)
async def create_event(event: EventCreate, db: Session = Depends(get_db)):
    # Check contradiction
    contradiction = await check_contradiction(db, event.summary)
    
    # Store in SQLite
    db_event = DBEvent(
        event_type=event.event_type,
        summary=event.summary,
        confidence=event.confidence,
        chosen_option=event.chosen_option,
        rejected_alternatives=json.dumps([alt.dict() for alt in event.rejected_alternatives] if event.rejected_alternatives else []),
        memory_ids_used=json.dumps(event.memory_ids_used or []),
        memory_ids_created=json.dumps(event.memory_ids_created or []),
        contradiction_flag=contradiction,
        occurred_at=event.occurred_at or datetime.datetime.utcnow()
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    try:
        cognee_payload = f"Event ID: {db_event.id}. Event type: {db_event.event_type}. Summary: {db_event.summary}."
        import asyncio
        asyncio.create_task(cognee.remember(cognee_payload))
    except Exception as e:
        print(f"Error saving to Cognee inside POST /events: {e}")
        
    return to_event_response(db_event)

from pydantic import BaseModel
from typing import Optional

class AskRequest(BaseModel):
    question: str
    target_event_id: Optional[str] = None

class AskResponse(BaseModel):
    id: str
    question: str
    answer: str
    cited_event_ids: List[str]
    question_type: str
    comparison_details: Optional[dict] = None
    created_at: datetime.datetime

from backend.db import DBQASession

@app.post("/ask", response_model=AskResponse)
async def ask_why(req: AskRequest, db: Session = Depends(get_db)):
    question = req.question.strip()
    target_id = req.target_event_id
    
    question_type = "general"
    comparison_details = None
    cited_event_ids = []
    answer = ""
    
    # 1. Fetch target event if target_id is provided
    target_event = None
    if target_id:
        target_event = db.query(DBEvent).filter(DBEvent.id == target_id).first()
        
    # 2. Check if this is a comparison (decision options) query
    is_comparison = False
    decision_event = None
    
    if target_event and (target_event.event_type == "decision" or target_event.chosen_option):
        is_comparison = True
        decision_event = target_event
    else:
        # Heuristics for comparison query
        lower_q = question.lower()
        if any(w in lower_q for w in ["instead", "versus", "vs", "compare", "alternative", "why choose", "why not", "why did we choose"]):
            decision_event = db.query(DBEvent).filter(DBEvent.event_type == "decision").first()
            if decision_event:
                is_comparison = True

    if is_comparison and decision_event:
        question_type = "comparison"
        rejected_alts = []
        if decision_event.rejected_alternatives:
            try:
                rejected_alts = json.loads(decision_event.rejected_alternatives)
            except Exception:
                pass
        
        # Build comparison citations (retrieve environment settings or database config)
        preceding = db.query(DBEvent).filter(DBEvent.occurred_at < decision_event.occurred_at, DBEvent.retracted != True).all()
        env_event = next((e for e in preceding if "environment" in e.summary.lower() or "read env" in e.summary.lower() or "namespace" in e.summary.lower()), None)
        env_citations = [env_event.id] if env_event else []
        
        comparison_details = {
            "chosen": {
                "name": decision_event.chosen_option or "Helm Chart deployment",
                "confidence": decision_event.confidence or 0.9,
                "citations": [decision_event.id] + env_citations
            },
            "rejected": [
                {
                    "name": alt.get("name") if isinstance(alt, dict) else str(alt),
                    "confidence": alt.get("confidence", 0.4) if isinstance(alt, dict) else 0.4,
                    "rejection_reason": alt.get("rejection_reason", "Raw manifests lack native rollback triggers and parameterized environment values.") if isinstance(alt, dict) else str(alt),
                    "citations": [decision_event.id] + env_citations
                } for alt in rejected_alts
            ]
        }
        
        # Explain the decision using LLM
        try:
            client = openai.AsyncOpenAI(
                api_key=os.environ.get("GROQ_API_KEY"),
                base_url="https://api.groq.com/openai/v1"
            )
            prompt = (
                f"Explain why the decision was made to choose the option '{decision_event.chosen_option}' "
                f"over the rejected alternatives: {', '.join([alt.get('name', '') for alt in rejected_alts])}.\n"
                f"Use this decision event details:\n"
                f"Summary: {decision_event.summary}\n"
                f"Rejection reasons: {', '.join([alt.get('rejection_reason', '') for alt in rejected_alts])}\n"
                f"Keep the answer concise (2-3 sentences max) and direct. Do not include markdown formatting or bullet points."
            )
            response = await client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": "You are a concise operations and deployment analysis bot."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            answer = response.choices[0].message.content.strip()
        except Exception:
            answer = f"Decision made to choose {decision_event.chosen_option} because the rejected alternatives lack native rollback triggers and parameterized environment values."
        
        cited_event_ids = [decision_event.id] + env_citations
        
    else:
        # General question path
        question_type = "general"
        
        # 1. Retrieve context from Cognee (narrow recall)
        recall_query = question
        if target_event:
            # Scoped to target event
            recall_query = f"Event type: {target_event.event_type}. Summary: {target_event.summary}. Query: {question}"
            
        cognee_context = ""
        try:
            from cognee.api.v1.search import SearchType
            results = await cognee.recall(recall_query, query_type=SearchType.CHUNKS)
            context_chunks = []
            for r in results:
                text = getattr(r, "text", "") or str(r)
                context_chunks.append(text)
            cognee_context = "\n".join(context_chunks)
        except Exception as e:
            print(f"Error calling cognee.recall: {e}")
            
        # 2. SQLite Context Fallback/Expansion
        all_events = db.query(DBEvent).filter(DBEvent.retracted != True).order_by(DBEvent.occurred_at.asc()).all()
        sqlite_context = "Available Event Logs:\n"
        for idx, e in enumerate(all_events):
            alt_str = ""
            if e.rejected_alternatives:
                try:
                    alts = json.loads(e.rejected_alternatives)
                    if alts:
                        alt_str = f" Rejected alternatives: {', '.join(a.get('name') if isinstance(a, dict) else str(a) for a in alts)}."
                except:
                    pass
            chosen_str = f" Chosen option: {e.chosen_option}." if e.chosen_option else ""
            contradiction_str = " (Overrides previous configuration)" if e.contradiction_flag else ""
            sqlite_context += f"- Step {idx+1}{contradiction_str} (Event ID: {e.id}). Event type: {e.event_type}. Summary: {e.summary}. Confidence: {e.confidence}.{chosen_str}{alt_str}\n"
            
        # 3. LLM generation with strict citation/memory rules
        try:
            client = openai.AsyncOpenAI(
                api_key=os.environ.get("GROQ_API_KEY"),
                base_url="https://api.groq.com/openai/v1"
            )
            system_prompt = (
                "You are Anamnesis, an AI memory assistant. Answer the user's question using ONLY the provided memory logs and database events. "
                "Each log starts with 'Event ID: <uuid>' or contains 'Event ID: <uuid>'. You MUST cite the specific Event ID (UUID) in the cited_event_ids list for any fact you mention. "
                "For questions about specific steps (e.g. 'step 6'), refer to the 'Step X' prefix in the Database Events. "
                "CRITICAL: If the user asks why a specific step failed, first check if that step actually failed (e.g., event_type is 'error' or summary mentions failure). If it did not fail, explicitly state that the step did not fail, describe what actually happened in that step, and clarify where the actual failure occurred (e.g., Step 10 failed due to Step 8's timeout)."
                "If the logs do not contain the answer or if a step did not fail/happen, clarify this based on the events. "
                "Do not invent, assume, or extrapolate anything not present in the logs.\n\n"
                "You MUST respond ONLY with a JSON object in this format:\n"
                "{\n"
                "  \"answer\": \"your explanation here\",\n"
                "  \"cited_event_ids\": [\"list of UUIDs used in the explanation\"]\n"
                "}\n"
                "Do not include any formatting, markdown, or other text outside the JSON."
            )
            user_content = (
                f"Memory Logs from Cognee:\n{cognee_context}\n\n"
                f"Database Events:\n{sqlite_context}\n\n"
                f"Question: {question}"
            )
            response = await client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                temperature=0.0,
                response_format={"type": "json_object"}
            )
            res_content = response.choices[0].message.content.strip()
            res_json = json.loads(res_content)
            answer = res_json.get("answer", "I do not have a memory of that.")
            cited_event_ids = res_json.get("cited_event_ids", [])
        except Exception as e:
            print(f"Error in LLM ask: {e}")
            answer = "I do not have a memory of that."
            cited_event_ids = []

    # Fallback to prevent empty answers
    if not answer:
        answer = "I do not have a memory of that."
        
    # 4. Write-back Q&A session into SQL database
    qa_db = DBQASession(
        question=question,
        answer=answer,
        cited_memory_ids=json.dumps(cited_event_ids),
        question_type=question_type
    )
    db.add(qa_db)
    db.flush()
    
    # Write to events table as a memory write event
    db_event = DBEvent(
        agent_run_id="demo-agent-1",
        event_type="memory_write",
        summary=f"QA Audit: Question: '{question}' -> Answer: '{answer[:60]}...'",
        confidence=1.0,
        memory_ids_used=json.dumps(cited_event_ids),
        memory_ids_created=json.dumps([qa_db.id]),
        contradiction_flag=False,
        occurred_at=datetime.datetime.utcnow()
    )
    db.add(db_event)
    
    db.commit()
    db.refresh(qa_db)
    
    # 5. Write-back to Cognee as a memory event
    qa_cognee_payload = (
        f"Event ID: {qa_db.id}. Q&A Session: Question: {question}. "
        f"Answer: {answer}. Cited Event IDs: {', '.join(cited_event_ids)}."
    )
    try:
        import asyncio
        asyncio.create_task(cognee.remember(qa_cognee_payload))
        print(f"Q&A session scheduled for Cognee remember in background: ID={qa_db.id}")
    except Exception as e:
        print(f"Error scheduling Q&A Cognee write-back: {e}")
        
    return {
        "id": qa_db.id,
        "question": qa_db.question,
        "answer": qa_db.answer,
        "cited_event_ids": cited_event_ids,
        "question_type": question_type,
        "comparison_details": comparison_details,
        "created_at": qa_db.created_at
    }


@app.get("/qa/{qa_id}", response_model=AskResponse)
def get_qa_session(qa_id: str, db: Session = Depends(get_db)):
    qa = db.query(DBQASession).filter(DBQASession.id == qa_id).first()
    if not qa:
        raise HTTPException(status_code=404, detail="QA Session not found")
        
    cited_ids = []
    if qa.cited_memory_ids:
        try:
            cited_ids = json.loads(qa.cited_memory_ids)
        except:
            pass
            
    comparison_details = None
    if qa.question_type == "comparison":
        decision_event = db.query(DBEvent).filter(DBEvent.event_type == "decision").first()
        if not decision_event and cited_ids:
            decision_event = db.query(DBEvent).filter(DBEvent.id == cited_ids[0]).first()
            
        if decision_event:
            rejected_alts = []
            if decision_event.rejected_alternatives:
                try:
                    rejected_alts = json.loads(decision_event.rejected_alternatives)
                except:
                    pass
            preceding = db.query(DBEvent).filter(DBEvent.occurred_at < decision_event.occurred_at).all()
            env_event = next((e for e in preceding if "environment" in e.summary.lower() or "read env" in e.summary.lower() or "namespace" in e.summary.lower()), None)
            env_citations = [env_event.id] if env_event else []
            
            comparison_details = {
                "chosen": {
                    "name": decision_event.chosen_option or "Helm Chart deployment",
                    "confidence": decision_event.confidence or 0.9,
                    "citations": [decision_event.id] + env_citations
                },
                "rejected": [
                    {
                        "name": alt.get("name") if isinstance(alt, dict) else str(alt),
                        "confidence": alt.get("confidence", 0.4) if isinstance(alt, dict) else 0.4,
                        "rejection_reason": alt.get("rejection_reason", "Raw manifests lack native rollback triggers and parameterized environment values.") if isinstance(alt, dict) else str(alt),
                        "citations": [decision_event.id] + env_citations
                    } for alt in rejected_alts
                ]
            }
            
    return {
        "id": qa.id,
        "question": qa.question,
        "answer": qa.answer,
        "cited_event_ids": cited_ids,
        "question_type": qa.question_type or "general",
        "comparison_details": comparison_details,
        "created_at": qa.created_at
    }


@app.post("/forget/{memory_id}")
async def forget_memory(memory_id: str, db: Session = Depends(get_db)):
    event = db.query(DBEvent).filter(DBEvent.id == memory_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Memory not found in SQLite index")
    
    event.retracted = True
    db.commit()
    
    import uuid
    try:
        await cognee.forget(data_id=uuid.UUID(memory_id))
    except Exception as e:
        print(f"Error calling cognee.forget for memory {memory_id}: {e}")
        pass
        
    return {"status": "success", "memory_id": memory_id, "retracted": True}


# --- Branch & Replay endpoints ---
branch_replay_state = {
    "status": "idle",
    "original": None,
    "replayed": None
}

@app.get("/branch-replay/result")
def get_branch_replay_result():
    global branch_replay_state
    return branch_replay_state

@app.post("/branch-replay/run")
async def run_branch_replay(db: Session = Depends(get_db)):
    global branch_replay_state
    # 1. Reset timeline: delete any events after step 4 (keep steps 1 to 4)
    try:
        events = db.query(DBEvent).order_by(DBEvent.occurred_at.asc()).all()
        if len(events) > 4:
            for ev in events[4:]:
                db.delete(ev)
            db.commit()
    except Exception as e:
        print(f"Error resetting SQLite events for Branch & Replay: {e}")
        db.rollback()

    # 2. Restore Cognee databases directory from branch_snapshot to cognee_data
    import shutil
    src = os.path.abspath("./branch_snapshot")
    dst = os.path.abspath("./cognee_data")
    if os.path.exists(src):
        src_db = os.path.join(src, "databases")
        dst_db = os.path.join(dst, "databases")
        if os.path.exists(dst_db):
            try:
                for root, dirs, files in os.walk(src_db):
                    rel_path = os.path.relpath(root, src_db)
                    target_dir = os.path.join(dst_db, rel_path) if rel_path != "." else dst_db
                    os.makedirs(target_dir, exist_ok=True)
                    for f in files:
                        shutil.copy2(os.path.join(root, f), os.path.join(target_dir, f))
            except Exception as e:
                print(f"Error copying snapshot files: {e}")
        print("Cognee snapshot restored successfully.")

    # 3. Apply mutation: Remember the compliance policy in Cognee
    mutation_text = "Company policy requires raw kubectl manifests for all compliance-restricted namespaces, including prod-payment-v1."
    try:
        await cognee.remember(mutation_text)
    except Exception as e:
        print(f"Error saving mutated memory to Cognee: {e}")

    # 4. Replay decision step: Recall memories & call Groq LLM
    recall_context = ""
    try:
        from cognee.api.v1.search import SearchType
        results = await cognee.recall("deployment strategy for payments-service in namespace prod-payment-v1", query_type=SearchType.CHUNKS)
        context_chunks = []
        for r in results:
            text = getattr(r, "text", "") or str(r)
            context_chunks.append(text)
        recall_context = "\n".join(context_chunks)
    except Exception as e:
        print(f"Error recalling memories in Branch & Replay: {e}")

    chosen_option = "Raw kubectl manifests"
    rejection_reason = "Helm Chart deployment violates compliance policy requiring raw manifests in prod-payment-v1 namespace."
    decision_summary = "Decision: Choose raw kubectl manifests deployment over Helm Chart due to compliance requirements for namespace prod-payment-v1."
    confidence = 0.95

    try:
        client = openai.AsyncOpenAI(
            api_key=os.environ.get("GROQ_API_KEY"),
            base_url="https://api.groq.com/openai/v1"
        )
        prompt = (
            "You are an operations agent. Decide the deployment strategy for 'payments-service' in namespace 'prod-payment-v1'.\n"
            "Choices:\n"
            "1. Helm Chart deployment (efficient, standard template, allows rollback)\n"
            "2. Raw kubectl manifests (manual, compliant with restricted environment policies)\n\n"
            "Based on the following retrieved memories, make the decision. "
            "You MUST choose 'Raw kubectl manifests' if there is a company policy requiring it for namespace 'prod-payment-v1'.\n\n"
            f"Retrieved memories:\n{recall_context}\n\n"
            "Respond ONLY with a JSON object in this format:\n"
            "{\n"
            "  \"chosen_option\": \"chosen option name\",\n"
            "  \"confidence\": 0.95,\n"
            "  \"rejection_reason\": \"why the other option was rejected\",\n"
            "  \"decision_summary\": \"one-sentence summary of the decision\"\n"
            "}"
        )
        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": "You are a precise deployment agent decision engine."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0,
            response_format={"type": "json_object"}
        )
        res_json = json.loads(response.choices[0].message.content.strip())
        chosen_option = res_json.get("chosen_option", chosen_option)
        rejection_reason = res_json.get("rejection_reason", rejection_reason)
        decision_summary = res_json.get("decision_summary", decision_summary)
        confidence = res_json.get("confidence", confidence)
    except Exception as e:
        print(f"Error querying LLM for replayed decision: {e}")

    # 5. Write the replayed decision as a new event (Step 5) in SQLite
    replayed_event = DBEvent(
        agent_run_id="demo-agent-1-branch",
        event_type="decision",
        summary=decision_summary,
        confidence=confidence,
        chosen_option=chosen_option,
        rejected_alternatives=json.dumps([{
            "name": "Helm Chart deployment",
            "confidence": 0.35,
            "rejection_reason": rejection_reason
        }]),
        occurred_at=datetime.datetime.utcnow()
    )
    db.add(replayed_event)
    db.commit()
    db.refresh(replayed_event)

    branch_replay_state = {
        "status": "completed",
        "original": {
            "chosen_option": "Helm Chart deployment",
            "confidence": 0.85,
            "rejection_reason": "Manifests lack automated rollback and template variables, which violates the production deployment policy."
        },
        "replayed": {
            "chosen_option": chosen_option,
            "confidence": confidence,
            "rejection_reason": rejection_reason,
            "summary": decision_summary
        }
    }
    return branch_replay_state

@app.post("/timeline/reset")
async def reset_timeline(db: Session = Depends(get_db)):
    global branch_replay_state
    branch_replay_state = {
        "status": "idle",
        "original": None,
        "replayed": None
    }
    from backend.agent import run_agent
    try:
        await run_agent()
        return {"status": "success", "message": "Timeline reset to original 10 scripted events"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset timeline: {str(e)}")


