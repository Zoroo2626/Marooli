from flask import Flask, render_template, request, jsonify
import requests
import json
import re
import time
import os

app = Flask(__name__)

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "mistral"

# ─── FILE-BASED PERSISTENT HISTORY ───────────────────────
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "marooli_history.jsonl")
MAX_HISTORY = 50


def save_history_entry(entry):
    try:
        with open(HISTORY_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def load_history(limit=30):
    entries = []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    except FileNotFoundError:
        pass
    return entries[-limit:]


# ─── TYPED MEMORY SYSTEM ─────────────────────────────────
# Categories: decision, fact, preference, context
memory_store = {}
MAX_MEMORY = 8  # per type cap


def get_memory(session_id):
    if session_id not in memory_store:
        memory_store[session_id] = []
    return memory_store[session_id]


def add_to_memory(session_id, role, content, category="context"):
    mem = get_memory(session_id)
    entry = {
        "role": role,
        "text": content[:500],
        "category": category,
        "time": time.time()
    }
    mem.append(entry)
    # circular buffer — cap at MAX_MEMORY * 2
    if len(mem) > MAX_MEMORY * 2:
        memory_store[session_id] = mem[-(MAX_MEMORY * 2):]


def build_memory_context(session_id):
    mem = get_memory(session_id)
    if not mem:
        return ""
    # age-weighted: recent memories always included, older only if important
    now = time.time()
    relevant = []
    for m in mem[-(MAX_MEMORY * 2):]:
        age_minutes = (now - m.get("time", now)) / 60
        # always include recent (< 10 min) or decisions/facts
        if age_minutes < 10 or m.get("category") in ("decision", "fact"):
            relevant.append(m)
        elif len(relevant) < MAX_MEMORY:
            relevant.append(m)

    lines = []
    for m in relevant[-MAX_MEMORY * 2:]:
        prefix = "User" if m["role"] == "user" else "Marooli"
        lines.append(f"{prefix}: {m['text']}")
    return "Previous conversation:\n" + "\n".join(lines) + "\n\n"


# ─── SMART DETECTION ─────────────────────────────────────

CASUAL_PATTERNS = [
    r"^(hi|hey|hello|sup|yo|hola|greetings)\b",
    r"^(thanks|thank you|thx|ok|okay|cool|got it|nice|great|awesome|perfect|good)\b",
    r"^(do you|are you|will you)\b",
    r"^(yes|no|yeah|nah|yep|nope)\b",
]

FOLLOW_UP_PATTERNS = [
    r"(tell me more|expand|elaborate|go deeper|more detail)",
    r"(path\s*\d|option\s*\d|choice\s*\d|the\s*(first|second|third|last))",
    r"(what about|how about|and if|but what if)",
    r"(compare|which is better|pros and cons)",
    r"(why not|why is that|explain that)",
]

WEB_SEARCH_PATTERNS = [
    r"(search|look up|google|find out|search the web)",
    r"(latest|recent|current|today|2024|2025|2026|this year|right now)",
    r"(how much does|price of|cost of|salary|worth)",
    r"(who is|who was|who are)\s+\w+",
    r"(news about|what happened|trending)",
    r"(best\s+\w+\s+(in|for|to)|top\s+\d+)",
    r"(statistics|data|numbers|percentage|average)",
    r"(where can i|where to find|where is)",
    r"(is it true|fact check|real or fake)",
]

FACTUAL_PATTERNS = [
    r"^(what|who|where|when|why|how)\s+(is|are|was|were|do|does|did|can|could|would|should)\b",
    r"^(can you|could you|tell me|explain|define|describe)\b",
    r"\?$",
]


def classify_input(text, mode):
    lower = text.lower().strip()
    words = lower.split()

    # follow-up check first
    if any(re.search(p, lower) for p in FOLLOW_UP_PATTERNS):
        return "followup"

    # explicit web search request
    if any(re.search(p, lower) for p in WEB_SEARCH_PATTERNS):
        return "web"

    # casual — only if short
    if len(words) <= 8 and any(re.search(p, lower) for p in CASUAL_PATTERNS):
        return "casual"

    # factual questions that aren't goal-oriented
    if len(words) <= 15 and any(re.search(p, lower) for p in FACTUAL_PATTERNS):
        # if it sounds like a goal, treat as structured
        goal_words = {"become", "achieve", "build", "start", "create", "launch", "get", "make", "learn", "master"}
        if not any(w in lower for w in goal_words):
            return "casual"

    return "structured"


# ─── WEB SEARCH ──────────────────────────────────────────

def web_search(query, max_results=4):
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "body": r.get("body", ""),
                    "url": r.get("href", "")
                })
        return results
    except Exception as e:
        print(f"Web search error: {e}")
        return []


def format_search_context(results):
    if not results:
        return ""
    lines = ["Web search results:"]
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']}: {r['body']}")
    return "\n".join(lines) + "\n\n"


# ─── OLLAMA ──────────────────────────────────────────────

