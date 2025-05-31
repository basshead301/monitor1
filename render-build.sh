 #!/usr/bin/env bash
    # exit on error
    set -o errexit

    echo "--- Starting Render Build Script ---"

    # Install npm dependencies
    echo "--- Running npm install ---"
    npm install

    # Install Playwright browsers
    # We'll try without --with-deps first, as Render's environment might have them.
    # If this fails, the next thing to try in this script is: npx playwright install --with-deps chromium
    echo "--- Installing Playwright browsers (Chromium) ---"
    npx playwright install chromium

    echo "--- Render Build Script Finished ---"