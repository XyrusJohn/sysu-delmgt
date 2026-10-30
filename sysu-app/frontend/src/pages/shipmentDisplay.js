//  SAP supplies assignable shipments. MySQL-backed assignments supply delivery lifecycle state.
//  This projection is for display; it never writes back to either source.
export function obdDeliveryStatus(line) {
    if (line?.isPodCompleted !== true) return 'Pending POD';
    const status = typeof line.deliveryStatus === 'string' ? line.deliveryStatus.trim().toLowerCase() : '';
    switch (status) {
        case 'all delivered': return 'Delivered';
        case 'rejected': return 'Rejected';
        case 'delivered w/ rejection': return 'Delivered w/ rejection';
        default: return 'Unknown';
    }
}

export function groupObdRowsByShipTo(rows) {
    const groups = new Map();
    rows.forEach((row, index) => {
        const normalize = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
        const coordinate = value => {
            if (value === null || value === undefined || value === '') return '';
            const number = Number(value);
            return Number.isFinite(number) ? number.toFixed(6) : '';
        };
        const shipTo = normalize(row.ShipToParty);
        const customer = normalize(row.ShipToPartyName);
        const address = normalize(row.Address);
        const latitude = coordinate(row.Latitude);
        const longitude = coordinate(row.Longitude);
        const validCoordinates = latitude !== '' && longitude !== ''
            && Number(latitude) >= -90 && Number(latitude) <= 90
            && Number(longitude) >= -180 && Number(longitude) <= 180;
        const key = shipTo && customer && address && validCoordinates
            ? JSON.stringify([shipTo, customer, address, latitude, longitude])
            : `unique:${index}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    return [...groups.values()];
}

const optionalSapNumber = value => {
    if (value === null || value === undefined || String(value).trim() === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
};

const optionalSapText = value => {
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text || undefined;
};

export function driverAssignmentFields(row) {
    return {
        shipTo: optionalSapText(row.ShipToParty),
        deliveryAddress: optionalSapText(row.Address),
        latitude: optionalSapNumber(row.Latitude),
        longitude: optionalSapNumber(row.Longitude),
        volume: optionalSapNumber(row.Volume),
        weight: optionalSapNumber(row.Weight),
    };
}

export function queueDriverDisplayName(queueEntry, drivers = []) {
    const profileId = queueEntry?.driverId || queueEntry?.id;
    const profile = drivers.find(driver => driver.id === profileId);
    return queueEntry?.driverName || queueEntry?.user?.name || profile?.driverName || profile?.name || 'Unknown Driver';
}

export function mergeAssignmentGroups(sapGroups, assignments, dispatchDetails = {}) {
    const groups = Object.assign(Object.create(null), sapGroups);
    for (const [key, assignment] of Object.entries(assignments)) {
        const sapRows = groups[key]?.length ? groups[key] : dispatchDetails[key] || [];
        const storedRows = (assignment.lineItems || [])
            .map(line => {
                const sapRow = sapRows.find(row => String(row.OBDNumber || '') === String(line.obdNumber || '')) || {};
                return {
                ...sapRow,
                SAPDispatchNumber: key,
                OBDNumber: String(line.obdNumber || ''),
                ShipToPartyName: sapRow.ShipToPartyName || line.customerName || '',
                ShipToParty: sapRow.ShipToParty || line.shipTo || line.shipToParty || '',
                Address: sapRow.Address || line.deliveryAddress || line.address || '',
                Latitude: sapRow.Latitude ?? line.latitude ?? '',
                Longitude: sapRow.Longitude ?? line.longitude ?? '',
                ActualDelDate: sapRow.ActualDelDate || line.actualDelDate || '',
                PlanningDate: sapRow.PlanningDate || line.planningDate || '',
                Quantity: line.quantity ?? line.quantityNumeric ?? sapRow.Quantity,
                Volume: line.volume ?? sapRow.Volume,
                Weight: line.weight ?? sapRow.Weight,
                Amount: line.amount ?? sapRow.Amount,
                TruckType: assignment.truckType ?? sapRow.TruckType ?? '',
                PlateNumber: assignment.truckPlate ?? sapRow.PlateNumber ?? '',
                Driver: assignment.driverName ?? sapRow.Driver ?? '',
                Route: assignment.route || sapRow.Route || '',
                };
            });
        //  Stored line items are the canonical assigned cargo, including repeated OBD rows.
        if (storedRows.length) groups[key] = storedRows;
    }
    return groups;
}

export function isDeliveredAssignment(assignment) {
    const status = (assignment?.tripStatus || '').trim().toLowerCase();
    return status === 'completed' || (status === 'returning_to_base'
        && assignment.lineItems?.length > 0
        && assignment.lineItems.every(line => line.isPodCompleted === true));
}

export function assignmentDisplayStatus(assignment, sapRow) {
    const status = (assignment?.tripStatus || '').trim().toLowerCase();
    if (status === 'returning_to_base' && isDeliveredAssignment(assignment)) return 'Delivered / Returning to base';
    if (status === 'completed') return 'Delivered';
    return status ? status.replaceAll('_', ' ') : sapRow.PgiStatus || sapRow.CheckStatus || 'Pending';
}