def query_ollama(prompt, timeout=120):
    payload = {"model": MODEL_NAME, "prompt": prompt, "stream": True}
    try:
        resp = requests.post(OLLAMA_URL, json=payload, stream=True, timeout=timeout)
        resp.raise_for_status()
        full_text = ""
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                chunk = json.loads(line)
                full_text += chunk.get("response", "")
                if chunk.get("done", False):
                    break
            except json.JSONDecodeError:
                continue
        return full_text.strip()
    except (requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.RequestException):
        return None


def clean_response(text):
    filler = [
        r"^(sure|of course|absolutely|great question|certainly|here you go)[!.,]*\s*",
        r"^(let me|i'd be happy to|i'll).*?[.!]\s*",
        r"^(based on the (web )?search results?,?\s*)",
    ]
    lines = text.split("\n")
    cleaned = []
    for i, line in enumerate(lines):
        skip = False
        if i < 2:
            for pattern in filler:
                if re.match(pattern, line.strip(), re.IGNORECASE):
                    skip = True
                    break
        if not skip:
            cleaned.append(line)
    result = "\n".join(cleaned).strip()
    return result if result else text


def sys_prefix():
    return (
        "You are Marooli, a sharp decision-intelligence engine. "
        "Rules: be direct, no generic advice, no motivational fluff, "
        "no filler phrases. Prioritize clarity over detail. "
        "Write like a smart analyst, not an AI chatbot. "
        "Never start with 'Sure!' or 'Great question!' or similar.\n\n"
    )


# ─── ROUTES ──────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/warmup", methods=["POST"])
def warmup():
    """Pre-warm Ollama model on page load."""
    try:
        requests.post(OLLAMA_URL, json={
            "model": MODEL_NAME, "prompt": "hi", "stream": False
        }, timeout=10)
        return jsonify({"status": "warm"})
    except Exception:
        return jsonify({"status": "cold"}), 503


@app.route("/api/history", methods=["GET"])
def get_history():
    entries = load_history(30)
    return jsonify({"history": entries})


@app.route("/api/reverse", methods=["POST"])
def reverse_path():
    data = request.get_json() or {}
    goal = data.get("goal", "").strip()
    mode = data.get("mode", "simple")
    session = data.get("session", "default")

    if not goal:
        return jsonify({"error": "Enter a goal first."}), 400

    add_to_memory(session, "user", goal, "decision")
    input_type = classify_input(goal, "reverse")
    memory_ctx = build_memory_context(session)

    # ─── CASUAL ───
    if input_type == "casual":
        prompt = (
            sys_prefix() + memory_ctx +
            f"The user said: {goal}\n"
            "Respond naturally in 1-2 sentences. Be warm but not cheesy.\nAnswer:"
        )
        result = query_ollama(prompt, timeout=60)
        if result is None:
            return jsonify({"error": "Can't reach Ollama."}), 503
        clean = clean_response(result)
        add_to_memory(session, "ai", clean, "context")
        return jsonify({"response": clean, "type": "chat"})

    # ─── FOLLOW-UP ───
    if input_type == "followup":
        prompt = (
            sys_prefix() + memory_ctx +
            f"The user is following up: {goal}\n"
            "Use the conversation history above to give a specific, relevant answer. "
            "Be concise, 2-4 sentences max. Reference specifics from earlier.\nAnswer:"
        )
        result = query_ollama(prompt, timeout=90)
        if result is None:
            return jsonify({"error": "Can't reach Ollama."}), 503
        clean = clean_response(result)
        add_to_memory(session, "ai", clean, "context")
        return jsonify({"response": clean, "type": "chat"})

    # ─── WEB-AUGMENTED ───
    if input_type == "web":
        search_results = web_search(goal)
        search_ctx = format_search_context(search_results)
        prompt = (
            sys_prefix() + memory_ctx + search_ctx +
            f"The user asked: {goal}\n"
            "Use the web search results above to give an accurate, current answer. "
            "Cite specific facts. 2-4 sentences. Be direct.\nAnswer:"
        )
        result = query_ollama(prompt, timeout=90)
        if result is None:
            return jsonify({"error": "Can't reach Ollama."}), 503
        clean = clean_response(result)
        add_to_memory(session, "ai", clean, "fact")
        sources = [{"title": r["title"], "url": r["url"]} for r in search_results[:3]]

        # persist to history
        save_history_entry({
            "mode": "reverse", "query": goal, "type": "web",
            "time": time.time(), "session": session
        })
        return jsonify({"response": clean, "type": "web", "sources": sources})

    # ─── STRUCTURED ───
    if mode == "detailed":
        prompt = (
            sys_prefix() + memory_ctx +
            f"Generate 3 to 5 realistic paths to achieve:\n{goal}\n\n"
            "EXACT FORMAT:\n\n"
            "Path Name: [2-3 word name]\n"
            "Steps:\n- [max 5 words]\n- [max 5 words]\n- [max 5 words]\n- [max 5 words]\n- [max 5 words, optional]\n"
            "Timeline: [specific duration]\nDifficulty: [Easy/Medium/Hard]\n"
            "Risks:\n- [max 8 words]\n- [max 8 words]\n\n"
            "CRITICAL: Each step MUST be 5 words or fewer. Path names MUST be 2-3 words. "
            "Each path must be genuinely different. No filler."
        )
    else:
        prompt = (
            sys_prefix() + memory_ctx +
            f"Generate exactly 3 realistic paths to achieve:\n{goal}\n\n"
            "STRICT FORMAT:\n\n"
            "Path Name: [2-3 word name]\n"
            "Steps:\n- [max 5 words]\n- [max 5 words]\n- [max 5 words]\n"
            "Timeline: [duration]\n"
            "Risks:\n- [max 8 words]\n\n"
            "CRITICAL: Each step MUST be 5 words or fewer. Path names MUST be 2-3 words. "
            "No intros, no conclusions."
        )

    result = query_ollama(prompt)
    if result is None:
        return jsonify({"error": "Can't reach Ollama."}), 503
    clean = clean_response(result)
    add_to_memory(session, "ai", f"[Provided {mode} paths for: {goal}]", "decision")

    # persist to file history
    save_history_entry({
        "mode": "reverse", "query": goal, "type": "structured",
        "time": time.time(), "session": session
    })
    return jsonify({"response": clean, "type": "structured"})


