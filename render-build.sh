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

echo "--- [DEBUG] Listing contents of $PLAYWRIGHT_BROWSERS_PATH to verify installation ---"
ls -la $PLAYWRIGHT_BROWSERS_PATH

# Try to find the specific chromium directory created by Playwright (the number might change)
CHROME_DIR_NAME=$(find $PLAYWRIGHT_BROWSERS_PATH -maxdepth 1 -type d -name "chromium-*" -printf "%f\n" -quit)

if [ -n "$CHROME_DIR_NAME" ]; then
  CHROME_FULL_PATH="$PLAYWRIGHT_BROWSERS_PATH/$CHROME_DIR_NAME"
  echo "--- [DEBUG] Found Playwright Chromium directory name: $CHROME_DIR_NAME ---"
  echo "--- [DEBUG] Listing contents of Playwright Chromium directory: $CHROME_FULL_PATH ---"
  ls -la "$CHROME_FULL_PATH"
  
  CHROME_LINUX_PATH="$CHROME_FULL_PATH/chrome-linux"
  if [ -d "$CHROME_LINUX_PATH" ]; then
    echo "--- [DEBUG] Listing contents of $CHROME_LINUX_PATH/ ---"
    ls -la "$CHROME_LINUX_PATH/"
    
    echo "--- [DEBUG] Checking for headless_shell or chrome executable in $CHROME_LINUX_PATH/ ---"
    if [ -f "$CHROME_LINUX_PATH/headless_shell" ]; then
        echo "--- [DEBUG] Found headless_shell ---"
    elif [ -f "$CHROME_LINUX_PATH/chrome" ]; then
        echo "--- [DEBUG] Found chrome ---"
    else
        echo "--- [DEBUG] Neither headless_shell nor chrome found in $CHROME_LINUX_PATH ---"
    fi
  else
    echo "--- [DEBUG] $CHROME_LINUX_PATH directory not found. ---"
  fi
else
  echo "--- [DEBUG] Playwright Chromium directory (chromium-*) not found in $PLAYWRIGHT_BROWSERS_PATH ---"
fi

echo "--- Render Build Script Finished ---"