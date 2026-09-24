#!/usr/bin/env bash
# Installs Ollama and downloads the model Light uses. Safe to run again.
set -e
MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
if ! command -v ollama >/dev/null 2>&1; then
  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi
bash "$(dirname "$0")/start-ollama.sh"
echo "Downloading $MODEL (first time only)..."
ollama pull "$MODEL"
( cd "$(dirname "$0")/../server" && [ -d node_modules ] || npm install --silent )
echo "Ollama ready with $MODEL."
