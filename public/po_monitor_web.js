// po_monitor_web.js - Frontend logic for PO Monitor Web Interface
console.log("PO_Monitor_Web: Script loaded. Verifying DOM elements...");

// --- Configuration ---
const API_BASE_URL = 'https://monitor1-e2tx.onrender.com/api/monitor'; // Base URL for your backend
const WEBSOCKET_URL = 'wss://monitor1-e2tx.onrender.com/api/monitor/updates'; // WebSocket URL

// --- Get references to DOM elements ---
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const activityLogDiv = document.getElementById('activityLog');
const statusBarMessageEl = document.getElementById('statusBarMessage');
const statusBarSpinnerEl = document.getElementById('statusBarSpinner');

const poSiteTypeEl = document.getElementById('poSiteType');
const poStartDateEl = document.getElementById('poStartDate');
const poEndDateEl = document.getElementById('poEndDate');

const resultsTitleEl = document.getElementById('resultsTitle');
const resultsTableContainerEl = document.getElementById('resultsTableContainer');
let noResultsMessageEl = document.getElementById('noResultsMessage');

const startPOMonitorButton = document.getElementById('startPOMonitorButton');
const stopPOMonitorButton = document.getElementById('stopPOMonitorButton');
const poMonitorStatusEl = document.getElementById('poMonitorStatus');
const poPollingIntervalEl = document.getElementById('poPollingInterval');

const poMonitorRecipientEmailEl = document.getElementById('poMonitorRecipientEmail');
const poMonitorSenderServiceEl = document.getElementById('poMonitorSenderService');
const poMonitorSenderUserEl = document.getElementById('poMonitorSenderUser');
const poMonitorSenderPassEl = document.getElementById('poMonitorSenderPass');
const poMonitorSmtpHostEl = document.getElementById('poMonitorSmtpHost');
const poMonitorSmtpPortEl = document.getElementById('poMonitorSmtpPort');
const poMonitorSmtpSecureEl = document.getElementById('poMonitorSmtpSecure');
const poMonitorCustomSmtpGroupEl = document.getElementById('poMonitorCustomSmtpGroup');

// --- State Variables ---
let isMonitorDisplayActive = false; // Flag to track if results area is used by monitor
let webSocket;

// --- Helper Functions ---
function addActivityLog(message, type = 'info') {
    if (!activityLogDiv) {
        console.error("addActivityLog: activityLogDiv not found for message:", message);
        return;
    }
    const logEntry = document.createElement('div');
    logEntry.textContent = message; // Message is expected to be pre-formatted
    
    logEntry.className = 'log-entry-' + type; // e.g., log-entry-error, log-entry-info

    activityLogDiv.appendChild(logEntry);
    activityLogDiv.scrollTop = activityLogDiv.scrollHeight;
}

function setStatus(message, showSpinner = false) {
    if (statusBarMessageEl) statusBarMessageEl.textContent = message;
    if (statusBarSpinnerEl) statusBarSpinnerEl.classList.toggle('hidden', !showSpinner);
}

function getFormattedDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- WebSocket Management ---
function connectWebSocket() {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        console.log("WebSocket already open.");
        return;
    }

    webSocket = new WebSocket(WEBSOCKET_URL);

    webSocket.onopen = () => {
        console.log("WebSocket connection established.");
        addActivityLog("Real-time connection to server established.", "system");
    };

    webSocket.onmessage = (event) => {
        try {
            const messageData = JSON.parse(event.data);
            console.log("WebSocket message received:", messageData);
            
            const { type, message, source } = messageData; // Expecting type and message, source is optional

            // Log all messages to the general activity log
            addActivityLog(message, type);

            // If monitor is active, display relevant messages in the main results area
            if (isMonitorDisplayActive && (type.startsWith('monitor-display') || type.startsWith('monitor-alert'))) {
                if (resultsTableContainerEl) {
                    if (noResultsMessageEl && noResultsMessageEl.parentNode === resultsTableContainerEl) {
                        resultsTableContainerEl.removeChild(noResultsMessageEl); // Remove "Monitor not started..."
                    }
                    
                    const displayEntry = document.createElement('div');
                    let displayMessage = message;
                    // Remove prefixes like [PO Monitor] or log levels if they are part of the message string
                    displayMessage = displayMessage.replace(/^\[(PO Monitor|DEBUG|INFO|WARN|ERROR|SYSTEM)\]\s*/i, '').trim();

                    displayEntry.textContent = displayMessage;
                    
                    // Add classes for styling based on type
                    if (type === 'monitor-alert-po-detail' || type === 'monitor-alert-email-sent') {
                        displayEntry.classList.add('monitor-alert-po-detail'); // or a generic 'monitor-alert'
                    } else if (type === 'monitor-display-system') {
                        displayEntry.classList.add('monitor-display-system');
                    } else if (type === 'monitor-display-info') {
                        displayEntry.classList.add('monitor-display-info');
                    } else if (type === 'error' || type === 'monitor-alert-error') {
                        displayEntry.classList.add('error');
                    }
                    // Add more specific classes if needed based on 'type'

                    resultsTableContainerEl.appendChild(displayEntry);
                    resultsTableContainerEl.scrollTop = resultsTableContainerEl.scrollHeight;
                }
            }
        } catch (e) {
            console.error("Error processing WebSocket message:", e);
            addActivityLog("Error processing real-time update from server.", "error");
        }
    };

    webSocket.onclose = () => {
        console.log("WebSocket connection closed.");
        addActivityLog("Real-time connection to server closed.", "warn");
        // Optionally, try to reconnect after a delay
    };

    webSocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        addActivityLog("Error with real-time connection to server. Check console.", "error");
    };
}

function disconnectWebSocket() {
    if (webSocket) {
        webSocket.close();
        webSocket = null;
        console.log("WebSocket connection intentionally closed.");
    }
}


// --- PO Monitor Actions ---
async function updatePOMonitorStatusDisplay() {
    if (!poMonitorStatusEl) return;
    try {
        setStatus("Checking monitor status...", true);
        const response = await fetch(`${API_BASE_URL}/status`);
        setStatus("Status check complete.", false);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const statusResult = await response.json();

        if (statusResult.success) {
            poMonitorStatusEl.textContent = statusResult.isActive ? 'Status: Active' : 'Status: Inactive';
            poMonitorStatusEl.className = statusResult.isActive ? 'status-active' : 'status-inactive';
            if (startPOMonitorButton) startPOMonitorButton.disabled = statusResult.isActive;
            if (stopPOMonitorButton) stopPOMonitorButton.disabled = !statusResult.isActive;
            
            if (statusResult.isActive && (!webSocket || webSocket.readyState === WebSocket.CLOSED)) {
                connectWebSocket(); // Re-establish WebSocket if monitor is active but socket is closed
            } else if (!statusResult.isActive && webSocket && webSocket.readyState === WebSocket.OPEN) {
                disconnectWebSocket(); // Close WebSocket if monitor is inactive
            }

        } else {
            poMonitorStatusEl.textContent = 'Status: Unknown';
            poMonitorStatusEl.className = 'status-unknown';
            addActivityLog(`Failed to get monitor status: ${statusResult.message || 'Unknown reason'}`, 'warn');
        }
    } catch (e) {
        addActivityLog(`Error getting PO monitor status: ${e.message}`, 'error');
        console.error("Error fetching PO monitor status:", e);
        if (poMonitorStatusEl) {
            poMonitorStatusEl.textContent = 'Status: Error';
            poMonitorStatusEl.className = 'status-error';
        }
        setStatus("Error checking status.", false);
    }
}

