// Pure FIFO queue-ordering helper for SQL queue records.
//
// "Earliest" = the entry that has the smallest entryTime among queue entries
// that are eligible to take a new dispatch:
//   - truckType matches the dispatch's required type (case-insensitive trim)
//   - status !== 'complete'
//   - driver must exist in the doc map (caller provides; the queue entries
//     themselves carry their own truckType, so this is mainly a safety net)
//
// Ties on entryTime are broken deterministically by queue-entry document id
// (ascending), so the resolver is reproducible across calls.

function toMillis(value) {
    if (!value) return Number.POSITIVE_INFINITY;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (!isNaN(parsed)) return parsed;
    }
    // Accept timestamp shapes from legacy serialized queue records.
    if (typeof value === "object") {
        if (typeof value.toMillis === "function") return value.toMillis();
        if (typeof value.toDate === "function") return value.toDate().getTime();
        if (typeof value._seconds === "number") {
            const ns = typeof value._nanoseconds === "number" ? value._nanoseconds : 0;
            return value._seconds * 1000 + Math.floor(ns / 1e6);
        }
        if (typeof value.seconds === "number") {
            const ns = typeof value.nanoseconds === "number" ? value.nanoseconds : 0;
            return value.seconds * 1000 + Math.floor(ns / 1e6);
        }
    }
    return Number.POSITIVE_INFINITY;
}

function getEntryTimestamp(entry) {
    if (!entry) return Number.POSITIVE_INFINITY;
    const timeVal = entry.entryTime || entry.joinedAt || entry.createdAt || entry.updatedAt;
    return toMillis(timeVal);
}

function normalizeTruckType(t) {
    return (t == null ? "" : String(t)).trim().toLowerCase();
}

/**
 * Resolve the earliest eligible queue entry for a dispatch.
 *
 * @param {Array<object>} queueEntries - queue docs. Each must include:
 *   - id (string, required, used for tie-breaking)
 *   - entryTime (serialized timestamp, Date, number, or missing)
 *   - status (string, "complete" filters out)
 *   - truckType (string, matched against requiredTruckType)
 * @param {string} requiredTruckType - the dispatch's required truck type.
 * @returns {{ earliest: object|null, alternates: object[] }}
 *   - earliest: the single driver to assign (null if no eligible driver).
 *   - alternates: the rest, in FIFO order (for the UI to render disabled rows).
 */
function resolveEarliest(queueEntries, requiredTruckType) {
    const wanted = normalizeTruckType(requiredTruckType);

    const eligible = (queueEntries || []).filter((entry) => {
        if (!entry || !entry.id) return false;
        if (entry.status === "complete" || entry.status === "completed") return false;
        if (entry.isAssigned === true) return false;
        if (wanted && normalizeTruckType(entry.truckType) !== wanted) return false;
        return true;
    });

    eligible.sort((a, b) => {
        const ta = getEntryTimestamp(a);
        const tb = getEntryTimestamp(b);
        if (ta !== tb) return ta - tb;
        // Deterministic tie-break: ascending doc id.
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
    });

    if (eligible.length === 0) {
        return {earliest: null, alternates: []};
    }

    return {
        earliest: eligible[0],
        alternates: eligible.slice(1),
    };
}

/**
 * Validate that a given driver is the earliest eligible one.
 * Returns null on success, or a structured reason if rejected.
 *
 * @param {Array<object>} queueEntries
 * @param {string} requiredTruckType
 * @param {string} requestedDriverId
 * @returns {null | { code: string, meta: object }}
 */
function validateEarliest(queueEntries, requiredTruckType, requestedDriverId) {
    const {earliest} = resolveEarliest(queueEntries, requiredTruckType);

    if (!earliest) {
        return {
            code: "NO_DRIVERS_AVAILABLE",
            meta: {requiredTruckType},
        };
    }

    // The dispatcher may identify the driver by EITHER:
    //   - the queue record ID (`id`), OR
    //   - the driver's Auth UID (`driverId`, stored on the queue entry).
    // Match both so the FIFO check holds regardless of which shape the
    // client sends.
    const matchesEarliest = (entry, needle) =>
        entry && needle && (entry.id === needle || entry.driverId === needle);

    if (!matchesEarliest(earliest, requestedDriverId)) {
        return {
            code: "NOT_EARLIEST",
            meta: {
                earliestDriverId: earliest.id,
                earliestAuthUid: earliest.driverId || null,
                requestedDriverId,
            },
        };
    }

    return null;
}

module.exports = {resolveEarliest, validateEarliest};
