#!/usr/bin/env bash
# Starts Ollama in the background if it isn't already running.
command -v ollama >/dev/null 2>&1 || { echo "Ollama not installed — run: bash .devcontainer/setup-ollama.sh"; exit 0; }
if ! curl -s -o /dev/null http://localhost:11434/api/tags; then
  nohup ollama serve > /tmp/ollama.log 2>&1 &
  for i in $(seq 1 20); do curl -s -o /dev/null http://localhost:11434/api/tags && break; sleep 1; done
fi
echo "Ollama is running."