@app.route("/api/simulate", methods=["POST"])
def simulate_future():
    data = request.get_json() or {}
    decision = data.get("decision", "").strip()
    mode = data.get("mode", "simple")
    session = data.get("session", "default")

    if not decision:
        return jsonify({"error": "Enter a decision first."}), 400

    add_to_memory(session, "user", decision, "decision")
    input_type = classify_input(decision, "simulate")
    memory_ctx = build_memory_context(session)

    if input_type == "casual":
        prompt = (
            sys_prefix() + memory_ctx +
            f"The user said: {decision}\n"
            "Respond naturally in 1-2 sentences.\nAnswer:"
        )
        result = query_ollama(prompt, timeout=60)
        if result is None:
            return jsonify({"error": "Can't reach Ollama."}), 503
        clean = clean_response(result)
        add_to_memory(session, "ai", clean, "context")
        return jsonify({"response": clean, "type": "chat"})

    if input_type == "followup":
        prompt = (
            sys_prefix() + memory_ctx +
            f"The user is following up: {decision}\n"
            "Reference the conversation above. Be specific. 2-4 sentences.\nAnswer:"
        )
        result = query_ollama(prompt, timeout=90)
        if result is None:
            return jsonify({"error": "Can't reach Ollama."}), 503
        clean = clean_response(result)
        add_to_memory(session, "ai", clean, "context")
        return jsonify({"response": clean, "type": "chat"})

    if input_type == "web":
        search_results = web_search(decision)
        search_ctx = format_search_context(search_results)
        prompt = (
            sys_prefix() + memory_ctx + search_ctx +
            f"The user asked: {decision}\n"
            "Use the web results. Be accurate. 2-4 sentences.\nAnswer:"
        )
        result = query_ollama(prompt, timeout=90)
        if result is None:
            return jsonify({"error": "Can't reach Ollama."}), 503
        clean = clean_response(result)
        add_to_memory(session, "ai", clean, "fact")
        sources = [{"title": r["title"], "url": r["url"]} for r in search_results[:3]]
        save_history_entry({
            "mode": "simulate", "query": decision, "type": "web",
            "time": time.time(), "session": session
        })
        return jsonify({"response": clean, "type": "web", "sources": sources})

    if mode == "detailed":
        prompt = (
            sys_prefix() + memory_ctx +
            f"Simulate realistic outcomes for:\n{decision}\n\n"
            "EXACT FORMAT:\n\n"
            "1 Year Outcome:\n[2-3 sentences]\n\n"
            "5 Year Outcome:\n[2-3 sentences]\n\n"
            "10 Year Outcome:\n[2-3 sentences]\n\n"
            "Risks:\n- [risk]\n- [risk]\n- [risk]\n\n"
            "Regret Analysis:\n[2-3 sentences]\n\n"
            "Be brutally honest. No optimism bias."
        )
    else:
        prompt = (
            sys_prefix() + memory_ctx +
            f"Simulate outcomes for:\n{decision}\n\n"
            "STRICT FORMAT:\n\n"
            "1 Year Outcome:\n[1-2 sentences]\n\n"
            "5 Year Outcome:\n[1-2 sentences]\n\n"
            "10 Year Outcome:\n[1-2 sentences]\n\n"
            "Risks:\n- [1 sentence]\n- [1 sentence]\n\n"
            "Regret Analysis:\n[1 sentence]\n\n"
            "Be direct. No filler."
        )

    result = query_ollama(prompt)
    if result is None:
        return jsonify({"error": "Can't reach Ollama."}), 503
    clean = clean_response(result)
    add_to_memory(session, "ai", f"[Simulated outcomes for: {decision}]", "decision")
    save_history_entry({
        "mode": "simulate", "query": decision, "type": "structured",
        "time": time.time(), "session": session
    })
    return jsonify({"response": clean, "type": "structured"})


if __name__ == "__main__":
    print("\n  Marooli — Decision Intelligence Engine")
    print("  http://localhost:5000\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
