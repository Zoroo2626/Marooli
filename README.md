# Marooli

A local AI decision intelligence engine that runs entirely on your machine. No cloud, no subscriptions, just you and a smart reasoning tool.

Marooli has two modes. **Reverse Path Finder** takes a goal and maps out realistic paths to get there. **Future Outcome Simulator** takes a decision and shows you what could happen in 1, 5, and 10 years. It also handles casual conversation and remembers what you talked about.

Everything runs through Ollama with the Mistral model so nothing leaves your computer.

![screenshot](https://img.shields.io/badge/status-working-brightgreen) ![python](https://img.shields.io/badge/python-3.8+-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## What it does

It gives you structured, visual decision analysis. You type a goal like "become a software engineer" and it generates multiple paths with steps, timelines, and risks. You can view everything as a full screen flowchart too.

It also knows when to search the web for factual questions, when to have a casual chat, and when to give you structured analysis. The memory system keeps track of your conversation so follow up questions actually work.

## Setup

You need Python 3.8+ and Ollama installed on your machine.

1. Install Ollama from [ollama.com](https://ollama.com) and pull the Mistral model

```
ollama pull mistral
```

2. Clone this repo and install dependencies

```
git clone https://github.com/ZoroXCode/Marooli.git
cd Marooli
pip install flask requests duckduckgo-search
```

3. Make sure Ollama is running, then start the app

```
ollama serve
python app.py
```

4. Open `http://localhost:5000` in your browser

## Features

**Decision Intelligence** with two analysis modes plus casual conversation

**Visual Flowcharts** rendered on a full screen canvas

**Conversation Memory** that persists across messages and knows when to reference earlier context

**Web Search** for factual and current questions

**Guided Walkthrough** for first time users

**Keyboard Shortcuts** like Enter to send, Esc to go back, / to focus search

## Tech

Python, Flask, vanilla JavaScript, HTML/CSS canvas. No frameworks, no npm, no build step. AI runs through Ollama locally.

## License

MIT License. See [LICENSE](LICENSE) for details.
