const summaries = Object.freeze({
    api_request_failure: 'A service request did not finish.',
    frontend_uncaught: 'The website ran into a problem.',
    frontend_unhandled_rejection: 'A website background task did not finish.',
    frontend_operation_failure: 'A website task did not finish.',
    mobile_uncaught_exception: 'The SYSU Go app stopped unexpectedly.',
    mobile_operation_failure: 'A task in the SYSU Go app did not finish.',
    sap_unavailable: 'Shipment information could not be loaded from SAP.',
    sap_detail_mismatch: 'Some shipment information is missing.',
});

const operations = Object.freeze({
    'driver-profile': 'Driver profile',
    'realtime-connection': 'Live updates',
    'sap-detail-enrichment': 'Shipment details',
    'sap-dispatch-details': 'Shipment details',
    'sap-shipments': 'Shipment list',
    'sap-sync': 'Shipment update',
    'pod-preview': 'Proof of delivery',
    'pod-save': 'Proof of delivery',
    'trip-start': 'Start trip',
    'shipment-assignment': 'Shipment assignment',
    'dashboard-runtime': 'Dashboard',
});

function makeGuidance(meaning, steps, ifStillFails, systemManager) {
    return {meaning, steps, ifStillFails, systemManager, action: [...steps, ifStillFails].join(' ')};
}

export function systemDiagnosticsSummary(entry = {}) {
    const operation = String(entry.operation || '').toLowerCase();
    if (operation === 'driver-profile') return 'The driver profile could not be loaded.';
    if (operation === 'realtime-connection') return 'Live updates stopped working.';
    if (operation.startsWith('sap-')) return 'Shipment information could not be loaded from SAP.';
    if (operation.includes('pod-preview')) return 'The proof-of-delivery image could not be shown.';
    return summaries[entry.eventCode] || 'Something did not work as expected.';
}

export function systemDiagnosticsSource(entry = {}) {
    return ({web: 'Website', mobile: 'Phone app', sap: 'SAP', backend: 'Service'})[entry.source] || 'System';
}

export function systemDiagnosticsOperation(entry = {}) {
    return operations[String(entry.operation || '').toLowerCase()] || '';
}

