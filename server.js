// server.js - Backend for PO Monitor Website
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { chromium } = require('playwright'); // Playwright for browser automation
const nodemailer = require('nodemailer'); // Nodemailer for sending emails
const path = require('path'); // For potential path manipulations if needed for resources
const fs = require('fs'); // For file system checks (e.g., browserExecutablePath)

const app = express();
const port = 3000;

// --- Global State (simplified for this example) ---
let monitorActive = false;
let monitorIntervalId = null;
let currentMonitorParams = {};
let httpServer;
let wsServer;
let clients = new Set(); // To keep track of connected WebSocket clients

// --- Middleware ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies

// --- Static File Serving ---
// Serve files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public'))); 

// --- Helper function to broadcast messages to all WebSocket clients ---
function broadcast(data) {
    const jsonData = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

// --- WebSocket Setup ---
httpServer = http.createServer(app); // Corrected declaration
wsServer = new WebSocket.Server({ server: httpServer }); // Corrected declaration, new name

wsServer.on('connection', (ws) => {
    console.log('Client connected via WebSocket');
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'system', message: 'Connection to backend established.' }));
    ws.on('close', () => { clients.delete(ws); console.log('Client disconnected'); });
    ws.on('error', (error) => { console.error('WebSocket client error:', error); clients.delete(ws); });
});

// --- Realtime PO Monitor Logic (Integrated from realtime-po-monitor.js) ---

// Configuration Constants from realtime-po-monitor.js
const LOGIN_URL = 'https://apex.capstonelogistics.com/';
const USERNAME_SELECTOR = '#Username';
const PASSWORD_SELECTOR = '#Password';
const LOGIN_BUTTON_SELECTOR = 'input[type="submit"][value="Log in"]';
const SITE_DROPDOWN_SELECTOR = 'select#ddlSites';
const TOKEN_IN_OUTGOING_REQUEST_URL_CONTAINS = 'siteadminsso.capstonelogistics.com/api/user/byusername/';
const API_BASE_URL_PO_SITE = 'https://siteadminsso.capstonelogistics.com/api'; // Renamed to avoid conflict

// State Variables from realtime-po-monitor.js
let pwBrowser = null; // Renamed from 'browser' to avoid conflict with module-level vars
let pwContext = null;
let pwPage = null;
let bearerToken = null;
let alreadyAlertedPOs = new Set();
let isMonitoringActive = false; // This was already in server.js, is the primary state
let siteSelected = false;

// Logging function for monitor logic to use (will call broadcast)
function monitorLog(message, type = 'info') {
    console.log(`[PO Monitor Logic][${type.toUpperCase()}] ${message}`);
    let broadcastType = type;
    if (type === 'monitor-alert-po-detail' || type === 'monitor-alert-email-sent' || 
        type === 'monitor-display-system' || type === 'monitor-display-info' || type === 'error') {
        broadcastType = type; // Use specific types for frontend styling
    } else {
        broadcastType = 'monitor-display-info'; // Default to info for general messages from logic
    }
    broadcast({ type: broadcastType, message: message });
}

async function sendEmailNotification(emailConfig, subject, body) {
    if (!emailConfig || !emailConfig.recipientEmail || !emailConfig.senderUser || !emailConfig.senderPass) {
        monitorLog('Email notification skipped: Email configuration incomplete.', 'warn');
        return;
    }
    const { recipientEmail, senderService, senderUser, senderPass, smtpHost, smtpPort, smtpSecure } = emailConfig;
    let transporterOptions;
    if (senderService && senderService.toLowerCase() === 'gmail') {
        transporterOptions = { service: 'gmail', auth: { user: senderUser, pass: senderPass } };
    } else if (smtpHost) {
        transporterOptions = { host: smtpHost, port: smtpPort || 587, secure: smtpSecure !== undefined ? smtpSecure : (smtpPort === 465), auth: { user: senderUser, pass: senderPass } };
    } else {
        monitorLog('Email sender service or SMTP host not specified.', 'error');
        return;
    }
    try {
        let transporter = nodemailer.createTransport(transporterOptions);
        await transporter.sendMail({
            from: `"PO Monitor" <${senderUser}>`,
            to: recipientEmail,
            subject: subject,
            text: body,
            html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
        });
        monitorLog(`Email notification sent: ${subject}`, 'monitor-alert-email-sent');
    } catch (error) {
        monitorLog(`Failed to send email: ${error.message}`, 'error');
    }
}

