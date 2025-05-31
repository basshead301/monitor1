#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Starting Render Build Script ---"

# Install npm dependencies
echo "--- Running npm install ---"
npm install

# Install Playwright browsers into a local directory
echo "--- Installing Playwright browsers (Chromium) into ./pw-browsers ---"
npx playwright install --path ./pw-browsers chromium

echo "--- Render Build Script Finished ---"