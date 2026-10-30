package com.sysu.go.model

/**
 * Represents a single shipment assignment for a driver.
 *
 * Used in the multi-shipment dashboard tabs (MainActivity) and the
 * Assignment screen (My Trip). One per sap_assignments document.
 *
 * @param docId  MySQL document ID of the sap_assignments entry — used as shipment number
 * @param queueId  MySQL document ID of the linked queue entry
 * @param driverId  account ID (from queue.driverId or session)
 * @param status  Queue status: waiting / called / assigned / loading / in_transit
 * @param tripStatus  Trip status from sap_assignments: assigned / loading / fully_loaded / loaded / in_transit / delivered / completed
 *                      ("assigned" is the explicit pre-loading state — replaces the older null/pending convention)
 * @param plateNumber  Resolved plate number (queue or sap field)
 * @param truckType  From queue.truckType
 * @param helper  From queue.helper / queue.helperName
 * @param guardVerified  True after guard signs and submits verification
 * @param guardFirstName  Guard's first name (populated after verification)
 * @param guardLastName  Guard's last name (populated after verification)
 * @param deliveryTimestamp  actualDelDate from sap_assignments (ms)
 * @param obdCount  Number of line items
 * @param requirements  Map of requirement keys → boolean (from drivers/{driverId}/requirements)
 * @param shipmentNumber  Display alias — returns obdNumber if set, else docId fallback
 * @param obdNumber        OBD number from sap_assignments.data.obdNumber — used in card subtitle
 */
data class Assignment(
    val docId: String,
    val queueId: String,
    val driverId: String,
    val status: String,
    val tripStatus: String?,
    val plateNumber: String,
    val truckType: String,
    val truckCompany: String = "",
    val helper: String,
    val guardVerified: Boolean,
    val driverConfirmed: Boolean = false,
    val guardFirstName: String = "",
    val guardLastName: String = "",
    val guardSignature: String = "",
    val guardMI: String = "",
    val guardVerifiedAtMs: Long = 0L,
    val deliveryTimestamp: Long = 0L,
    val obdCount: Int = 0,
    val requirements: Map<String, Boolean> = emptyMap(),
    /**
     * Raw OBD line items from sap_assignments.data.lineItems — used to
     * populate ObdItemsBottomSheet when user taps OBD Items card.
     */
    val lineItems: List<Map<String, Any>> = emptyList(),
    val obdNumber: String = "",
    /**
     * Shipment number as stored in the root sap_assignments document field.
     * Falls back to derived logic (obdNumber → docId) if blank.
     */
    val shipmentNumberRaw: String = ""
) {
    /** Returns shipment number: root SAP field → MySQL doc ID. Never falls back to OBD sub-item number. */
    val shipmentNumber: String get() =
        shipmentNumberRaw.ifBlank { docId }

    /** True if this shipment's docId matches the active in-transit shipment in SessionManager */
    fun isActive(sessionActiveDocId: String?): Boolean =
        tripStatus == "in_transit" && docId == sessionActiveDocId

    /** True if this shipment has locked START TRIP — another shipment is in transit.
     *  inTransitDocId = docId of the shipment with tripStatus == "in_transit", or null if none.
     *  Derived from MySQL state (not SharedPreferences) so lock is reliable even
     *  after the active trip's session has been cleared on end. */
    fun isLocked(inTransitDocId: String?): Boolean =
        inTransitDocId != null &&
        inTransitDocId != docId

    /** True if guard has verified and trip hasn't started yet — driver can tap START TRIP */
    val canStartTrip: Boolean get() = guardVerified && tripStatus != "in_transit" && tripStatus != "completed"

    /** True if guard verified but driver has NOT yet confirmed — enable CONFIRM SHIPMENT button */
    val canConfirmTrip: Boolean get() = guardVerified && !driverConfirmed && !isLocked(null) && tripStatus != "in_transit" && tripStatus != "completed"

    /** True if trip is in progress on THIS shipment */
    val isInTransit: Boolean get() = tripStatus == "in_transit"

    /** True if trip is completed */
    val isCompleted: Boolean get() = tripStatus == "completed"
    /** True if trip is returning to base (all PODs done, heading to warehouse) */
    val isReturningToBase: Boolean get() = tripStatus == "returning_to_base"
    /** True if this shipment's delivery is done but trip hasn't closed yet.
     *  Driver is free to start another shipment; this field only marks delivery completion. */
    val isDelivered: Boolean get() = tripStatus == "delivered"

    /** True if driver is actively loading cargo at the loading bay */
    val isLoading: Boolean get() = tripStatus == "loading"

    /** True if truck is physically fully loaded, awaiting guard verification */
    val isFullyLoaded: Boolean get() = tripStatus == "fully_loaded"

    /** True if guard has verified the loaded cargo — ready to start the trip */
    val isLoaded: Boolean get() = tripStatus == "loaded"

    /** True if this shipment has been assigned to the driver but loading hasn't started yet.
     *  Replaces the older null/pending convention — new docs write the explicit "assigned"
     *  string so the driver UI knows it's queued but not yet loading. */
    val isAssigned: Boolean get() = tripStatus == "assigned"

    /**
     * Returns true only when ALL line items have isPodCompleted == true.
     * Used to gate the END TRIP button — driver cannot end a trip until
     * every POD has been captured (delivered, rejected, or delivered+rejected).
     */
    val isPodComplete: Boolean get() =
        lineItems.isNotEmpty() && lineItems.all { (it["isPodCompleted"] as? Boolean) == true }
}