function formatDateForAPI_PO_Monitor(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        monitorLog(`Invalid date format for API: "${dateStr}". Expected YYYY-MM-DD.`, 'warn');
        return "INVALID-DATE";
    }
    const [year, month, day] = dateStr.split('-');
    return `${month}-${day}-${year}`;
}

async function ensureBrowserAndLogin(params) {
    if (pwPage && !pwPage.isClosed() && pwContext && pwBrowser && pwBrowser.isConnected() && bearerToken) {
        monitorLog('Using existing browser session and token.', 'debug');
        return true;
    }
    monitorLog('Setting up new browser session or re-logging in.', 'monitor-display-info');
    siteSelected = false;

    if (pwPage && !pwPage.isClosed()) await pwPage.close().catch(e => monitorLog(`Error closing old page: ${e.message}`, 'warn'));
    if (pwContext) await pwContext.close().catch(e => monitorLog(`Error closing old context: ${e.message}`, 'warn'));
    if (pwBrowser && pwBrowser.isConnected()) await pwBrowser.close().catch(e => monitorLog(`Error closing old browser: ${e.message}`, 'warn'));
    pwBrowser = null; pwContext = null; pwPage = null; bearerToken = null;

    try {
        let launchOptions = {
            headless: true,
            slowMo: 50,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Common args for CI/PaaS
        };

        const pwBrowsersDir = path.join(__dirname, 'pw-browsers');
        if (fs.existsSync(pwBrowsersDir)) {
            const items = fs.readdirSync(pwBrowsersDir);
            // Find the main chromium directory (e.g., chromium-1169, not chromium_headless_shell-xxxx)
            const chromeDirName = items.find(item => item.startsWith('chromium-') && !item.startsWith('chromium_headless_shell-'));

            if (chromeDirName) {
                const potentialExePath = path.join(pwBrowsersDir, chromeDirName, 'chrome-linux', 'chrome');
                if (fs.existsSync(potentialExePath)) {
                    launchOptions.executablePath = potentialExePath;
                    monitorLog(`Using executablePath: ${potentialExePath}`, 'debug');
                } else {
                    monitorLog(`Chromium executable not found at: ${potentialExePath}. Will try default Playwright resolution.`, 'warn');
                }
            } else {
                monitorLog(`Chromium directory (e.g., chromium-xxxx) not found in ${pwBrowsersDir}. Will try default Playwright resolution.`, 'warn');
            }
        } else {
            monitorLog(`pw-browsers directory not found at ${pwBrowsersDir}. Will try default Playwright resolution.`, 'warn');
        }
        
        monitorLog('Launching Playwright browser with options: ' + JSON.stringify(launchOptions), 'debug');
        pwBrowser = await chromium.launch(launchOptions);
        pwBrowser.on('disconnected', () => {
            monitorLog('Playwright browser disconnected event fired.', 'warn');
            isMonitoringActive = false; // Stop monitoring if browser crashes
            if (monitorIntervalId) clearInterval(monitorIntervalId);
            pwBrowser = null; pwContext = null; pwPage = null; bearerToken = null; siteSelected = false;
        });

        pwContext = await pwBrowser.newContext();
        pwPage = await pwContext.newPage();
        
        const { username, password } = params;
        if (!username || !password) throw new Error("Username or password not provided.");

        const tokenPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout capturing token.')), 60000);
            const requestListener = request => {
                if (request.url().includes(TOKEN_IN_OUTGOING_REQUEST_URL_CONTAINS)) {
                    const auth = request.headers()['authorization'];
                    if (auth && auth.toLowerCase().startsWith('bearer ')) {
                        clearTimeout(timeout);
                        if (pwPage && !pwPage.isClosed()) pwPage.off('request', requestListener); 
                        resolve(auth.substring(7));
                    }
                }
            };
            pwPage.on('request', requestListener);
        });

        monitorLog(`Navigating to login page: ${LOGIN_URL}`, 'debug');
        await pwPage.goto(LOGIN_URL, { waitUntil: 'load', timeout: 60000 });
        await pwPage.waitForSelector(USERNAME_SELECTOR, { state: 'visible', timeout: 15000 });
        await pwPage.fill(USERNAME_SELECTOR, username);
        await pwPage.fill(PASSWORD_SELECTOR, password);
        monitorLog('Submitting login form...', 'debug');
        await pwPage.click(LOGIN_BUTTON_SELECTOR);
        bearerToken = await tokenPromise;

        if (!bearerToken) throw new Error('Bearer token not captured.');
        monitorLog('Login and token capture successful.', 'monitor-display-info');
        return true;
    } catch (error) {
        monitorLog(`Login failed: ${error.message}`, 'error');
        if (pwPage && !pwPage.isClosed()) await pwPage.close().catch(e => monitorLog(`Error closing page post-fail: ${e.message}`, 'warn'));
        if (pwContext) await pwContext.close().catch(e => monitorLog(`Error closing context post-fail: ${e.message}`, 'warn'));
        if (pwBrowser && pwBrowser.isConnected()) await pwBrowser.close().catch(e => monitorLog(`Error closing browser post-fail: ${e.message}`, 'warn'));
        pwBrowser = null; pwContext = null; pwPage = null; bearerToken = null;
        return false;
    }
}

