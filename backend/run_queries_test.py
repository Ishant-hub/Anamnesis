import requests
import json

def main():
    questions = [
        "Why did step 6 fail?",
        "Why did step 8 happen?",
        "What caused the deployment to fail?"
    ]
    for q in questions:
        print(f"=== QUESTION: {q} ===")
        res = requests.post("http://127.0.0.1:8000/ask", json={"question": q})
        print(f"Status: {res.status_code}")
        print(json.dumps(res.json(), indent=2))
        print("-" * 50)

if __name__ == "__main__":
    main()
