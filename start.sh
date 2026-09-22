#!/bin/bash
# Starts the Alrayhan Perfumes local server.
cd "$(dirname "$0")/server"

if [ ! -d "node_modules" ]; then
  echo "Installing server dependencies (first run only)..."
  npm install
fi

echo "Starting Alrayhan Perfumes server..."
npm start
