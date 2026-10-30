package com.sysu.go.activities

import android.content.Intent
import android.content.res.ColorStateList
import androidx.core.content.res.ResourcesCompat
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.button.MaterialButton
import com.sysu.go.network.SocketManager
import com.sysu.go.R
import com.sysu.go.activities.SelectActiveTripBottomSheet
import com.sysu.go.adapter.AssignmentAdapter
import com.sysu.go.databinding.ActivityAssignmentBinding
import com.sysu.go.model.Assignment
import com.sysu.go.model.SecurityGuard
import com.sysu.go.repository.SecurityGuardRepository
import com.sysu.go.utils.SessionManager
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * MY ASSIGNMENTS - shows all of the driver's shipments in a single scrollable list.
 *
 * Top bar: "MY ASSIGNMENTS" + aggregate verification badge (green "All Verified" /
 * amber "X Pending").
 * Red banner: bouncing circles + pulse rings (same animation as MainActivity).
 * RecyclerView: one AssignmentCard per shipment, each showing all detail fields.
 * Each card's btnTripAction opens a guard verification flow or launches TransitActivity.
 *
 * Assignment records are loaded from the MySQL API so badges
 * and card states update live.
 */
class AssignmentActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAssignmentBinding
    private val sessionManager by lazy { SessionManager(this) }

    //  Current list of assignments shown in rvAssignments
    private var assignments: List<Assignment> = emptyList()

    //  Requirements snapshot loaded from the authenticated MySQL driver profile.
    private var requirementsSnapshot: Map<String, Boolean> = emptyMap()

    //  Socket/API subscriptions are released in onDestroy.
    private var assignmentsListener: (() -> Unit)? = null
    private var hasLoadedAssignments = false
    private val securityGuardRepository by lazy { SecurityGuardRepository(this, sessionManager.getDriverId()) }
    private var securityGuardSubscription: (() -> Unit)? = null
    private var hasReceivedGuardSnapshot = false
    private var guardSelectionSheet: GuardSelectionBottomSheet? = null

    //  Bouncing circles
    private val circleAnimators = mutableListOf<android.animation.Animator>()
    private val circleViews = mutableListOf<View>()
    private var aggregateDotPulse: android.animation.ObjectAnimator? = null

    companion object {
        private const val TAG = "AssignmentActivity"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        binding = ActivityAssignmentBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }

        setupRecyclerView()
        setupUI()
        startCircleAnimation()
        startPulseRings()
    }

    override fun onResume() {
        super.onResume()
        loadRequirements()
        loadAssignments()
    }

    override fun onStart() {
        super.onStart()
        if (securityGuardSubscription == null) {
            hasReceivedGuardSnapshot = false
            securityGuardSubscription = SocketManager.subscribeRealtime(
                topic = "securityGuards",
                onData = { data ->
                    val guards = securityGuardRepository.updateFromRealtime(data)
                    if (guards == null) {
                        Log.w(TAG, "Ignoring invalid security-guard snapshot")
                    } else {
                        hasReceivedGuardSnapshot = true
                        guardSelectionSheet?.updateGuards(guards, selectionEnabled = SocketManager.isConnected())
                    }
                },
                onError = {
                    Log.w(TAG, "Security guard realtime snapshot unavailable: $it")
                    com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@AssignmentActivity, "guard-subscription")
                },
            )
        }
    }

    override fun onStop() {
        securityGuardSubscription?.invoke()
        securityGuardSubscription = null
        super.onStop()
    }

    override fun onDestroy() {
        super.onDestroy()
        circleAnimators.forEach { it.cancel() }
        circleAnimators.clear()
        circleViews.forEach { binding.circleContainer.removeView(it) }
        circleViews.clear()
        assignmentsListener?.invoke()
    }

    private fun setupRecyclerView() {
        val adapter = AssignmentAdapter(
            onTripActionClick = { assignment -> onAssignmentAction(assignment) },
            onGuardPillTap = { assignment -> openGuardVerification(assignment) },
            onObdTap = { assignment -> openObdBottomSheet(assignment) },
            onVerificationAction = { assignment, guardVerified ->
                if (guardVerified) showGuardVerificationSheet(assignment)
                else openGuardVerification(assignment)
            },
            onCancelLoading = { assignment -> cancelLoading(assignment) },
            onCancelVerification = { assignment -> cancelVerification(assignment) }
        )

        binding.rvAssignments.apply {
            layoutManager = LinearLayoutManager(this@AssignmentActivity)
            this.adapter = adapter
            overScrollMode = androidx.recyclerview.widget.RecyclerView.OVER_SCROLL_ALWAYS
            itemAnimator = androidx.recyclerview.widget.DefaultItemAnimator().apply {
                addDuration = 200
                removeDuration = 200
                moveDuration = 200
                changeDuration = 200
            }
        }
    }

    private fun setupUI() {
        binding.btnBack.setOnClickListener { finish() }
        binding.btnBatchConfirm.setOnClickListener {
            openBatchConfirmationSheet()
        }
        binding.bottomBatchBar.setOnClickListener {
            openBatchConfirmationSheet()
        }
    }

    /**
     * Handles the action button on an assignment card.
     * Delegates to same AlertDialog / performStartTrip flow from the old screen.
     */
    private fun onAssignmentAction(assignment: Assignment) {
        //  Derive the active-trip lock from the current assignment response.
        //  Survives session clear when the active trip ends (clearTripSession nulls activeSapDocId).
        val inTransitDocId: String? = assignments.firstOrNull { it.isInTransit }?.docId
        android.util.Log.d(TAG, "onAssignmentAction: docId=${assignment.docId} tripStatus=${assignment.tripStatus} isLocked=${assignment.isLocked(inTransitDocId)}")
        when {
            //  Loading state machine
            //  Must come BEFORE canConfirmTrip to ensure the linear flow
            //  Flow: pending -> loading -> fully_loaded -> guard verification -> loaded

            assignment.isLoading -> {
                //  Already loading ? confirm FULLY LOADED
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_shipping)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Fully Loaded?"
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Is shipment ${assignment.shipmentNumber} completely loaded?"
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                    text = "Yes, Fully Loaded"
                    backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@AssignmentActivity, R.color.sysu_blue))
                    setOnClickListener { dialog.dismiss(); lifecycleScope.launch {
                        try {
                            val idx = assignments.indexOfFirst { it.docId == assignment.docId }
                            if (idx >= 0) {
                                assignments = assignments.toMutableList().apply {
                                    set(idx, assignments[idx].copy(tripStatus = "fully_loaded"))
                                }
                                submitToAdapter(assignments)
                                updateAggregateBadge(assignments)
                            }
                            withContext(kotlinx.coroutines.Dispatchers.IO) {
                                com.sysu.go.network.AssignmentApiService.update(
                                    this@AssignmentActivity, assignment.docId, mapOf("status" to "fully_loaded")
                                )
                            }
                            com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                                this@AssignmentActivity, "fully_loaded", subjectId = assignment.docId,
                                idempotencyKey = "fully-loaded:${assignment.docId}"
                            )
                            Log.d(TAG, "FULLY_LOADED: ${assignment.docId}")
                        } catch (e: Exception) {
                            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "shipment-state-transition", e)
                            Log.e(TAG, "FULLY_LOADED error: ${e.message}")
                        }
                    }}
                }
                dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
                dialog.show()
            }

            assignment.isFullyLoaded && assignment.guardVerified -> {
                //  Guard already verified ? open central batch confirmation sheet
                openBatchConfirmationSheet()
            }

            assignment.isFullyLoaded -> {
                //  Fully loaded but guard has NOT verified yet ? open guard flow (gate allows fully_loaded)
                openGuardVerification(assignment)
            }

            assignment.isLoaded || assignment.canConfirmTrip -> {
                //  Kung confirmed na, ipakita agad ang floating tab para pumili ng active trip
                if (assignment.driverConfirmed) {
                    val readyToStart = assignments.filter { it.tripStatus == "loaded" && it.driverConfirmed }
                    showSelectActiveTripSheet(readyToStart)
                } else {
                    //  Kung hindi pa confirmed, open batch confirmation sheet
                    openBatchConfirmationSheet()
                }
            }

            //  Existing terminal and active states
            assignment.isCompleted -> {
                Toast.makeText(this, "Tapos na ang biyahe na ito", Toast.LENGTH_SHORT).show()
            }

            assignment.isInTransit -> {
                launchGeneralTrackingActivity(assignment.docId)
            }

            assignment.driverConfirmed -> {
                android.util.Log.d(TAG, " ? driverConfirmed branch: showing toast")
                Toast.makeText(this, "Handa na ang shipment. Naghihintay mag-start ng biyahe.", Toast.LENGTH_SHORT).show()
            }

            assignment.isLocked(inTransitDocId) -> {
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_info, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_alert)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = getString(R.string.locked_has_active_trip_title)
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = getString(R.string.locked_has_active_trip_msg)
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener { dialog.dismiss() }
                dialog.show()
            }

            //  Pending assignments can start the loading flow.
            else -> {
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_shipping)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Start Loading?"
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Are you sure you want to start loading shipment ${assignment.shipmentNumber}?"
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                    text = "Start Loading"
                    backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@AssignmentActivity, R.color.sysu_red))
                    setOnClickListener { dialog.dismiss(); lifecycleScope.launch {
                        try {
                            val idx = assignments.indexOfFirst { it.docId == assignment.docId }
                            if (idx >= 0) {
                                assignments = assignments.toMutableList().apply {
                                    set(idx, assignments[idx].copy(tripStatus = "loading"))
                                }
                                submitToAdapter(assignments)
                                updateAggregateBadge(assignments)
                            }
                            withContext(kotlinx.coroutines.Dispatchers.IO) {
                                com.sysu.go.network.AssignmentApiService.update(
                                    this@AssignmentActivity, assignment.docId, mapOf("status" to "loading")
                                )
                            }
                            com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                                this@AssignmentActivity, "loading_started", subjectId = assignment.docId,
                                idempotencyKey = "loading:${assignment.docId}"
                            )
                            Log.d(TAG, "START_LOADING: ${assignment.docId}")
                        } catch (e: Exception) {
                            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "shipment-state-transition", e)
                            Log.e(TAG, "START_LOADING error: ${e.message}")
                        }
                    }}
                }
                dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
                dialog.show()
            }
        }
    }

    private fun cancelLoading(assignment: Assignment) {
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_destructive)
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Cancel Loading?"
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Revert shipment ${assignment.shipmentNumber} back to pending and cancel loading?"
        val dialog = AlertDialog.Builder(this).setView(dlgView).create()
        dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
            text = "Yes, Cancel"
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@AssignmentActivity, R.color.sysu_red))
            setOnClickListener { dialog.dismiss(); lifecycleScope.launch {
                try {
                    //  Optimistic UI update ? card instantly reverts to pending
                    val idx = assignments.indexOfFirst { it.docId == assignment.docId }
                    if (idx >= 0) {
                        assignments = assignments.toMutableList().apply {
                                    set(idx, assignments[idx].copy(tripStatus = "assigned"))
                        }
                        submitToAdapter(assignments)
                        updateAggregateBadge(assignments)
                    }
                    withContext(kotlinx.coroutines.Dispatchers.IO) {
                        com.sysu.go.network.AssignmentApiService.update(
                            this@AssignmentActivity, assignment.docId, mapOf("status" to null)
                        )
                    }
                    com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                        this@AssignmentActivity, "loading_cancelled", subjectId = assignment.docId,
                        metadata = org.json.JSONObject().put("phase", "loading"),
                    )
                    Log.d(TAG, "CANCEL_LOADING: ${assignment.docId}")
                } catch (e: Exception) {
                    com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "shipment-state-transition", e)
                    Log.e(TAG, "CANCEL_LOADING error: ${e.message}")
                }
            }}
        }
        dlgView.findViewById<MaterialButton>(R.id.btnCancel).apply {
            text = "Keep Loading"
            setOnClickListener { dialog.dismiss() }
        }
        dialog.show()
    }

    /**
     * Reverts shipment from fully_loaded back to loading state.
     * Undoes the "VERIFY WITH GUARD" state ? btnTripAction goes back to FULLY LOADED.
     */
    private fun cancelVerification(assignment: Assignment) {
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_alert)
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Cancel Verification?"
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Revert shipment ${assignment.shipmentNumber} back to loading? The FULLY LOADED button will reappear."
        val dialog = AlertDialog.Builder(this).setView(dlgView).create()
        dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
            text = "Yes, Revert"
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@AssignmentActivity, R.color.sysu_amber))
            setOnClickListener { dialog.dismiss(); lifecycleScope.launch {
                try {
                    val idx = assignments.indexOfFirst { it.docId == assignment.docId }
                    if (idx >= 0) {
                        assignments = assignments.toMutableList().apply {
                            set(idx, assignments[idx].copy(tripStatus = "loading"))
                        }
                        submitToAdapter(assignments)
                        updateAggregateBadge(assignments)
                    }
                    withContext(kotlinx.coroutines.Dispatchers.IO) {
                        com.sysu.go.network.AssignmentApiService.update(
                            this@AssignmentActivity,
                            assignment.docId,
                            mapOf(
                                "status" to "loading",
                                "guardVerified" to false,
                                "guardFirstName" to "",
                                "guardLastName" to "",
                                "guardMI" to "",
                                "guardSignatureBase64" to "",
                            ),
                        )
                    }
                    com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                        this@AssignmentActivity, "verification_cancelled", subjectId = assignment.docId,
                    )
                    Log.d(TAG, "CANCEL_VERIFICATION: ${assignment.docId} ? loading (guard data reset)")
                } catch (e: Exception) {
                    com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "guard-verification", e)
                    Log.e(TAG, "CANCEL_VERIFICATION error: ${e.message}")
                }
            }}
        }
        dlgView.findViewById<MaterialButton>(R.id.btnCancel).apply {
            text = "Keep"
            setOnClickListener { dialog.dismiss() }
        }
        dialog.show()
    }

    private fun openGuardVerification(assignment: Assignment) {
        //  Guard verification is only allowed after the truck is fully loaded.
        //  The guard must inspect a completely loaded truck before signing off.
        //  Any other status (pending, loading) means the truck isn't ready yet.
        if (assignment.tripStatus != "fully_loaded") {
            Toast.makeText(
                this@AssignmentActivity,
                "Fully loaded muna ang shipment. I-tap ang 'FULLY LOADED' bago mag-guard verification.",
                Toast.LENGTH_SHORT
            ).show()
            return
        }
        val snapshot = securityGuardRepository.getCachedSnapshot()
        val guards = snapshot?.guards.orEmpty()
        val selectionEnabled = SocketManager.isConnected() && hasReceivedGuardSnapshot
        if (guards.isEmpty()) {
            val message = if (hasReceivedGuardSnapshot) "Walang available na guard" else "Nagsi-sync pa ang guards. Subukan muli sa ilang sandali."
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
            return
        }

        val savedListMessage = snapshot?.let {
            val updatedAt = java.text.SimpleDateFormat("MMM d, yyyy h:mm a", java.util.Locale.getDefault()).apply {
                timeZone = java.util.TimeZone.getTimeZone("Asia/Manila")
            }.format(java.util.Date(it.updatedAtMillis))
            "Saved list · last updated $updatedAt. Connect and wait for the live list to verify."
        }

        //  Step 1: Guard selection
        guardSelectionSheet = GuardSelectionBottomSheet.newInstance(
            guards,
            selectionEnabled,
            if (selectionEnabled) null else savedListMessage,
        ) { guard ->
            //  Step 2: Open signature pad
            SignaturePadBottomSheet().apply {
                onSignatureConfirmed = { signatureBase64 ->
                    submitGuardVerification(assignment, guard, signatureBase64)
                }
            }.show(supportFragmentManager, SignaturePadBottomSheet.TAG)
        }
        guardSelectionSheet?.show(supportFragmentManager, GuardSelectionBottomSheet.TAG)
    }

    private fun submitGuardVerification(
        assignment: Assignment,
        guard: SecurityGuard,
        signatureBase64: String
    ) {
        //  Step 3: Show verification result sheet with Submit button
        val verifiedAt = System.currentTimeMillis()
        GuardVerificationBottomSheet.newInstance(
            firstName = guard.firstName,
            lastName = guard.lastName,
            mi = guard.middleInitial,
            signature = signatureBase64,
            verifiedAt = verifiedAt
        ).apply {
            onSubmitConfirmed = {
                saveGuardVerification(assignment, guard, signatureBase64)
            }
        }.show(supportFragmentManager, GuardVerificationBottomSheet.TAG)
    }

    private fun saveGuardVerification(
        assignment: Assignment,
        guard: SecurityGuard,
        signatureBase64: String
    ) {
        lifecycleScope.launch {
            try {
                val promoteToLoaded = assignment.tripStatus == "fully_loaded"
                val updates = mutableMapOf<String, Any?>(
                    "guardVerified" to true,
                    "guardFirstName" to guard.firstName,
                    "guardLastName" to guard.lastName,
                    "guardMI" to guard.middleInitial,
                    "guardSignatureBase64" to signatureBase64,
                )
                if (promoteToLoaded) {
                    updates["status"] = "loaded"
                }
                withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.update(this@AssignmentActivity, assignment.docId, updates)
                }
                Log.d(TAG, "Guard verification saved for ${assignment.docId}")
                com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                    this@AssignmentActivity, "guard_verified", subjectId = assignment.docId,
                    idempotencyKey = "guard-verified:${assignment.docId}"
                )
                val idx = assignments.indexOfFirst { it.docId == assignment.docId }
                if (idx >= 0) {
                    assignments = assignments.toMutableList().apply {
                        set(idx, assignments[idx].copy(
                            tripStatus = if (promoteToLoaded) "loaded" else assignments[idx].tripStatus,
                            guardVerified = true,
                            guardFirstName = guard.firstName,
                            guardLastName = guard.lastName,
                            guardMI = guard.middleInitial,
                        ))
                    }
                    submitToAdapter(assignments)
                    updateAggregateBadge(assignments)
                }
                Toast.makeText(this@AssignmentActivity, "Guard verification complete!", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "guard-verification", e)
                Log.e(TAG, "saveGuardVerification error: ${e.message}")
                Toast.makeText(this@AssignmentActivity, "Verification failed. Try again.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * Re-opens GuardVerificationBottomSheet for an already-verified assignment.
     * Shows guard name, signature, and timestamp from the assignment response.
     */
    private fun showGuardVerificationSheet(assignment: Assignment) {
        lifecycleScope.launch {
            try {
                val firstName = assignment.guardFirstName
                val lastName = assignment.guardLastName
                val mi = assignment.guardMI
                val sigBase64 = assignment.guardSignature
                val verifiedAt = assignment.guardVerifiedAtMs

                GuardVerificationBottomSheet.newInstance(
                    firstName = firstName,
                    lastName  = lastName,
                    mi        = mi,
                    signature = sigBase64,
                    verifiedAt = verifiedAt
                ).apply {
                    onSubmitConfirmed = { }  // read-only after submission
                }.show(supportFragmentManager, GuardVerificationBottomSheet.TAG)
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "guard-verification", e)
                Log.e(TAG, "showGuardVerificationSheet error: ${e.message}")
                Toast.makeText(this@AssignmentActivity, "Hindi ma-load ang detalye ng beripikasyon", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun performStartTrip(assignment: Assignment) {
        val docId = assignment.docId
        com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
            this, "active_shipment_selected", subjectId = docId
        )
        com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
            this, "trip_confirmation", subjectId = docId, outcome = "requested",
            metadata = org.json.JSONObject().put("phase", "start_trip")
        )
        sessionManager.saveActiveSapDocId(docId)
        sessionManager.saveCurrentSapDocId(docId)
        sessionManager.setTripActive(true)

        lifecycleScope.launch {
            try {
                withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.update(
                        this@AssignmentActivity, docId, mapOf("status" to "in_transit")
                    )
                }
                Log.d(TAG, "Trip started: $docId")
                com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                    this@AssignmentActivity, "transit_started", subjectId = docId,
                    idempotencyKey = "transit-started:$docId"
                )
                launchGeneralTrackingActivity(docId)
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "trip-start", e)
                Log.e(TAG, "startTrip error: ${e.message}")
                sessionManager.saveActiveSapDocId(null)
                sessionManager.clearCurrentSapDocId()
                sessionManager.setTripActive(false)
                Toast.makeText(this@AssignmentActivity, "Failed to start trip. Check connection.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * Opens the floating tab (Bottom Sheet) to select which loaded & confirmed
     * shipment will be activated (tripStatus -> "in_transit").
     */
    private fun showSelectActiveTripSheet(readyToStart: List<Assignment>) {
        SelectActiveTripBottomSheet.newInstance(readyToStart).apply {
            onTripSelected = { selectedAssignment ->
                //  I-a-activate ang pinili na shipment (papalitan ang tripStatus to "in_transit")
                performStartTrip(selectedAssignment)
            }
        }.show(supportFragmentManager, SelectActiveTripBottomSheet.TAG)
    }

    /**
     * Sets driverConfirmed = true for this shipment.
     * Does NOT start the trip or launch TransitActivity ? that happens
     * when MainActivity CTA is tapped after ALL shipments are confirmed.
     */
    private fun confirmShipment(assignment: Assignment) {
        lifecycleScope.launch {
            try {
                withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.update(
                        this@AssignmentActivity, assignment.docId, mapOf("driverConfirmed" to true)
                    )
                }
                Log.d(TAG, "Shipment confirmed: ${assignment.docId}")
                sessionManager.savePendingConfirmedDocId(assignment.docId)
                val idx = assignments.indexOfFirst { it.docId == assignment.docId }
                if (idx >= 0) {
                    assignments = assignments.toMutableList().apply {
                        set(idx, assignments[idx].copy(driverConfirmed = true))
                    }
                    submitToAdapter(assignments)
                    updateAggregateBadge(assignments)
                }
                Toast.makeText(this@AssignmentActivity, R.string.confirm_shipment_toast, Toast.LENGTH_SHORT).show()
                finish()
            } catch (e: Exception) {
                Log.e(TAG, "confirmShipment failed: ${e.message}")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "shipment-state-transition", e)
            }
        }
    }

    /**
     * Opens the interactive bottom sheet for batch shipment confirmation.
     * Shows a Select All toggle and individual checkboxes for each shipment.
     */
    private fun openBatchConfirmationSheet() {
        if (assignments.isEmpty()) {
            Toast.makeText(this, "Walang shipments na ikukumpirma.", Toast.LENGTH_SHORT).show()
            return
        }

        ConfirmShipmentsBottomSheet.newInstance(assignments).apply {
            onConfirmationsSaved = { selectedDocIds, allConfirmed ->
                saveBatchConfirmations(selectedDocIds, allConfirmed)
            }
        }.show(supportFragmentManager, ConfirmShipmentsBottomSheet.TAG)
    }

    /**
     * Updates the driver's confirmation through the assignments API.
     * based on driver's selection in the bottom sheet.
     * If all are confirmed, finishes activity to take driver to MainActivity.
     */
    private fun saveBatchConfirmations(selectedDocIds: Set<String>, allConfirmed: Boolean) {
        if (selectedDocIds.isEmpty()) return

        lifecycleScope.launch {
            try {
                withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.confirm(this@AssignmentActivity, selectedDocIds)
                }
                Log.d(TAG, "Batch confirmed ${selectedDocIds.size} shipments successfully")
                selectedDocIds.firstOrNull()?.let { sessionManager.savePendingConfirmedDocId(it) }
                assignments = assignments.map { assignment ->
                    if (selectedDocIds.contains(assignment.docId)) assignment.copy(driverConfirmed = true) else assignment
                }
                submitToAdapter(assignments)
                updateAggregateBadge(assignments)
                if (allConfirmed) {
                    Toast.makeText(this@AssignmentActivity, "Lahat ng shipments ay kumpirmado na! Handa na mag-Start Trip.", Toast.LENGTH_LONG).show()
                    finish()
                } else {
                    Toast.makeText(this@AssignmentActivity, "Na-kumpirma ang ${selectedDocIds.size} sa ${assignments.size} shipments.", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Batch confirm failed: ${e.message}")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@AssignmentActivity, "shipment-state-transition", e)
            }
        }
    }

    private fun updateBatchBarUI(list: List<Assignment>) {
        if (list.isEmpty()) {
            binding.bottomBatchBar.visibility = View.GONE
            return
        }

        //  I-filter lang yung mga shipment na "loaded" at "driverConfirmed"
        val readyToStart = list.filter { it.tripStatus == "loaded" && it.driverConfirmed }

        if (readyToStart.isEmpty()) {
            binding.bottomBatchBar.visibility = View.GONE
            return
        }

        //  Ipakita ang floating bottom bar
        binding.bottomBatchBar.visibility = View.VISIBLE
        binding.tvBatchStatus.text = "Handa na mag-Start Trip"
        binding.tvBatchSubtext.text = "Piliin ang shipment na i-aactivate"
        binding.btnBatchConfirm.text = "Piliin ang Active Trip"
        binding.btnBatchConfirm.backgroundTintList = ColorStateList.valueOf(
            ContextCompat.getColor(this, R.color.sysu_red)
        )

        //  Kapag tinap, bubuksan ang Floating Tab (Bottom Sheet)
        binding.btnBatchConfirm.setOnClickListener {
            showSelectActiveTripSheet(readyToStart)
        }
    }

    private fun launchGeneralTrackingActivity(sapDocId: String) {
        sessionManager.saveCurrentSapDocId(sapDocId)
        val intent = Intent(this, GeneralTrackingActivity::class.java).apply {
            putExtra("shipment_doc_id", sapDocId)
        }
        startActivity(intent)
    }

    /**
     * Loads all assignment records for this driver from the API.
     *
     * Single-approach pattern: sap_assignments.driverId always stores the driver ID
     * (NOT the queue doc id). The legacy "try queueDocId first, fallback to UID" was
     * retired when the data schema was migrated. Trip-status filtering is done
     * client-side because the assignment API does not expose this filter.
     */
    private fun loadAssignments() {
        assignmentsListener?.invoke()
        val sessionDriverId = sessionManager.getDriverId() ?: return
        if (!hasLoadedAssignments) {
            binding.loadingSkeleton.root.visibility = View.VISIBLE
            binding.rvAssignments.visibility = View.GONE
            binding.emptyState.visibility = View.GONE
        }
        binding.tvLoadError.visibility = View.GONE
        SocketManager.connect(this)

        assignmentsListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
                val records = payload as? List<*> ?: return@subscribeRealtime
                if (isFinishing) return@subscribeRealtime

                //  Client-side filter: exclude terminal trip states so they don't show
                //  as active cards. (Completed/delivered docs still exist for history.)
                val active = records.mapNotNull { it as? Map<String, Any?> }.filter { doc ->
                    val s = doc["tripStatus"] as? String
                    s != "completed" && s != "delivered" &&
                        com.sysu.go.model.QueueShipmentPolicy.isCurrentShipment(
                            s, doc["returnStatus"] as? String, doc["queueId"] as? String,
                            sessionManager.getCurrentQueueDocId(), "assigned"
                        )
                }

                val list = active.mapNotNull { record -> buildAssignment(record) }
                hasLoadedAssignments = true
                binding.loadingSkeleton.root.visibility = View.GONE
                assignments = list
                submitToAdapter(list)
                updateAggregateBadge(list)
            }, onError = { error ->
                Log.e(TAG, "loadAssignments realtime error: $error")
                com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@AssignmentActivity, "assignment-subscription")
                if (!hasLoadedAssignments && !isFinishing) {
                    binding.loadingSkeleton.root.visibility = View.GONE
                    binding.tvLoadError.visibility = View.VISIBLE
                }
            })
    }

    /**
     * Loads driver-level requirements once per resume.
     * Stored as a Map field DIRECTLY inside drivers/{driverId} (NOT a subcollection).
     * Stamped into every assignment built while this Activity lives.
     */
    private fun loadRequirements() {
        lifecycleScope.launch {
            val loaded = runCatching {
                withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.sysu.go.network.DriverProfileApiService.getOwn(this@AssignmentActivity).requirements
                }
            }.getOrElse { error ->
                Log.w(TAG, "Driver requirements unavailable: ${error.message}")
                emptyMap()
            }
            if (isFinishing) return@launch
            requirementsSnapshot = loaded
            if (assignments.isNotEmpty()) {
                val updated = assignments.map { it.copy(requirements = loaded) }
                assignments = updated
                submitToAdapter(updated)
            }
        }
    }
    /**
     * Opens ObdItemsBottomSheet for the tapped assignment's line items.
     */
    private fun openObdBottomSheet(assignment: Assignment) {
        if (assignment.lineItems.isEmpty()) {
            Toast.makeText(this, "Walang available na OBD items", Toast.LENGTH_SHORT).show()
            return
        }

        if (assignment.isInTransit) {
            //  In-transit shipment ? each completed row navigates to QueueDetailsActivity
            ObdItemsBottomSheet.newInstance(
                lineItems = assignment.lineItems,
                shipmentDocId = assignment.docId,
                rowLayoutType = RowLayoutType.DETAIL,
                podCaptureEnabled = false,  // read-only view of OBD items
                onItemClick = { item ->
                    val intent = Intent(this, QueueDetailsActivity::class.java)
                    intent.putExtra("shipment_doc_id", assignment.docId)
                    startActivity(intent)
                },
                onObdCameraTap = null
            ).show(supportFragmentManager, ObdItemsBottomSheet::class.java.simpleName)
        } else {
            //  Pre-transit ? read-only view of all OBD items
            ObdItemsBottomSheet.newInstance(
                lineItems = assignment.lineItems,
                shipmentDocId = assignment.docId,
                rowLayoutType = RowLayoutType.DETAIL,
                podCaptureEnabled = false,  // read-only
                onItemClick = null,
                onObdCameraTap = null
            ).show(supportFragmentManager, ObdItemsBottomSheet::class.java.simpleName)
        }
    }

    private fun buildAssignment(snap: Map<String, Any?>): Assignment {
        val queueId = snap["queueId"] as? String ?: ""

        val tripStatus = snap["tripStatus"] as? String
        val guardVerified = snap["guardVerified"] as? Boolean ?: false
        val driverConfirmed = snap["driverConfirmed"] as? Boolean ?: false
        val guardFirstName = snap["guardFirstName"] as? String ?: ""
        val guardLastName = snap["guardLastName"] as? String ?: ""
        val guardMI = snap["guardMI"] as? String ?: ""
        val guardSignature = snap["guardSignatureBase64"] as? String ?: snap["guardSignature"] as? String ?: ""
        val guardVerifiedAtMs = when (val raw = snap["guardVerifiedAt"]) {
            is Number -> raw.toLong()
            is Map<*, *> -> (raw["\$timestamp"] as? Number)?.toLong() ?: 0L
            else -> 0L
        }

        //  Extract shipmentNumber from ROOT document field (SAP field), not from lineItems
        val shipmentNumberRaw = snap["shipmentNumber"] as? String ?: ""

        //  lineItems[0].actualDelDate ? OData format "/Date(millis)/"
        val lineItems = snap["lineItems"] as? List<*> ?: emptyList<Any>()
        val firstItem = lineItems.filterIsInstance<Map<String, Any?>>().firstOrNull()
        val delTsRaw = firstItem?.get("actualDelDate") as? String
        val deliveryTs = try {
            delTsRaw?.removePrefix("/Date(")?.removeSuffix(")/")?.toLong() ?: 0L
        } catch (e: Exception) { 0L }

        val obdCount = lineItems.filterIsInstance<Map<String, Any?>>().size
        val obdNumber = firstItem?.get("obdNumber") as? String ?: ""

        return Assignment(
            docId = snap["id"] as? String ?: "",
            queueId = queueId,
            driverId = sessionManager.getDriverId() ?: "",
            status = snap["status"] as? String ?: "",
            tripStatus = tripStatus,
            plateNumber = snap["truckPlate"] as? String ?: "",
            truckType = snap["truckType"] as? String ?: "",
            truckCompany = snap["truckCompany"] as? String ?: "",
            helper = snap["helperName"] as? String ?: "",
            guardVerified = guardVerified,
            driverConfirmed = driverConfirmed,
            guardFirstName = guardFirstName,
            guardLastName = guardLastName,
            guardSignature = guardSignature,
            guardMI = guardMI,
            guardVerifiedAtMs = guardVerifiedAtMs,
            deliveryTimestamp = deliveryTs,
            obdCount = obdCount,
            requirements = requirementsSnapshot,
            lineItems = lineItems.filterIsInstance<Map<String, Any?>>() as List<Map<String, Any>>,
            obdNumber = obdNumber,
            shipmentNumberRaw = shipmentNumberRaw
        )
    }

    private fun submitToAdapter(list: List<Assignment>) {
        //  Only lock a shipment if activeSapDocId is NOT stale.
        //  Require the shipment in the current list and an in_transit status.
        //  Prevents stale SharedPreferences from locking cards from past sessions.
        val rawActiveId = sessionManager.getActiveSapDocId()

        //  If the stored session docId is no longer backed by any in-transit shipment,
        //  clear it ? it came from a cancelled/aborted past trip. This ensures
        //  stale sessions from past trips never lock current pre-confirmation cards.
        val effectiveActiveId = if (rawActiveId != null && !list.any { it.docId == rawActiveId && it.isInTransit }) {
            sessionManager.saveActiveSapDocId(null)
            null
        } else {
            rawActiveId
        }

        //  Find which shipment currently has tripStatus == "in_transit".
        //  Used to lock all other confirmed shipments while a trip is active.
        //  This is the source-of-truth ? not SharedPreferences ? so the lock is Reliable
        //  even after the active trip's session is cleared on end.
        val inTransitDocId: String? = list.firstOrNull { it.isInTransit }?.docId

        val adapter = (binding.rvAssignments.adapter as? AssignmentAdapter)
            ?: AssignmentAdapter(
                onTripActionClick = { assignment -> onAssignmentAction(assignment) },
                onGuardPillTap = { assignment -> openGuardVerification(assignment) },
                onObdTap = { assignment -> openObdBottomSheet(assignment) },
                onVerificationAction = { assignment, guardVerified ->
                    if (guardVerified) showGuardVerificationSheet(assignment)
                    else openGuardVerification(assignment)
                },
                onCancelLoading = { assignment -> cancelLoading(assignment) },
            onCancelVerification = { assignment -> cancelVerification(assignment) }
            ).also { binding.rvAssignments.adapter = it }

        //  Refresh the active assignment ID so bind() uses the current value.
        adapter.sessionActiveDocId = inTransitDocId
        adapter.submitList(list.toList())

        if (list.isEmpty()) {
            binding.rvAssignments.visibility = View.GONE
            binding.emptyState.visibility = View.VISIBLE
        } else {
            binding.rvAssignments.visibility = View.VISIBLE
            binding.emptyState.visibility = View.GONE
        }

        //  Second pass: load queue doc for truckType / helper / plateNumber
        //  The SQL assignment snapshot already contains the canonical truck fields.
    }

    /**
     * Updates both header badge views:
     * - Top bar pill (aggregateBadgeContainer / tvAggregateBadge)
     * - Red banner pill (badgeDot / tvBadgeText)
     */
    private fun updateAggregateBadge(list: List<Assignment>) {
        updateBatchBarUI(list)
        if (list.isEmpty()) {
            binding.aggregateBadgeContainer.visibility = View.GONE
            binding.badgeVerified.visibility = View.GONE
            return
        }
        binding.aggregateBadgeContainer.visibility = View.VISIBLE
        binding.badgeVerified.visibility = View.VISIBLE

        val pendingCount = list.count { !it.guardVerified }
        if (pendingCount == 0) {
            //  Stop dot pulse
            aggregateDotPulse?.cancel()
            aggregateDotPulse = null
            binding.aggregateBadgeContainer.setBackgroundResource(R.drawable.bg_status_pill_green)
            binding.aggregateBadgeDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            binding.aggregateBadgeDot.alpha = 1f
            binding.tvAggregateBadge.text = getString(R.string.assignment_badge_all_verified)
            binding.tvAggregateBadge.setTextColor(ContextCompat.getColor(this, R.color.white))
            binding.tvAggregateBadge.setTypeface(ResourcesCompat.getFont(this, R.font.atkinson_hyperlegible_regular))
            binding.badgeVerified.setBackgroundResource(R.drawable.bg_status_pill_green)
            binding.badgeDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            binding.tvBadgeText.text = getString(R.string.assignment_badge_all_verified)
        } else {
            //  Aggregate badge ? transparent bg, bold orange text + pulsing dot
            binding.aggregateBadgeContainer.setBackgroundResource(R.drawable.bg_status_pill_queued)
            binding.aggregateBadgeDot.setBackgroundResource(R.drawable.bg_status_dot_gold)
            binding.tvAggregateBadge.text = getString(R.string.assignment_badge_pending)
            binding.tvAggregateBadge.setTextColor(ContextCompat.getColor(this, R.color.sysu_amber))
            binding.tvAggregateBadge.setTypeface(ResourcesCompat.getFont(this, R.font.atkinson_hyperlegible_bold))
            //  Pulsing glow dot
            if (aggregateDotPulse == null) {
                aggregateDotPulse = android.animation.ObjectAnimator.ofFloat(binding.aggregateBadgeDot, "alpha", 0.35f, 1f).apply {
                    duration = 900L
                    repeatMode = android.animation.ObjectAnimator.REVERSE
                    repeatCount = android.animation.ValueAnimator.INFINITE
                    interpolator = android.view.animation.AccelerateDecelerateInterpolator()
                    start()
                }
            }
            //  Banner badge ? solid orange pill on red (white text)
            binding.badgeVerified.setBackgroundResource(R.drawable.bg_status_pill_orange)
            binding.badgeDot.setBackgroundResource(R.drawable.bg_status_dot_gold)
            binding.tvBadgeText.text = getString(R.string.assignment_badge_pending)
            binding.tvBadgeText.setTextColor(ContextCompat.getColor(this, R.color.white))
        }
    }

    //  ••• Bouncing Circles + Pulse Rings •••

    private fun startCircleAnimation() {
        binding.circleContainer.post {
            val containerW = binding.circleContainer.width
            val containerH = binding.circleContainer.height
            if (containerW == 0 || containerH == 0) return@post

            val random = java.util.Random()
            val count = random.nextInt(4) + 3 // 3 to 6 circles

            for (i in 0 until count) {
                val sizeDp = 28 + random.nextInt(61)
                val sizePx = (sizeDp * resources.displayMetrics.density).toInt()
                val startX = random.nextInt(containerW).toFloat()
                val startY = random.nextInt(containerH).toFloat()
                val minSpeed = 0.12f + random.nextFloat() * 0.15f
                val maxSpeed = minSpeed + 0.15f + random.nextFloat() * 0.2f
                val alpha = 0.25f + random.nextFloat() * 0.3f

                val circle = View(this).apply {
                    layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
                    background = ContextCompat.getDrawable(this@AssignmentActivity, R.drawable.bg_circle_light_red)
                    this.alpha = alpha
                }
                binding.circleContainer.addView(circle)
                circleViews.add(circle)
                startBounceAnimation(circle, sizePx, containerW, containerH, minSpeed, maxSpeed,
                    startX, startY, (i * 150L) + random.nextInt(500))
            }
        }
    }

    private fun startPulseRings() {
        startPulseRing(binding.pulseRing1)
        startPulseRing(binding.pulseRing2, delayMs = 1200L)
    }

    private fun startPulseRing(ring: View, delayMs: Long = 0L) {
        ring.visibility = View.VISIBLE
        ring.alpha = 0f

        val scaleUp = android.animation.ObjectAnimator.ofFloat(ring, "scaleX", 0.3f, 1.5f).apply {
            duration = 2000L
            repeatMode = android.animation.ObjectAnimator.RESTART
            repeatCount = android.animation.ValueAnimator.INFINITE
            startDelay = delayMs
        }
        val scaleUpY = android.animation.ObjectAnimator.ofFloat(ring, "scaleY", 0.3f, 1.5f).apply {
            duration = 2000L
            repeatMode = android.animation.ObjectAnimator.RESTART
            repeatCount = android.animation.ValueAnimator.INFINITE
            startDelay = delayMs
        }
        val fadeOut = android.animation.ObjectAnimator.ofFloat(ring, "alpha", 0.6f, 0f).apply {
            duration = 2000L
            repeatMode = android.animation.ObjectAnimator.RESTART
            repeatCount = android.animation.ValueAnimator.INFINITE
            startDelay = delayMs
        }

        circleAnimators.addAll(listOf(scaleUp, scaleUpY, fadeOut))
        scaleUp.start()
        scaleUpY.start()
        fadeOut.start()
    }

    private fun startBounceAnimation(
        view: View,
        viewSize: Int,
        containerWidth: Int,
        containerHeight: Int,
        minSpeed: Float,
        maxSpeed: Float,
        initialX: Float,
        initialY: Float,
        startDelayMs: Long
    ) {
        val random = java.util.Random()
        val maxX = (containerWidth - viewSize).toFloat().coerceAtLeast(0f)
        val maxY = (containerHeight - viewSize).toFloat().coerceAtLeast(0f)

        view.translationX = initialX
        view.translationY = initialY

        var velX = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) *
            if (random.nextBoolean()) 1f else -1f
        var velY = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) *
            if (random.nextBoolean()) 1f else -1f

        android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
            duration = Long.MAX_VALUE
            repeatCount = android.animation.ValueAnimator.INFINITE
            startDelay = startDelayMs
            addUpdateListener {
                if (random.nextFloat() < 0.02f) {
                    velX += (random.nextFloat() - 0.5f) * 0.4f
                    velX = velX.coerceIn(-maxSpeed, maxSpeed)
                }
                if (random.nextFloat() < 0.02f) {
                    velY += (random.nextFloat() - 0.3f) * 0.4f
                    velY = velY.coerceIn(-maxSpeed, maxSpeed)
                }

                var newX = view.translationX + velX
                var newY = view.translationY + velY

                if (newX <= 0) { newX = 0f; velX = kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed) }
                else if (newX >= maxX) { newX = maxX; velX = -kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed) }

                if (newY <= 0) { newY = 0f; velY = kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed) }
                else if (newY >= maxY) { newY = maxY; velY = -kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed) }

                view.translationX = newX
                view.translationY = newY
            }
            circleAnimators.add(this)
            start()
        }

        android.animation.ObjectAnimator.ofFloat(view, "scaleX", 1f, 1.08f).apply {
            duration = 4000L + random.nextInt(1500)
            repeatCount = android.animation.ObjectAnimator.INFINITE
            repeatMode = android.animation.ObjectAnimator.REVERSE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            startDelay = startDelayMs
            circleAnimators.add(this)
            start()
        }

        android.animation.ObjectAnimator.ofFloat(view, "scaleY", 1f, 1.06f).apply {
            duration = 4500L + random.nextInt(1500)
            repeatCount = android.animation.ObjectAnimator.INFINITE
            repeatMode = android.animation.ObjectAnimator.REVERSE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            startDelay = startDelayMs + 600L
            circleAnimators.add(this)
            start()
        }
    }
}
