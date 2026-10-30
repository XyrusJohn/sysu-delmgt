function conflict(code, message) {
    return {status: 409, code, message};
}

function optionalSourceText(value, max) {
    if (value === null || value === undefined || value === '') return {valid: true};
    if (typeof value !== 'string' || value.length > max) return {valid: false};
    const normalized = value.trim();
    return {valid: true, value: normalized || undefined};
}

function optionalSourceNumber(value, min, max) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return {valid: true};
    const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(number) || number < min || number > max) return {valid: false};
    return {valid: true, value: number};
}

function validateAssignment(rows, body) {
    const group = rows.filter(row => typeof row.SAPDispatchNumber === 'string' && row.SAPDispatchNumber.trim() === body.dispatchKey);
    if (!group.length) return conflict('SAP_DISPATCH_UNAVAILABLE', 'Dispatch is no longer unassigned in SAP. Refresh shipments.');
    if (typeof group[0].TruckType !== 'string' || group[0].TruckType.trim().toLowerCase() !== body.truckType.trim().toLowerCase()) {
        return conflict('SAP_TRUCK_TYPE_MISMATCH', 'Truck type does not match the SAP dispatch.');
    }

    const canonical = [];
    for (const row of group) {
        const quantity = Number(row.Quantity);
        const rawCustomer = row.ShipToPartyName || row.ShipToParty || '';
        const customer = typeof rawCustomer === 'string' ? rawCustomer.trim() : '';
        const shipTo = optionalSourceText(row.ShipToParty, 128);
        const address = optionalSourceText(row.Address, 1000);
        const volume = optionalSourceNumber(row.Volume, 0, Number.MAX_SAFE_INTEGER);
        const weight = optionalSourceNumber(row.Weight, 0, Number.MAX_SAFE_INTEGER);
        const latitude = optionalSourceNumber(row.Latitude, -90, 90);
        const longitude = optionalSourceNumber(row.Longitude, -180, 180);
        if (typeof row.OBDNumber !== 'string' || !row.OBDNumber.trim() || row.OBDNumber.length > 128
            || row.OBDNumber.includes('/') || !customer || customer.length > 500
            || typeof row.Quantity !== 'string' || !/^\d+(?:\.\d+)?$/.test(row.Quantity)
            || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER
            || !shipTo.valid || !address.valid || !volume.valid || !weight.valid || !latitude.valid || !longitude.valid) {
            return conflict('SAP_DATA_INVALID', 'Dispatch contains incomplete or invalid SAP line items and requires reconciliation.');
        }
        canonical.push({
            obdNumber: row.OBDNumber,
            quantity,
            customerName: customer,
            ...(shipTo.value ? {shipTo: shipTo.value} : {}),
            ...(address.value ? {deliveryAddress: address.value} : {}),
            ...(volume.value !== undefined ? {volume: volume.value} : {}),
            ...(weight.value !== undefined ? {weight: weight.value} : {}),
            ...(latitude.value !== undefined ? {latitude: latitude.value} : {}),
            ...(longitude.value !== undefined ? {longitude: longitude.value} : {}),
        });
    }
    if (canonical.length > 500 || canonical.length !== body.lineItems.length) {
        return conflict('SAP_LINE_ITEMS_MISMATCH', 'Assignment must contain every eligible row of the SAP dispatch.');
    }

    const counts = new Map();
    const coreKey = item => JSON.stringify([item.obdNumber, item.quantity, item.customerName]);
    for (const item of canonical) {
        const key = coreKey(item);
        counts.set(key, [...(counts.get(key) || []), item]);
    }
    for (const item of body.lineItems) {
        const key = coreKey(item);
        const candidates = counts.get(key) || [];
        const index = candidates.findIndex(source => ['shipTo', 'deliveryAddress', 'volume', 'weight', 'latitude', 'longitude']
            .every(field => item[field] === undefined || item[field] === source[field]));
        if (index < 0) return conflict('SAP_LINE_ITEMS_MISMATCH', 'OBD, quantity, customer or destination does not match SAP. Refresh shipments.');
        candidates.splice(index, 1);
    }
    return {status: 200, lineItems: canonical};
}

module.exports = {validateAssignment};