async function performSingleCheck(params) {
    monitorLog('Performing a single check for problematic POs...', 'monitor-display-info');
    const loginSuccess = await ensureBrowserAndLogin(params);
    if (!loginSuccess || !pwPage || !bearerToken) {
        monitorLog('Cannot perform check due to login/browser issues. Will retry next cycle if monitor active.', 'error');
        return;
    }

    const { siteType, startDate, endDate, emailConfig } = params;
    const TARGET_SITE_LABEL = siteType === 'dry' ? '206 - ADUSA DC7 GREENCASTLE PA DRY (86)' : '206 - ADUSA DC7 GREENCASTLE PA PER (85)';
    const SUBDEPT_ID = siteType === 'dry' ? 86 : 85;

    const formattedStartDate = formatDateForAPI_PO_Monitor(startDate);
    const formattedEndDate = formatDateForAPI_PO_Monitor(endDate);
    if (formattedStartDate === "INVALID-DATE" || formattedEndDate === "INVALID-DATE") {
        monitorLog("Invalid date format for API call. Check skipped.", "error");
        return;
    }

    try {
        if (!siteSelected) {
            monitorLog(`Waiting for site dropdown: ${SITE_DROPDOWN_SELECTOR}`, 'debug');
            await pwPage.waitForSelector(SITE_DROPDOWN_SELECTOR, { state: 'visible', timeout: 30000 });
            monitorLog(`Selecting site: "${TARGET_SITE_LABEL}"`, 'debug');
            await pwPage.selectOption(SITE_DROPDOWN_SELECTOR, { label: TARGET_SITE_LABEL });
            await pwPage.waitForTimeout(5000); // Wait for potential page updates
            siteSelected = true;
            monitorLog(`Site selected: "${TARGET_SITE_LABEL}"`, 'monitor-display-info');
        } else {
            monitorLog('Site already selected in this session.', 'debug');
        }

        const headers = { 'Authorization': `Bearer ${bearerToken}`, 'Content-Type': 'application/json' };
        const poDetailsUrl = `${API_BASE_URL_PO_SITE}/subdept/${SUBDEPT_ID}/pos/${formattedStartDate}/${formattedEndDate}`;
        const ancillaryUrl = `${API_BASE_URL_PO_SITE}/subdept/${SUBDEPT_ID}/ancillaryItems/${formattedStartDate}/${formattedEndDate}`;

        monitorLog(`Fetching PO Details & Ancillary data...`, 'debug');

        const [poRes, ancRes] = await Promise.all([
            pwPage.request.get(poDetailsUrl, { headers, timeout: 30000 }),
            pwPage.request.get(ancillaryUrl, { headers, timeout: 30000 })
        ]);

        if (!poRes.ok() || !ancRes.ok()) {
            const poStatus = poRes.status(); const ancStatus = ancRes.status();
            monitorLog(`API fetch error. PO Status: ${poStatus}, Ancillary Status: ${ancStatus}`, 'error');
            if (poStatus === 401 || ancStatus === 401) { 
                monitorLog('Token possibly expired (401). Invalidating session.', 'warn');
                bearerToken = null; siteSelected = false; 
            }
            return;
        }

        const poDetails = await poRes.json();
        const ancillaryItems = await ancRes.json();
        monitorLog(`Fetched ${Array.isArray(poDetails) ? poDetails.length : 0} POs, ${Array.isArray(ancillaryItems) ? ancillaryItems.length : 0} ancillary items.`, 'monitor-display-info');
        
        const truckPalletTotals = {};
        const poToTruckMap = {};
        if (Array.isArray(poDetails)) {
            poDetails.forEach(item => {
                const po = String(item.poNumber || '').trim();
                const truckId = String(item.truckId || '');
                if (!po || !truckId) return;
                poToTruckMap[po] = { truckId, createdDate: item.createdDate || 'N/A' };
                const pallets = (parseInt(item.palletWhiteInCount,10)||0) + (parseInt(item.palletChepInCount,10)||0) + (parseInt(item.palletPecoInCount,10)||0) + (parseInt(item.palletIgpsInCount,10)||0);
                truckPalletTotals[truckId] = (truckPalletTotals[truckId] || 0) + pallets;
            });
        }
        const processedPOs = {};
        if (Array.isArray(ancillaryItems)) {
            ancillaryItems.forEach(item => {
                const po = String(item.pO_Number || '').trim();
                if (!po) return;
                if (!processedPOs[po]) processedPOs[po] = {createdDate: 'N/A', palletsIn: 0, badwoods: 0, restacks: 0, upstacks: 0 };
                const feeName = item.additional_Fee_Name;
                const qty = parseFloat(item.quantity) || 0;
                if (feeName === 'Restack') processedPOs[po].restacks += qty;
                else if (feeName === 'Badwood') processedPOs[po].badwoods += qty;
                else if (feeName === 'Upstack') processedPOs[po].upstacks += qty;
            });
        }
        for (const po in poToTruckMap) {
            if (!processedPOs[po]) processedPOs[po] = {createdDate: poToTruckMap[po].createdDate, palletsIn: 0, badwoods: 0, restacks: 0, upstacks: 0 }; 
            else { processedPOs[po].createdDate = poToTruckMap[po].createdDate; }
            processedPOs[po].palletsIn = truckPalletTotals[poToTruckMap[po].truckId] || 0;
        }

        let newAlerts = 0;
        for (const po in processedPOs) {
            const d = processedPOs[po];
            const sumAncillary = d.badwoods + d.restacks + d.upstacks;
            if (sumAncillary > d.palletsIn) {
                if (!alreadyAlertedPOs.has(po)) {
                    const alertMsg = `ALERT PO: ${po} (Created: ${d.createdDate || 'N/A'}) - Ancillary (${sumAncillary}) > Pallets (${d.palletsIn}). Diff: ${sumAncillary - d.palletsIn}`;
                    monitorLog(alertMsg, 'monitor-alert-po-detail');
                    alreadyAlertedPOs.add(po);
                    newAlerts++;
                    if (emailConfig && emailConfig.recipientEmail) {
                        await sendEmailNotification(emailConfig, `Problematic PO Alert: ${po}`, alertMsg);
                    }
                }
            }
        }
        if (newAlerts > 0) monitorLog(`${newAlerts} new problematic PO(s) found.`, 'monitor-display-info');
        else monitorLog(`No new problematic POs. Processed: ${Object.keys(processedPOs).length}.`, 'monitor-display-info');

    } catch (error) {
        monitorLog(`Error in single check: ${error.message}${error.stack ? '\n' + error.stack : ''}`, 'error');
        if (pwPage && pwPage.isClosed()) { bearerToken = null; pwPage = null; pwContext = null; siteSelected = false; monitorLog('Playwright page closed unexpectedly during check.','warn'); }
        else if (pwBrowser && !pwBrowser.isConnected()) { bearerToken = null; pwPage = null; pwContext = null; pwBrowser = null; siteSelected = false; monitorLog('Playwright browser disconnected during check.','warn');}
    }
}