if (startPOMonitorButton) {
    startPOMonitorButton.addEventListener('click', async () => {
        addActivityLog('PO Monitor: Start initiated by user.', 'system');
        
        if (resultsTableContainerEl) {
            resultsTableContainerEl.innerHTML = ''; // Clear previous logs/tables
            const p = document.createElement('p');
            p.id = "noResultsMessage"; // Re-add the placeholder
            p.style.color = 'var(--text-secondary)';
            p.style.textAlign = 'center';
            p.textContent = 'Attempting to start PO Monitor... Waiting for first update.';
            resultsTableContainerEl.appendChild(p);
            noResultsMessageEl = p; // Update reference
            isMonitorDisplayActive = true; 
        }
        if (resultsTitleEl) resultsTitleEl.textContent = 'Real-time PO Monitor Log';

        const username = usernameEl.value;
        const password = passwordEl.value;
        const siteType = poSiteTypeEl.value;
        const startDate = poStartDateEl.value;
        const endDate = poEndDateEl.value;
        const pollingIntervalMinutes = poPollingIntervalEl ? parseInt(poPollingIntervalEl.value, 10) : 1;

        const recipientEmail = poMonitorRecipientEmailEl ? poMonitorRecipientEmailEl.value.trim() : '';
        const senderService = poMonitorSenderServiceEl ? poMonitorSenderServiceEl.value : '';
        const senderUser = poMonitorSenderUserEl ? poMonitorSenderUserEl.value.trim() : '';
        const senderPass = poMonitorSenderPassEl ? poMonitorSenderPassEl.value : ''; 
        const smtpHost = poMonitorSmtpHostEl ? poMonitorSmtpHostEl.value.trim() : '';
        const smtpPort = poMonitorSmtpPortEl ? parseInt(poMonitorSmtpPortEl.value, 10) : null;
        const smtpSecure = poMonitorSmtpSecureEl ? poMonitorSmtpSecureEl.checked : false;

        if (!username || !password || !siteType || !startDate || !endDate) {
            addActivityLog('PO Monitor: Validation Error - Username, Password, Site, and Dates are required.', 'error');
            setStatus('PO Monitor: Validation Error.', false);
            isMonitorDisplayActive = false; // Reset on validation fail
            return;
        }
        if (isNaN(pollingIntervalMinutes) || pollingIntervalMinutes < 1) {
            addActivityLog('PO Monitor: Validation Error - Polling interval must be a number > 0.', 'error');
            setStatus('PO Monitor: Invalid Interval.', false);
            isMonitorDisplayActive = false; // Reset on validation fail
            return;
        }

        let emailConfig = null;
        if (recipientEmail && senderUser && senderPass) {
            emailConfig = { recipientEmail, senderService, senderUser, senderPass }; // Password sent to backend
            if (senderService === 'custom') {
                if (!smtpHost || !smtpPort) {
                    addActivityLog('PO Monitor: Validation Error - Custom SMTP requires Host and Port.', 'error');
                    setStatus('PO Monitor: Invalid SMTP.', false);
                    isMonitorDisplayActive = false; // Reset on validation fail
                    return;
                }
                emailConfig.smtpHost = smtpHost;
                emailConfig.smtpPort = smtpPort;
                emailConfig.smtpSecure = smtpSecure;
            }
        } else if (recipientEmail || senderUser || senderPass) {
             addActivityLog('PO Monitor: Email config incomplete. To enable email alerts, provide Recipient, Sender Email & Password.', 'warn');
        }
        
        setStatus('PO Monitor: Starting...', true);
        startPOMonitorButton.disabled = true; 
        
        const params = { 
            username, password, siteType, startDate, endDate, pollingIntervalMinutes,
            emailConfig
        };

        try {
            const response = await fetch(`${API_BASE_URL}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            const result = await response.json();

            addActivityLog(`Backend: ${result.message}`, result.success ? 'system' : 'error');
            setStatus(result.success ? 'PO Monitor: Initiated by backend.' : 'PO Monitor: Start failed on backend.', false);
            
            if (result.success) {
                connectWebSocket(); // Ensure WebSocket is connected on successful start
            } else {
                 isMonitorDisplayActive = false; // Reset if start failed
            }
            await updatePOMonitorStatusDisplay();
        } catch (error) {
            addActivityLog(`PO Monitor: Network/API Error - ${error.message}`, 'error');
            console.error("Error starting PO monitor:", error);
            setStatus(`PO Monitor: Error - ${error.message}`, false);
            isMonitorDisplayActive = false; // Reset on error
            await updatePOMonitorStatusDisplay();
        }
    });
}

if (stopPOMonitorButton) {
    stopPOMonitorButton.addEventListener('click', async () => {
        addActivityLog('PO Monitor: Stop initiated by user.', 'system');
        isMonitorDisplayActive = false; 
        // if(resultsTitleEl) resultsTitleEl.textContent = 'Results'; // Or keep as monitor log
        if (resultsTableContainerEl && noResultsMessageEl) {
             resultsTableContainerEl.innerHTML = '';
             resultsTableContainerEl.appendChild(noResultsMessageEl);
             noResultsMessageEl.textContent = 'PO Monitor stopping...';
        }


        setStatus('PO Monitor: Stopping...', true);
        stopPOMonitorButton.disabled = true;
        try {
            const response = await fetch(`${API_BASE_URL}/stop`, { method: 'POST' });
            const result = await response.json();
            
            addActivityLog(`Backend: ${result.message}`, result.success ? 'system' : 'error');
            setStatus(result.success ? 'PO Monitor: Stop command sent to backend.' : 'PO Monitor: Stop failed on backend.', false);
            if (result.success) {
                disconnectWebSocket(); // Disconnect WebSocket on successful stop
            }
            await updatePOMonitorStatusDisplay();
            if (noResultsMessageEl) noResultsMessageEl.textContent = 'Monitor stopped. Select a tool or start monitor to see updates.';

        } catch (error) {
            addActivityLog(`PO Monitor: Network/API Error - ${error.message}`, 'error');
            console.error("Error stopping PO monitor:", error);
            setStatus(`PO Monitor: Error - ${error.message}`, false);
            await updatePOMonitorStatusDisplay();
             if (noResultsMessageEl) noResultsMessageEl.textContent = 'Error stopping monitor. Check logs.';
        }
    });
}

// --- DOMContentLoaded Handler ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("PO_Monitor_Web: DOMContentLoaded event fired.");
    try {
        const today = new Date();
        const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
        if (poEndDateEl) poEndDateEl.value = getFormattedDate(today);
        if (poStartDateEl) poStartDateEl.value = getFormattedDate(firstDayOfYear);
        if (poPollingIntervalEl) poPollingIntervalEl.value = "1"; 
        console.log("PO_Monitor_Web: Default dates and PO poll interval set.");
    } catch(e) {
        console.error("Error setting default dates/PO interval:", e);
        addActivityLog("Error setting default dates/PO interval: " + e.message, "error");
    }
    
    if (poMonitorSenderServiceEl && poMonitorCustomSmtpGroupEl) {
        poMonitorSenderServiceEl.addEventListener('change', function() {
            poMonitorCustomSmtpGroupEl.style.display = this.value === 'custom' ? 'block' : 'none';
        });
        poMonitorCustomSmtpGroupEl.style.display = poMonitorSenderServiceEl.value === 'custom' ? 'block' : 'none';
    }

    updatePOMonitorStatusDisplay(); 
    setInterval(updatePOMonitorStatusDisplay, 15000); // Update status every 15 seconds

    setStatus("Ready"); 
    addActivityLog("System Interface Ready. Configure and start PO Monitor.", "info");
    console.log("PO_Monitor_Web: DOMContentLoaded handler finished.");
});

// Initial check for elements
if (!usernameEl || !passwordEl || !activityLogDiv || !statusBarMessageEl || !statusBarSpinnerEl ||
    !poSiteTypeEl || !poStartDateEl || !poEndDateEl || !resultsTitleEl || !resultsTableContainerEl ||
    !startPOMonitorButton || !stopPOMonitorButton || !poMonitorStatusEl || !poPollingIntervalEl ||
    !poMonitorRecipientEmailEl || !poMonitorSenderServiceEl || !poMonitorSenderUserEl || !poMonitorSenderPassEl ||
    !poMonitorSmtpHostEl || !poMonitorSmtpPortEl || !poMonitorSmtpSecureEl || !poMonitorCustomSmtpGroupEl) {
    console.warn("PO_Monitor_Web: One or more critical DOM elements were not found. UI might not function correctly.");
    addActivityLog("Warning: Some UI elements could not be found. Page may not work as expected.", "warn");
} 