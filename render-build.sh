#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Starting Render Build Script ---"

# Install npm dependencies
echo "--- Running npm install ---"
npm install

# Set path for Playwright to install browsers and then install
echo "--- Setting PLAYWRIGHT_BROWSERS_PATH and installing Playwright browsers (Chromium) into ./pw-browsers ---"
export PLAYWRIGHT_BROWSERS_PATH=$(pwd)/pw-browsers # Use absolute path during build
mkdir -p $PLAYWRIGHT_BROWSERS_PATH # Ensure the directory exists
npx playwright install chromium

echo "--- Listing contents of $PLAYWRIGHT_BROWSERS_PATH to verify installation ---"
ls -la $PLAYWRIGHT_BROWSERS_PATH

# Try to find the specific chromium directory created by Playwright (the number might change)
CHROME_DIR=$(find $PLAYWRIGHT_BROWSERS_PATH -type d -name "chromium-*" -print -quit)
if [ -n "$CHROME_DIR" ]; then
  echo "--- Listing contents of Playwright Chromium directory: $CHROME_DIR ---"
  ls -la "$CHROME_DIR"
  echo "--- Listing contents of $CHROME_DIR/chrome-linux/ ---"
  ls -la "$CHROME_DIR/chrome-linux/"
else
  echo "--- Playwright Chromium directory (chromium-*) not found in $PLAYWRIGHT_BROWSERS_PATH ---"
fi

echo "--- Render Build Script Finished ---"