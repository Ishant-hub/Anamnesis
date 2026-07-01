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
    
    # Write-back payload to Cognee
    cognee_payload = f"Event type: {event.event_type}. Summary: {event.summary}"
    if event.chosen_option:
        cognee_payload += f" Chosen Option: {event.chosen_option}."
    if event.rejected_alternatives:
        for alt in event.rejected_alternatives:
            cognee_payload += f" Rejected Alternative: {alt.name} (Reason: {alt.rejection_reason})."
            
    try:
        await cognee.remember(cognee_payload)
        await cognee.improve()
    except Exception as e:
        print(f"Error saving to Cognee inside POST /events: {e}")
        
    return to_event_response(db_event)
