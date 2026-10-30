const MAX_IMAGE_CHARS = 800000;
const MAX_GROUP_OBDS = 498;

function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

function validateImage(input, now) {
    if (!['All Delivered', 'Rejected', 'Delivered w/ Rejection'].includes(input.deliveryStatus)) {
        fail(400, 'Invalid delivery status');
    }
    const image = input.base64Image;
    if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS
        || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        fail(400, 'Invalid POD image');
    }
    const raw = image.slice(23);
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.length < 4 || bytes.toString('base64') !== raw
        || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) {
        fail(400, 'Invalid POD image');
    }
    if (!Number.isSafeInteger(input.capturedAtMillis) || input.capturedAtMillis <= 0
        || input.capturedAtMillis > now + 60000 || input.capturedAtMillis < now - 86400000) {
        fail(400, 'Invalid capture time');
    }
}

function validateObdNumbers(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GROUP_OBDS
        || value.some(obd => typeof obd !== 'string' || !/^[-A-Za-z0-9_. ]{1,100}$/.test(obd))
        || new Set(value).size !== value.length) {
        fail(400, 'Invalid OBD group');
    }
}

function validatePodRequest(input, now = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid POD request');
    const keys = input.action === 'complete' ? ['action', 'base64Image', 'deliveryStatus', 'capturedAtMillis']
        : input.action === 'unload' ? ['action', 'unloadStatus'] : ['action'];
    if (Object.keys(input).some(key => !keys.includes(key))) fail(400, 'Invalid POD request');
    if (!['complete', 'unload', 'retake'].includes(input.action)) fail(400, 'Invalid POD action');
    if (input.action === 'unload' && !['', 'UNLOADING'].includes(input.unloadStatus)) fail(400, 'Invalid unload status');
    if (input.action === 'complete') validateImage(input, now);
    return input;
}

function validatePodGroupRequest(input, now = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid POD group request');
    const keys = input.action === 'unload'
        ? ['action', 'obdNumbers', 'unloadStatus']
        : ['action', 'obdNumbers', 'captureId', 'base64Image', 'deliveryStatus', 'capturedAtMillis'];
    if (Object.keys(input).some(key => !keys.includes(key))) fail(400, 'Invalid POD group request');
    if (!['complete', 'unload'].includes(input.action)) fail(400, 'Invalid POD group action');
    validateObdNumbers(input.obdNumbers);
    if (input.action === 'unload') {
        if (!['', 'UNLOADING'].includes(input.unloadStatus)) fail(400, 'Invalid unload status');
    } else {
        if (typeof input.captureId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(input.captureId)) {
            fail(400, 'Invalid capture ID');
        }
        validateImage(input, now);
    }
    return input;
}

function destinationKey(row) {
    const shipTo = normalizedText(row.shipTo);
    const customer = normalizedText(row.customerName);
    const address = normalizedText(row.deliveryAddress);
    const latitude = finiteNumber(row.latitude);
    const longitude = finiteNumber(row.longitude);
    if (!shipTo || !customer || !address || latitude === null || longitude === null
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return JSON.stringify([shipTo, customer, address, latitude.toFixed(6), longitude.toFixed(6)]);
}

function normalizedText(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') : '';
}

function finiteNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

function timestampMillis(value) {
    if (typeof value === 'number') return value;
    return value && typeof value.toMillis === 'function' ? value.toMillis() : null;
}

function applyPodProgress(assignment, uid, obdNumber, input, now = Date.now()) {
    validatePodRequest(input, now);
    if (!assignment || assignment.driverId !== uid) fail(403, 'Shipment not authorized');
    if (assignment.tripStatus !== 'in_transit') fail(409, 'Shipment is not in transit');
    const rows = assignment.lineItems;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail(409, 'Invalid shipment items');
    if (!rows.some(row => row.obdNumber === obdNumber)) fail(404, 'OBD not found');
    if (input.action === 'unload' && rows.some(row => row.obdNumber === obdNumber && row.isPodCompleted === true)) {
        fail(409, 'Retake POD before unloading');
    }
    return rows.map(row => {
        if (row.obdNumber !== obdNumber) return row;
        if (input.action === 'unload') return {...row, unloadStatus: input.unloadStatus};
        const updated = {...row,
            deliveryStatus: input.action === 'complete' ? input.deliveryStatus : '',
            podImageUrl: input.action === 'complete' ? 'saved_in_subcollection' : '',
            podCapturedAt: input.action === 'complete' ? input.capturedAtMillis : null,
            isPodCompleted: input.action === 'complete',
            unloadStatus: input.action === 'complete' ? null : 'UNLOADING'};
        delete updated.podGroupId;
        return updated;
    });
}

function applyPodGroupProgress(assignment, uid, input, groupPodId, now = Date.now()) {
    validatePodGroupRequest(input, now);
    if (!assignment || assignment.driverId !== uid) fail(403, 'Shipment not authorized');
    if (assignment.tripStatus !== 'in_transit') fail(409, 'Shipment is not in transit');
    const rows = assignment.lineItems;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        fail(409, 'Invalid shipment items');
    }

    const selected = new Set(input.obdNumbers);
    const selectedRows = rows.filter(row => selected.has(row.obdNumber));
    if (!selectedRows.length || selected.size !== new Set(selectedRows.map(row => row.obdNumber)).size) fail(404, 'OBD not found');
    const keys = new Set(selectedRows.map(destinationKey));
    if (keys.has(null) || keys.size !== 1) fail(409, 'OBDs do not share a verified delivery destination');
    const [key] = keys;

    if (input.action === 'complete' && selectedRows.every(row => row.isPodCompleted === true
        && row.podGroupId === groupPodId && row.deliveryStatus === input.deliveryStatus
        && timestampMillis(row.podCapturedAt) === input.capturedAtMillis)) return rows;

    const rowsByObd = new Map();
    for (const row of rows) {
        if (destinationKey(row) === key) {
            const matches = rowsByObd.get(row.obdNumber) || [];
            matches.push(row);
            rowsByObd.set(row.obdNumber, matches);
        }
    }
    const pendingObds = [];
    for (const [obd, matches] of rowsByObd) {
        if (!obd || matches.some(row => row.isPodCompleted === true) && matches.some(row => row.isPodCompleted !== true)) {
            fail(409, 'OBD records have inconsistent delivery status');
        }
        if (!matches.every(row => row.isPodCompleted === true)) pendingObds.push(obd);
    }
    const requested = [...input.obdNumbers].sort();
    const expected = pendingObds.sort();
    if (requested.length !== expected.length || requested.some((obd, index) => obd !== expected[index])) {
        fail(409, 'Request must include every pending OBD at this destination');
    }

    if (input.action === 'unload') {
        return rows.map(row => selected.has(row.obdNumber) ? {...row, unloadStatus: input.unloadStatus} : row);
    }

    const selectedRowsReady = selectedRows.every(row => row.unloadStatus === 'UNLOADING');
    if (!selectedRowsReady) fail(409, 'Unload the OBD group before capturing POD');
    return rows.map(row => selected.has(row.obdNumber) ? {
        ...row,
        deliveryStatus: input.deliveryStatus,
        podImageUrl: 'saved_in_subcollection',
        podCapturedAt: input.capturedAtMillis,
        isPodCompleted: true,
        unloadStatus: null,
        podGroupId: groupPodId,
    } : row);
}

module.exports = {
    applyPodProgress,
    applyPodGroupProgress,
    validatePodRequest,
    validatePodGroupRequest,
    destinationKey,
    MAX_IMAGE_CHARS,
    MAX_GROUP_OBDS,
};
