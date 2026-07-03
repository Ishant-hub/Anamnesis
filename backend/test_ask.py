import requests
import json
import sqlite3

def run_tests():
    # 1. Fetch event IDs from sqlite
    conn = sqlite3.connect("anamnesis.db")
    cursor = conn.cursor()
    cursor.execute("SELECT id, event_type, summary FROM events ORDER BY occurred_at ASC")
    events = cursor.fetchall()
    conn.close()

    print("Seeded Events:")
    decision_id = None
    error_id = None
    for e in events:
        print(f"[{e[1]}] ID: {e[0]} - Summary: {e[2]}")
        if e[1] == "decision":
            decision_id = e[0]
        if e[1] == "error":
            error_id = e[0]

    # 2. Test Ask General Question without ID
    print("\n--- Testing Ask General ---")
    res = requests.post("http://localhost:8000/ask", json={
        "question": "What caused the deployment to fail?"
    })
    print("Status:", res.status_code)
    print("Response:", json.dumps(res.json(), indent=2))

    # 3. Test Ask Comparison with ID (Step 5 decision)
    if decision_id:
        print(f"\n--- Testing Ask Comparison (ID: {decision_id}) ---")
        res = requests.post("http://localhost:8000/ask", json={
            "question": "Why did we choose Helm Chart?",
            "target_event_id": decision_id
        })
        print("Status:", res.status_code)
        print("Response:", json.dumps(res.json(), indent=2))

    # 4. Test Ask with target event ID (error event)
    if error_id:
        print(f"\n--- Testing Ask target event ID (ID: {error_id}) ---")
        res = requests.post("http://localhost:8000/ask", json={
            "question": "What error occurred here?",
            "target_event_id": error_id
        })
        print("Status:", res.status_code)
        print("Response:", json.dumps(res.json(), indent=2))

    # 5. Check if QA Session was stored in SQLite
    print("\n--- Checking qa_sessions table in SQLite ---")
    conn = sqlite3.connect("anamnesis.db")
    cursor = conn.cursor()
    cursor.execute("SELECT id, question, answer, cited_memory_ids, question_type FROM qa_sessions")
    qa_rows = cursor.fetchall()
    conn.close()
    for row in qa_rows:
        print(f"QA Session ID: {row[0]}")
        print(f"  Question: {row[1]}")
        print(f"  Answer: {row[2]}")
        print(f"  Cited Event IDs: {row[3]}")
        print(f"  Type: {row[4]}")
        print("-" * 40)

if __name__ == "__main__":
    run_tests()
