#!/bin/bash

# Exit on any error
set -e

echo "Starting release build..."

# Install dependencies if needed
echo "Installing dependencies..."
npm install

# Build the release version using Tauri
echo "Building Tauri release..."
npm run tauri build

echo "Build complete! You can find the release artifacts in src-tauri/target/release/bundle/"
open src-tauri/target/release/bundle/dmg