export function systemDiagnosticsGuidance(entry = {}) {
    const operation = String(entry.operation || '').toLowerCase();
    const details = entry.details || {};
    const failureCode = String(details.failureCode || '').toUpperCase();
    const httpStatus = Number(details.httpStatus ?? details.statusCode);
    const isMobile = entry.eventCode?.startsWith('mobile_');

    if (failureCode === 'NETWORK_UNREACHABLE') {
        const service = operation.includes('sysu-go') ? 'SYSU Go' : 'SYSU App';
        return makeGuidance(
            `${service} could not be reached. Information on screen may be old.`,
            ['Check that the phone or computer has internet.', 'Wait a few seconds, then refresh the page or reopen the screen once.', 'Do not repeat a trip or assignment until you know whether it went through.'],
            'If it still does not work, send the Reference above to the system manager.',
            'Use the Reference and time above to check service and network logs. Confirm the affected API is reachable before asking the user to retry.',
        );
    }

    if (failureCode === 'HEALTH_CHECK_TIMEOUT' || (failureCode === 'HEALTH_CHECK_FAILED' && httpStatus >= 500)) {
        return makeGuidance(
            'The service did not answer or could not finish the request.',
            ['Wait a minute and check the connection indicator.', 'Do not repeat a trip, assignment, or delivery action until its current status is checked.'],
            'If the service is still unavailable, send the Reference to the system manager.',
            'Check the matching service logs and database response time near this timestamp. Confirm the service is healthy before retrying state-changing actions.',
        );
    }

    if (failureCode === 'DATABASE_UNAVAILABLE' || operation.includes('-database-health')) {
        return makeGuidance(
            'The system could not connect to the system database, where shared information is stored. Some screens or actions may not work.',
            ['Pause actions that need the missing information.', 'Check whether the same screen works again after a short wait.'],
            'If it still fails, send the Reference to the system manager and ask them to check the database connection. Do not repeat an action until its status is checked.',
            'Check the application database connection, available connections, and database logs at the recorded time.',
        );
    }

    if (httpStatus === 429) {
        return makeGuidance(
            'The system received too many requests at once.',
            ['Wait one minute.', 'Try the action once more.'],
            'If it still fails, send the Reference to the system manager.',
            'Check request-rate limits and whether a client or retry loop is sending repeated requests.',
        );
    }

    if (httpStatus === 401 || httpStatus === 403) {
        return makeGuidance(
            'Your sign-in may have expired, or this account may not have access.',
            ['Sign out, then sign in again.', 'Open the same screen once more.'],
            'If access is still denied, ask an administrator to check your account. Share the Reference.',
            'Check the account role and authorization result for this request. Do not grant extra access just to bypass the error.',
        );
    }

    if (isMobile && operation === 'driver-profile') {
        const timedOut = String(entry.errorName || '').toLowerCase().includes('timeout');
        return makeGuidance(
            timedOut
                ? 'SYSU Go could not load the driver’s profile in time. The information shown may be old; this does not mean a trip or assignment failed.'
                : 'SYSU Go could not load the driver profile. The information shown may be old.',
            ['Check the phone’s internet connection.', 'Open Profile again after the connection is back. The app tries once more automatically.'],
            'If the profile is still missing, send the Reference and app version to the system manager.',
            'Check the driver-profile API logs and database response time using the Reference, account, and app version.',
        );
    }

    if (isMobile && ['queue-subscription', 'assignment-subscription', 'guard-subscription', 'profile-subscription'].includes(operation)) {
        return makeGuidance(
            'The app stopped receiving live updates. The screen may show old information.',
            ['Check the phone’s internet connection.', 'Wait for the app to reconnect, then reopen the screen.', 'Confirm the latest queue or shipment status before acting on it.'],
            'If updates do not return, tell the dispatcher and send the Reference and app version to the system manager.',
            'Check the Go Socket.IO connection and subscription logs using the Reference, account, and app version.',
        );
    }

    if (isMobile && operation === 'location-tracking-start') {
        return makeGuidance(
            'The phone could not start sending the driver’s location.',
            ['Turn on the phone’s Location setting.', 'Allow SYSU Go to use location while tracking.', 'Return to the tracking screen and check that tracking is active.'],
            'Tell the dispatcher that the map may not show your current position. Send the Reference and app version to the system manager if tracking still will not start.',
            'Check Android location permission, location-service state, and Go location-service logs around the recorded time.',
        );
    }

    if (isMobile && operation === 'qr-camera-start') {
        return makeGuidance(
            'The app could not open the QR scanner.',
            ['Allow SYSU Go to use the camera.', 'Close the scanner, open it again, and try once.'],
            'If it still will not open, ask the dispatcher for help and send the Reference to the system manager.',
            'Check camera permission state and the QR scanner startup logs for this app version.',
        );
    }

    if (isMobile && ['pod-save', 'pod-processing'].includes(operation)) {
        return makeGuidance(
            'The delivery proof was not confirmed as saved.',
            ['Check the shipment to see whether the proof already appears.', 'If it does not appear, check the connection and try again once.'],
            'If the proof is still missing, tell the dispatcher and send the Reference to the system manager. Do not assume it was saved.',
            'Check the POD request result and database record using the Reference before asking the driver to submit again.',
        );
    }

    if (isMobile && ['trip-start', 'shipment-state-transition', 'shipment-completion', 'guard-verification'].includes(operation)) {
        return makeGuidance(
            'The shipment action was not confirmed.',
            ['Open the shipment and check its current status.', 'If the status already changed, do not submit the action again.', 'If it did not change, check the connection and retry once.'],
            'If the status is unclear or the action still fails, ask the dispatcher to check it. Send the Reference to the system manager.',
            'Check the action request and resulting shipment state in the Go API logs using the Reference before any retry.',
        );
    }

    if (isMobile && operation === 'queue-load') {
        return makeGuidance(
            'The driver queue could not be loaded.',
            ['Check the phone’s internet connection.', 'Open the queue screen again after a short wait.'],
            'If the queue is still missing, tell the dispatcher and send the Reference to the system manager.',
            'Check the queue API response and database query logs using the Reference and timestamp.',
        );
    }

    if (operation.includes('sap-detail-enrichment')) {
        return makeGuidance(
            'Some shipment details could not be loaded from SAP.',
            ['Open the shipment in SAP and confirm its details.', 'Do not change or assign the shipment until the details match.'],
            'If details are still missing, send the Reference to the system manager.',
            'Check SAP response errors and the shipment identifier mapping for this request.',
        );
    }

    if (operation.includes('sap-sync') || operation.includes('sap-shipments') || entry.eventCode === 'sap_unavailable') {
        return makeGuidance(
            'The latest shipment information could not be loaded from SAP. The page may show older information.',
            ['Check the shipment in SAP before changing or assigning it.', 'Try the update once more.'],
            'If it still fails, send the Reference to the system manager.',
            'Check SAP service availability, response errors, and the synchronization logs at this timestamp.',
        );
    }

    if (operation.includes('realtime-connection')) {
        return makeGuidance(
            'The live connection stopped. Map positions or queue changes may not be up to date.',
            ['Check the connection indicator.', 'Wait briefly for it to reconnect.', 'If it stays disconnected, refresh the page once. Do not rely on the map as live until it reconnects.'],
            'If it remains disconnected, send the Reference to the system manager.',
            'Check Socket.IO server and proxy connection logs using the time and Reference. Confirm both app and web clients can reconnect.',
        );
    }

    if (operation.includes('pod-preview')) {
        return makeGuidance(
            'The proof-of-delivery image could not be shown. This does not mean the saved proof was lost.',
            ['Open the shipment again and try to view the image once more.', 'Check that the correct shipment is open before marking anything received.'],
            'If the image is still missing, send the Reference to the system manager.',
            'Check the POD API response, file availability, and account access using the Reference.',
        );
    }

    if (entry.eventCode === 'sap_detail_mismatch') {
        return makeGuidance(
            'Some shipment details from SAP are missing.',
            ['Check the shipment in SAP before continuing.', 'Try the update once more.'],
            'If details are still missing, send the Reference to the system manager.',
            'Compare the SAP response with the required shipment fields and review the synchronization log.',
        );
    }

    if (operation.includes('dashboard-runtime') || entry.eventCode?.startsWith('frontend_')) {
        return makeGuidance(
            'A task on the website did not finish.',
            ['Check whether the action already worked before trying it again.', 'If safe, refresh the page once and reopen the screen.'],
            'If the problem returns, send the Reference to the system manager.',
            'Use the Reference and timestamp to check website and API logs. Confirm whether the request changed data before asking for a retry.',
        );
    }

    if (isMobile) {
        return makeGuidance(
            'A task in the SYSU Go app did not finish.',
            ['Check the phone’s internet connection.', 'Check the trip or shipment status before repeating the action.', 'When connected, reopen the screen and try once if the action was not saved.'],
            'If it happens again, send the Reference and app version to the system manager.',
            'Check the Go API logs using the Reference, timestamp, operation, and app version. Confirm whether the action reached the server.',
        );
    }

    return makeGuidance(
        'Something did not work as expected.',
        ['Check the current trip, shipment, or assignment before trying again.', 'If safe, reopen the screen and try once.'],
        'If it still looks wrong, send the Reference to the system manager.',
        'Use the Reference, operation, and timestamp to find the matching application log and confirm whether data was saved.',
    );
}
