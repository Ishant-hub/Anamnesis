import os
import asyncio
import datetime
import shutil
import json
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

from sqlalchemy.orm import Session
from backend.db import SessionLocal, DBEvent, init_db
import cognee

# Define the scripted events
SCRIPTED_EVENTS = [
    {
        "event_type": "user_prompt",
        "summary": "User requests deployment of 'payments-service' to production.",
        "confidence": 1.0,
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
    },
    {
        "event_type": "memory_read",
        "summary": "Read environment settings for production: environment variables and region config.",
        "confidence": 0.95,
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=9)
    },
    {
        "event_type": "memory_write",
        "summary": "Record that the target Kubernetes namespace for payments-service is 'prod-payment-v1'.",
        "confidence": 0.9,
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=8)
    },
    {
        "event_type": "memory_read",
        "summary": "Retrieve deployment strategy options for payments-service.",
        "confidence": 0.95,
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=7)
    },
    {
        "event_type": "decision",
        "summary": "Decision: Choose Helm Chart deployment over raw kubectl manifests.",
        "confidence": 0.85,
        "chosen_option": "Helm Chart deployment",
        "rejected_alternatives": [
            {
                "name": "Raw kubectl manifests",
                "confidence": 0.4,
                "rejection_reason": "Manifests lack automated rollback and template variables, which violates the production deployment policy.",
                "citing_memory_ids": ["mem-prod-policy-09"]
            }
        ],
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=6)
    },
    # Note: Event 5 is the branch point. Immediately after writing Event 5, we snapshot the Cognee directory.
    {
        "event_type": "memory_write",
        "summary": "Overwrite namespace configuration: cluster configuration overridden. Target namespace is 'prod-payment-v2'.",
        "confidence": 1.0,
        "contradiction_flag": True,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=5)
    },
    {
        "event_type": "tool_call",
        "summary": "Execute Helm upgrade command for payments-service in namespace 'prod-payment-v2'.",
        "confidence": 0.9,
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=4)
    },
    {
        "event_type": "error",
        "summary": "Database connection failed during post-deployment health check: payments-db connection timeout.",
        "confidence": 1.0,
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=3)
    },
    {
        "event_type": "api_response",
        "summary": "Received replica status from Kubernetes cluster: 0 out of 3 replicas running.",
        "confidence": 0.95,
        "contradiction_flag": False,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=2)
    },
    {
        "event_type": "final_output",
        "summary": "Deployment failed due to database connection timeout. Initiated automatic Helm rollback.",
        "confidence": 1.0,
        "contradiction_flag": True,
        "occurred_at": datetime.datetime.utcnow() - datetime.timedelta(minutes=1)
    }
]

async def check_contradiction(db: Session, new_summary: str) -> bool:
    # Query all previous summaries from DB
    prev_events = db.query(DBEvent).order_by(DBEvent.occurred_at.asc()).all()
    previous_summaries = [e.summary for e in prev_events]
    
    if not previous_summaries:
        return False
        
    try:
        import openai
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
        print(f"Error checking contradiction: {e}")
        # Simple fallback heuristic: if new event contains "prod-payment-v2" and old contains "prod-payment-v1", it's a contradiction.
        if "prod-payment-v2" in new_summary.lower() and any("prod-payment-v1" in s.lower() for s in previous_summaries):
            return True
        return False

async def run_agent():
    print("Initializing SQLite databases...")
    init_db()
    
    # Prune existing Cognee data for a clean slate
    print("Pruning Cognee data for clean slate...")
    try:
        await cognee.prune.prune_data()
        await cognee.prune.prune_system(metadata=True)
    except Exception as e:
        print(f"Error pruning Cognee: {e}")

    # Remove existing SQLite DB file and reinitialize to clear timeline history
    db_file = "./anamnesis.db"
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
        except Exception as e:
            print(f"Could not remove SQLite file, wiping tables instead: {e}")
            try:
                import sqlite3
                conn = sqlite3.connect(db_file)
                cursor = conn.cursor()
                cursor.execute("DELETE FROM events;")
                cursor.execute("DELETE FROM qa_sessions;")
                conn.commit()
                conn.close()
                print("SQLite tables wiped successfully.")
            except Exception as ex:
                print(f"Error wiping tables: {ex}")
    
    init_db()
    db = SessionLocal()

    # Clear previous snapshot directory
    if os.path.exists("./branch_snapshot"):
        shutil.rmtree("./branch_snapshot")

    print("Running scripted agent events...")
    for idx, event_data in enumerate(SCRIPTED_EVENTS):
        step_num = idx + 1
        print(f"\n--- STEP {step_num}: {event_data['event_type']} ---")
        
        # Use contradiction_flag from SCRIPTED_EVENTS
        contradiction = event_data["contradiction_flag"]
        
        # Write to SQLite event index
        db_event = DBEvent(
            event_type=event_data["event_type"],
            summary=event_data["summary"],
            confidence=event_data["confidence"],
            chosen_option=event_data.get("chosen_option"),
            rejected_alternatives=json.dumps(event_data.get("rejected_alternatives", [])),
            contradiction_flag=contradiction,
            occurred_at=event_data["occurred_at"]
        )
        db.add(db_event)
        db.commit()
        db.refresh(db_event)
        print(f"Recorded in SQLite Event Index: ID={db_event.id}, Contradiction={db_event.contradiction_flag}")

        # Send event text to Cognee.remember
        cognee_payload = f"Event ID: {db_event.id}. Event type: {event_data['event_type']}. Summary: {event_data['summary']}."
        if event_data.get("chosen_option"):
            cognee_payload += f" Chosen Option: {event_data['chosen_option']}."
        if event_data.get("rejected_alternatives"):
            for alt in event_data["rejected_alternatives"]:
                cognee_payload += f" Rejected Alternative: {alt['name']} (Reason: {alt['rejection_reason']})."

        print(f"Sending to Cognee.remember: {cognee_payload}")
        await cognee.remember(cognee_payload)

        # Snapshot the Cognee directory right after Event 5 (the branch point)
        if step_num == 5:
            # We run cognee.improve() before snapshotting to ensure Cognee processes the remembered memories
            print("Improving memories up to step 5...")
            await cognee.improve()
            print("Taking branch snapshot of Cognee directory...")
            
            # Wait a brief moment to ensure write buffer flush
            await asyncio.sleep(1.0)
            shutil.copytree("./cognee_data", "./branch_snapshot")
            print("Cognee snapshot saved to `./branch_snapshot` folder successfully.")

    # Call improve at the end of the run for the remaining events
    print("\nImproving final Cognee state...")
    await cognee.improve()
    
    db.close()
    print("Scripted agent run completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_agent())
