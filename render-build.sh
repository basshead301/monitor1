#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Starting Render Build Script ---"

# Install npm dependencies
echo "--- Running npm install ---"
npm install

# Set path for Playwright to install browsers and then install
echo "--- Setting PLAYWRIGHT_BROWSERS_PATH and installing Playwright browsers (Chromium) into ./pw-browsers ---"
export PLAYWRIGHT_BROWSERS_PATH=./pw-browsers
mkdir -p $PLAYWRIGHT_BROWSERS_PATH # Ensure the directory exists
npx playwright install chromium 

echo "--- Render Build Script Finished ---"