async function startMonitoringService(params) {
    if (isMonitoringActive) {
        monitorLog('Monitoring is already active.', 'warn');
        return false;
    }
    isMonitoringActive = true;
    currentMonitorParams = params;
    alreadyAlertedPOs.clear();
    siteSelected = false; // Reset site selection status for new session

    monitorLog('Attempting to start PO Monitoring Service...', 'monitor-display-system');
    // Perform an initial check immediately
    await performSingleCheck(currentMonitorParams);
    
    // Only proceed if still active (initial check might fail and turn it off)
    if (isMonitoringActive) {
        const intervalMs = parseInt(currentMonitorParams.pollingIntervalMinutes, 10) * 60 * 1000;
        const validIntervalMs = (!isNaN(intervalMs) && intervalMs >= 10000) ? intervalMs : 60000; // Min 10s, default 1min
        
        monitorIntervalId = setInterval(async () => {
            if (!isMonitoringActive) { clearInterval(monitorIntervalId); monitorIntervalId = null; return; }
            monitorLog('Performing scheduled PO check...', 'monitor-display-info');
            await performSingleCheck(currentMonitorParams);
            monitorLog('Scheduled PO check complete.', 'monitor-display-info');
        }, validIntervalMs);
        monitorLog(`Monitoring started. Polling every ${validIntervalMs / 60000} minute(s).`, 'monitor-display-system');
        return true;
    } else {
        monitorLog('Monitoring could not be started (e.g. initial check failed). Please check logs.', 'error');
        // Ensure cleanup if initial steps failed and isMonitoringActive was reset
        if (pwPage && !pwPage.isClosed()) await pwPage.close().catch(e=>monitorLog(e.message, 'warn'));
        if (pwContext) await pwContext.close().catch(e=>monitorLog(e.message, 'warn'));
        if (pwBrowser && pwBrowser.isConnected()) await pwBrowser.close().catch(e=>monitorLog(e.message, 'warn'));
        pwBrowser = null; pwContext = null; pwPage = null; bearerToken = null; siteSelected = false;
        return false;
    }
}

