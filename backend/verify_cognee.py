import os
import asyncio
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

from backend.db import SessionLocal, DBEvent

# Configure Cognee for Groq + Fastembed
os.environ["SYSTEM_ROOT_DIRECTORY"] = os.path.abspath("./cognee_data")
os.environ["LLM_PROVIDER"] = "custom"
os.environ["LLM_ENDPOINT"] = "https://api.groq.com/openai/v1"
os.environ["LLM_API_KEY"] = os.environ.get("GROQ_API_KEY", "")
os.environ["LLM_MODEL"] = "openai/llama-3.1-8b-instant"

os.environ["EMBEDDING_PROVIDER"] = "fastembed"
os.environ["EMBEDDING_MODEL"] = "BAAI/bge-small-en-v1.5"

import cognee

async def verify():
    print("=== Verification Start ===")
    
    # 1. Check SQLite events
    db = SessionLocal()
    events = db.query(DBEvent).order_by(DBEvent.occurred_at.asc()).all()
    print(f"Total events in SQLite: {len(events)}")
    for e in events:
        print(f"- [{e.event_type}] {e.summary[:60]}... (Contradiction: {e.contradiction_flag})")
    
    if len(events) != 10:
        print("ERROR: Expected exactly 10 events in SQLite.")
    else:
        print("SUCCESS: 10 events verified in SQLite.")
        
    # 2. Check branch_snapshot directory
    if os.path.exists("./branch_snapshot"):
        print("SUCCESS: branch_snapshot directory exists.")
    else:
        print("ERROR: branch_snapshot directory not found.")
        
    # 3. Recall from Cognee live data
    print("\nRecalling from Cognee memory...")
    try:
        q1 = "What is the namespace for payments-service?"
        print(f"Query 1: '{q1}'")
        res1 = await cognee.recall(q1)
        print("Result 1:")
        for r in res1:
            print(f" - {r}")
            
        q2 = "Why was raw kubectl manifests rejected?"
        print(f"Query 2: '{q2}'")
        res2 = await cognee.recall(q2)
        print("Result 2:")
        for r in res2:
            print(f" - {r}")
            
    except Exception as e:
        print(f"ERROR querying Cognee: {e}")
        
    db.close()
    print("=== Verification End ===")

if __name__ == "__main__":
    asyncio.run(verify())