async function stopMonitoringService() {
    if (!isMonitoringActive) {
        monitorLog('Monitoring is not active.', 'warn');
        return false; // Indicate not active, so API can respond appropriately
    }
    monitorLog('Attempting to stop PO Monitoring Service...', 'monitor-display-system');
    isMonitoringActive = false; // Set flag immediately
    if (monitorIntervalId) {
        clearInterval(monitorIntervalId);
        monitorIntervalId = null;
    }
    // Gracefully close Playwright resources
    if (pwPage && !pwPage.isClosed()) await pwPage.close().catch(e=>monitorLog(`Error closing page: ${e.message}`, 'warn'));
    if (pwContext) await pwContext.close().catch(e=>monitorLog(`Error closing context: ${e.message}`, 'warn'));
    if (pwBrowser && pwBrowser.isConnected()) await pwBrowser.close().catch(e=>monitorLog(`Error closing browser: ${e.message}`, 'warn'));
    pwBrowser = null; pwContext = null; pwPage = null; bearerToken = null; siteSelected = false;
    monitorLog('Monitoring stopped and browser resources cleaned up.', 'monitor-display-system');
    return true;
}

// --- API Endpoints ---
app.get('/api/monitor/status', (req, res) => {
    res.json({ success: true, isActive: isMonitoringActive, message: 'Status fetched.' });
});

app.post('/api/monitor/start', async (req, res) => {
    if (isMonitoringActive) {
        return res.status(400).json({ success: false, message: 'Monitor is already active.' });
    }
    const params = req.body;
    if (!params.username || !params.password || !params.siteType || !params.startDate || !params.endDate || !params.pollingIntervalMinutes) {
        return res.status(400).json({ success: false, message: 'Missing required parameters.' });
    }
    
    const started = await startMonitoringService(params);
    if (started) {
        res.json({ success: true, message: 'PO Monitor service initiated.' });
    } else {
        // startMonitoringService sets isMonitoringActive to false if it fails internally
        res.status(500).json({ success: false, message: 'Failed to start PO Monitor service. Check server logs.' });
    }
});

app.post('/api/monitor/stop', async (req, res) => {
    const stopped = await stopMonitoringService();
    if (stopped) {
        res.json({ success: true, message: 'PO Monitor service stopped.' });
    } else {
        // This implies it wasn't active to begin with
        res.status(400).json({ success: false, message: 'Monitor was not active.' }); 
    }
});

// --- Start Server ---
httpServer.listen(port, () => {
    console.log(`PO Monitor backend server listening on http://localhost:${port}`);
    console.log(`Ensure you have run 'npm install' and that Playwright browsers are installed (check 'npx playwright install --with-deps chromium').`);
}); 