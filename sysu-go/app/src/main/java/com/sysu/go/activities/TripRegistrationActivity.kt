package com.sysu.go.activities

import android.content.Intent
import android.os.Bundle
import android.text.InputFilter
import android.content.res.ColorStateList
import android.util.Log
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.widget.ArrayAdapter
import android.widget.ImageView
import android.widget.TextView
import com.google.android.material.button.MaterialButton
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.sysu.go.R
import com.sysu.go.databinding.ActivityTripRegistrationBinding
import com.sysu.go.databinding.ItemHelperInputBinding
import com.sysu.go.network.QRApiService
import com.sysu.go.network.TripApiService
import com.sysu.go.network.TripRegistrationFlow
import com.sysu.go.network.DriverProfileApiService
import com.sysu.go.audit.DriverActionAudit
import com.sysu.go.utils.KeyboardUtils
import com.sysu.go.utils.Sanitizer
import com.sysu.go.utils.SessionManager
import com.sysu.go.network.SocketManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class TripRegistrationActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "TripRegistrationActivity"
    }

    private lateinit var binding: ActivityTripRegistrationBinding
    private var queueId: String? = null
    private var currentToken: String? = null
    private var driverCompany = ""
    private var registrationOpenedAtMs = 0L
    private val helperBindings = mutableListOf<ItemHelperInputBinding>()
    private lateinit var requirementsAdapter: RequirementEditAdapter

    //  Validation state
    private var helperDone = false
    private var truckDone = true   // pre-filled from profile so default true
    private var plateDone = false
    private var requirementsDone = true  // checkbox-only, default true

    private val truckTypes = arrayOf("Select Truck Type", "AUV", "4W", "6W", "10W", "20F", "40F")

    private suspend fun recoverAdmission(driverId: String, token: String): String? {
        return try {
            withTimeout(8000) {
                repeat(2) { attempt ->
                    val entries = awaitQueueSnapshot()
                    val matched = entries.firstOrNull { entry ->
                        entry["driverId"] == driverId && entry["token"] == token &&
                            entry["registrationComplete"] != true && entry["isAssigned"] != true &&
                            entry["status"] in listOf("waiting", "called")
                    }
                    val matchedId = matched?.get("id") as? String
                    if (matchedId != null && SessionManager(this@TripRegistrationActivity).getDriverId() == driverId) return@withTimeout matchedId
                    if (attempt == 0) delay(1200)
                }
                null
            }
        } catch (_: TimeoutCancellationException) { null }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { null }
    }

    private suspend fun awaitQueueSnapshot(queueId: String? = null): List<Map<String, Any?>> =
        suspendCancellableCoroutine { continuation ->
            var unsubscribe: (() -> Unit)? = null
            unsubscribe = SocketManager.subscribeRealtime(
                topic = "queue",
                params = queueId?.let { mapOf("queueId" to it) } ?: emptyMap(),
                onData = { data ->
                    if (continuation.isActive) {
                        val queues = when (data) {
                            is List<*> -> data.mapNotNull(::stringKeyedMap)
                            is Map<*, *> -> listOfNotNull(stringKeyedMap(data))
                            else -> emptyList()
                        }
                        unsubscribe?.invoke()
                        continuation.resume(queues)
                    }
                },
                onError = { message ->
                    if (continuation.isActive) {
                        unsubscribe?.invoke()
                        continuation.resumeWithException(IllegalStateException(message))
                    }
                },
            )
            continuation.invokeOnCancellation { unsubscribe?.invoke() }
        }

    private fun stringKeyedMap(value: Any?): Map<String, Any?>? {
        val map = value as? Map<*, *> ?: return null
        return map.entries.mapNotNull { (key, item) ->
            (key as? String)?.let { it to item }
        }.toMap()
    }
    private val platePrefixInputFilter = InputFilter { source, start, end, dest, dstart, dend ->
        val filtered = StringBuilder()
        for (i in start until end) {
            val c = source[i]
            if (c in 'A'..'Z' || c in 'a'..'z') {
                filtered.append(c.uppercaseChar())
            }
        }
        filtered.toString()
    }

    private val plateSuffixInputFilter = InputFilter { source, start, end, dest, dstart, dend ->
        val filtered = StringBuilder()
        for (i in start until end) {
            val c = source[i]
            if (c in '0'..'9') {
                filtered.append(c)
            }
        }
        filtered.toString()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        binding = ActivityTripRegistrationBinding.inflate(layoutInflater)
        binding.etPlatePrefix.filters = arrayOf(platePrefixInputFilter, InputFilter.LengthFilter(3))
        binding.etPlateSuffix.filters = arrayOf(plateSuffixInputFilter, InputFilter.LengthFilter(4))
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }

        queueId = savedInstanceState?.getString("queueId") ?: intent.getStringExtra("queueId")
        currentToken = intent.getStringExtra("token")
        driverCompany = SessionManager(this).getDriverCompany().trim()
        binding.etCompany.keyListener = null
        binding.etCompany.setText(driverCompany)

        if (queueId == null && currentToken == null) {
            val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_info, null)
            dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_error)
            dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Error"
            dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Invalid session. Please scan QR code again."
            val dialog = AlertDialog.Builder(this).setView(dlgView).setCancelable(false).create()
            dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener { dialog.dismiss(); finish() }
            dialog.show()
            return
        }

        registrationOpenedAtMs = savedInstanceState?.getLong("driverActionRegistrationOpenedAtMs")
            ?.takeIf { it > 0L } ?: System.currentTimeMillis()
        if (savedInstanceState == null) {
            DriverActionAudit.recordFreshLocation(this, "registration_opened", subjectId = queueId)
        }

        setupTruckTypeSpinner()
        setupRequirements()
        //  Load saved requirements into adapter immediately
        SessionManager(this).getDriverId()?.let { loadSavedRequirements(it) }

        if (queueId != null) {
            //  Re-filling from existing queue entry
            fetchQueueData()
        } else {
            //  New one-step flow: Pre-fill from driver profile
            loadDriverProfile()
        }

        binding.btnAddHelper.setOnClickListener { addHelperView() }
        binding.btnSubmit.setOnClickListener { submitTrip() }
        binding.btnBack.setOnClickListener { finish() }
        if (intent.getBooleanExtra("profileSaveWarning", false)) {
            binding.root.post {
                com.sysu.go.diagnostics.UserErrorNotifier.show(
                    this,
                    "driver-profile",
                    "Your driver profile could not be saved. Some details may not be available next time.",
                )
            }
        }
    }

    private fun loadDriverProfile() {
        val session = SessionManager(this)
        val uid = session.getDriverId() ?: return

        setLoading(true)
        lifecycleScope.launch {
            try {
                val profile = withContext(Dispatchers.IO) {
                    com.sysu.go.network.DriverProfileApiService.getOwn(this@TripRegistrationActivity)
                }
                if (profile.name.isNotBlank() || profile.plateNumber.isNotBlank() || profile.truckingCompany.isNotBlank()) {
                    driverCompany = profile.truckingCompany.trim().takeIf { it.isNotBlank() }
                        ?: session.getDriverCompany().trim()
                    val truckType = profile.truckType
                    val plateNumber = profile.plateNumber

                    binding.etCompany.setText(driverCompany)

                    val typeIndex = truckTypes.indexOf(truckType)
                    if (typeIndex >= 0) {
                        binding.spTruckType.setSelection(typeIndex)
                    }

                    if (plateNumber.contains("-")) {
                        val parts = plateNumber.split("-")
                        binding.etPlatePrefix.setText(parts[0])
                        if (parts.size > 1) binding.etPlateSuffix.setText(parts[1])
                    } else if (plateNumber.isNotEmpty()) {
                        binding.etPlatePrefix.setText(plateNumber)
                    }

                    val helperFull = profile.helper
                    if (helperFull.isNotEmpty()) {
                        val parts = helperFull.split(",")[0].trim().split(" ")
                        if (helperBindings.isEmpty()) addHelperView()
                        val b = helperBindings[0]
                        if (parts.size >= 1) b.etHelperFN.setText(parts[0])
                        if (parts.size >= 3) {
                            b.etHelperMI.setText(parts[1].replace(".", ""))
                            b.etHelperLN.setText(parts.subList(2, parts.size).joinToString(" "))
                        } else if (parts.size == 2) {
                            b.etHelperLN.setText(parts[1])
                        }
                    } else {
                        if (helperBindings.isEmpty()) addHelperView()
                    }
                } else {
                    driverCompany = session.getDriverCompany().trim()
                    binding.etCompany.setText(driverCompany)
                    if (helperBindings.isEmpty()) addHelperView()
                }
            } catch (e: Exception) {
                driverCompany = session.getDriverCompany().trim()
                binding.etCompany.setText(driverCompany)
                if (helperBindings.isEmpty()) addHelperView()
            } finally {
                setLoading(false)
                validateHelper()
                validatePlate()
                updateValidationUI()
            }
        }
    }

    private fun fetchQueueData() {
        val qid = queueId ?: return
        setLoading(true)
        lifecycleScope.launch {
            try {
                val session = SessionManager(this@TripRegistrationActivity)
                val profileCompany = runCatching {
                    withContext(Dispatchers.IO) {
                        DriverProfileApiService.getOwn(this@TripRegistrationActivity).truckingCompany
                    }
                }.getOrNull()?.trim().orEmpty()
                driverCompany = profileCompany.ifBlank { session.getDriverCompany().trim() }
                binding.etCompany.setText(driverCompany)

                val queue = withTimeout(8000) { awaitQueueSnapshot(qid).firstOrNull() }
                if (queue != null) {
                    val truckType = queue["truckType"] as? String ?: ""
                    val plateNumber = queue["plateNumber"] as? String ?: ""
                    
                    val typeIndex = truckTypes.indexOf(truckType)
                    if (typeIndex >= 0) {
                        binding.spTruckType.setSelection(typeIndex)
                    }

                    if (plateNumber.contains("-")) {
                        val parts = plateNumber.split("-")
                        binding.etPlatePrefix.setText(parts[0])
                        if (parts.size > 1) binding.etPlateSuffix.setText(parts[1])
                    } else if (plateNumber.isNotEmpty()) {
                        binding.etPlatePrefix.setText(plateNumber)
                    }

                    val helperFull = (queue["helper"] as? String)
                        ?: (queue["helperName"] as? String).orEmpty()
                    if (helperFull.isNotEmpty()) {
                        val parts = helperFull.split(",")[0].trim().split(" ")
                        if (helperBindings.isEmpty()) addHelperView()
                        val b = helperBindings[0]
                        if (parts.size >= 1) b.etHelperFN.setText(parts[0])
                        if (parts.size >= 3) {
                            b.etHelperMI.setText(parts[1].replace(".", ""))
                            b.etHelperLN.setText(parts.subList(2, parts.size).joinToString(" "))
                        } else if (parts.size == 2) {
                            b.etHelperLN.setText(parts[1])
                        }
                    } else {
                        if (helperBindings.isEmpty()) addHelperView()
                    }
                } else {
                    if (helperBindings.isEmpty()) addHelperView()
                }
            } catch (e: Exception) {
                if (helperBindings.isEmpty()) addHelperView()
            } finally {
                setLoading(false)
            }
        }
    }

    private fun updateValidationUI() {
        //  Section indicators in form
        updateIndicator(binding.indicatorHelper, helperDone)
        updateIndicator(binding.indicatorTruck, truckDone)
        updateIndicator(binding.indicatorPlate, plateDone)
        updateIndicator(binding.indicatorRequirements, requirementsDone)

        //  Pill status bar
        updateIndicator(binding.pillHelper, helperDone)
        updateIndicator(binding.pillTruck, truckDone)
        updateIndicator(binding.pillPlate, plateDone)
        updateIndicator(binding.pillRequirements, requirementsDone)

        //  Connector lines: fill green if section before is done
        val colorDone = ContextCompat.getColor(this, com.sysu.go.R.color.sysu_green)
        val colorEmpty = ContextCompat.getColor(this, com.sysu.go.R.color.border)
        binding.line1.setBackgroundColor(if (helperDone) colorDone else colorEmpty)
        binding.line2.setBackgroundColor(if (truckDone) colorDone else colorEmpty)
        binding.line3.setBackgroundColor(if (requirementsDone) colorDone else colorEmpty)

        //  Submit button enabled only when all 3 form sections done
        //  requirementsDone is always true (checkboxes, not a blocker)
        val allDone = helperDone && truckDone && plateDone && requirementsDone
        binding.btnSubmit.isEnabled = allDone
        binding.btnSubmit.alpha = if (allDone) 1.0f else 0.38f
        binding.btnSubmit.backgroundTintList = if (allDone) {
            ContextCompat.getColorStateList(this, com.sysu.go.R.color.sysu_red)
        } else {
            ContextCompat.getColorStateList(this, com.sysu.go.R.color.text_muted)
        }
    }

    private fun updateIndicator(view: android.view.View, done: Boolean) {
        view.setBackgroundResource(
            if (done) com.sysu.go.R.drawable.indicator_done
            else com.sysu.go.R.drawable.indicator_empty
        )
    }

    private fun validateHelper() {
        helperDone = helperBindings.isNotEmpty() && helperBindings.all { b ->
            b.etHelperFN.text.toString().trim().isNotEmpty() &&
            b.etHelperLN.text.toString().trim().isNotEmpty()
        }
    }

    private fun validatePlate() {
        val px = binding.etPlatePrefix.text.toString().trim()
        val sx = binding.etPlateSuffix.text.toString().trim()
        plateDone = px.length == 3 && sx.length in 3..4
    }

    private fun addHelperView() {
        val inflater = LayoutInflater.from(this)
        val helperBinding = ItemHelperInputBinding.inflate(inflater, binding.helpersContainer, true)
        helperBindings.add(helperBinding)

        updateHelperLabels()

        //  Watch each field for changes to update validation state
        val helperWatcher = object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                validateHelper()
                updateValidationUI()
            }
        }
        helperBinding.etHelperFN.addTextChangedListener(helperWatcher)
        helperBinding.etHelperMI.addTextChangedListener(helperWatcher)
        helperBinding.etHelperLN.addTextChangedListener(helperWatcher)

        helperBinding.btnRemoveHelper.setOnClickListener {
            if (helperBindings.size > 1) {
                binding.helpersContainer.removeView(helperBinding.root)
                helperBindings.remove(helperBinding)
                updateHelperLabels()
            } else {
                Toast.makeText(this, "Kailangan ng at least isang helper", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateHelperLabels() {
        helperBindings.forEachIndexed { index, b ->
            b.tvHelperLabel.text = "Helper ${index + 1}"
        }
    }

    private fun setupTruckTypeSpinner() {
        val spinnerAdapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_item,
            truckTypes
        ).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        binding.spTruckType.adapter = spinnerAdapter

        //  Spinner validation watcher — only reacts to USER changes, not programmatic setSelection()
        binding.spTruckType.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, pos: Int, id: Long) {
                truckDone = pos > 0   // index 0 = "Select Truck Type" placeholder
                updateValidationUI()
            }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }

        //  Plate field watchers
        val plateWatcher = object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                validatePlate()
                updateValidationUI()
            }
        }
        binding.etPlatePrefix.addTextChangedListener(plateWatcher)
        binding.etPlateSuffix.addTextChangedListener(plateWatcher)

        //  Initial validation pass
        updateValidationUI()
    }

    private fun setupRequirements() {
        requirementsAdapter = RequirementEditAdapter { _, _ ->
            //  Debounced auto-save whenever a checkbox is toggled
            scheduleRequirementsSave()
        }
        binding.rvRequirements.layoutManager = LinearLayoutManager(this)
        binding.rvRequirements.adapter = requirementsAdapter
        requirementsAdapter.submitList(RequirementData.getAll())
    }

    private var requirementsSaveJob: kotlinx.coroutines.Job? = null

    private fun scheduleRequirementsSave() {
        requirementsSaveJob?.cancel()
        requirementsSaveJob = lifecycleScope.launch {
            kotlinx.coroutines.delay(800) // debounce rapid toggles
            saveRequirementsToProfile()
        }
    }

    private fun saveRequirementsToProfile() {
        val session = SessionManager(this)
        if (session.getDriverId() == null) return
        val requirements = requirementsAdapter.getRequirementsMap()
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    DriverProfileApiService.updateRequirements(this@TripRegistrationActivity, requirements)
                }
            }.onFailure {
                //  Keep autosave non-blocking; a later checkbox change can retry.
                Log.w(TAG, "Could not save driver requirements", it)
            }
        }
    }

    private fun loadSavedRequirements(uid: String) {
        lifecycleScope.launch {
            val requirements = runCatching {
                withContext(Dispatchers.IO) {
                    DriverProfileApiService.getOwn(this@TripRegistrationActivity).requirements
                }
            }.getOrElse {
                Log.w(TAG, "Could not load driver requirements", it)
                return@launch
            }
            requirementsAdapter.setRequirementsMap(requirements)
        }
    }

    private fun submitTrip() {
        val company = Sanitizer.sanitize(driverCompany, 100)
        val platePrefix = Sanitizer.sanitizePlatePrefix(binding.etPlatePrefix.text.toString().trim())
        val plateSuffix = Sanitizer.sanitizePlateSuffix(binding.etPlateSuffix.text.toString().trim())
        val truckType = binding.spTruckType.selectedItem?.toString() ?: ""

        var hasError = false

        if (company.isBlank()) {
            Toast.makeText(this, "Walang company sa driver profile mo. Ipa-update muna ito sa system manager.", Toast.LENGTH_LONG).show()
            hasError = true
        }

        if (platePrefix.length != 3) {
            binding.tilPlatePrefix.error = "Exactly 3 letters"
            hasError = true
        }
        if (plateSuffix.length !in 3..4) {
            binding.tilPlateSuffix.error = "3-4 digits required"
            hasError = true
        }
        if (truckType.isEmpty() || truckType == "Select Truck Type") {
            Toast.makeText(this, "Pumili ng Truck Type", Toast.LENGTH_SHORT).show()
            hasError = true
        }

        val helpersList = mutableListOf<Triple<String, String, String>>()

        helperBindings.forEach { b ->
            val fn = Sanitizer.sanitize(b.etHelperFN.text.toString().trim(), 50)
            val mi = Sanitizer.sanitizeMI(b.etHelperMI.text.toString().trim())
            val ln = Sanitizer.sanitize(b.etHelperLN.text.toString().trim(), 50)

            if (fn.isEmpty()) {
                b.tilHelperFN.error = "Required"
                hasError = true
            }
            if (ln.isEmpty()) {
                b.tilHelperLN.error = "Required"
                hasError = true
            }
            if (!hasError) {
                helpersList.add(Triple(fn, mi, ln))
            }
        }

        if (hasError) {
            Toast.makeText(this, "Paki-ayos ang mga error", Toast.LENGTH_SHORT).show()
            return
        }

        DriverActionAudit.recordFreshLocation(
            this, "trip_confirmation", subjectId = queueId, outcome = "requested",
            metadata = org.json.JSONObject().put("phase", "registration_submit")
        )

        setLoading(true)

        lifecycleScope.launch {
            val session = SessionManager(this@TripRegistrationActivity)
            val driverId = session.getDriverId()
            if (driverId == null || session.getDriverId() != driverId) {
                setLoading(false)
                Toast.makeText(this@TripRegistrationActivity, "Mag-sign in muli bago kumpirmahin ang biyahe.", Toast.LENGTH_LONG).show()
                return@launch
            }
            val driverPhone = session.getDriverPhone()
            val (driverFN, driverMI, driverLN) = session.getDriverNameParts()
            val firstHelper = helpersList.firstOrNull()
            if (firstHelper == null) {
                setLoading(false)
                Toast.makeText(this@TripRegistrationActivity, "Maglagay ng helper bago magpatuloy.", Toast.LENGTH_LONG).show()
                return@launch
            }
            val otherHelpers = if (helpersList.size > 1) {
                ", " + helpersList.drop(1).joinToString(", ") { (f, m, l) ->
                    listOf(f, m, l).filter { it.isNotEmpty() }.joinToString(" ")
                }
            } else ""
            val helperNameJoined = listOf(firstHelper.first, firstHelper.second, firstHelper.third)
                .filter { it.isNotEmpty() }.joinToString(" ") + otherHelpers

            //  Validate both API contracts before admission consumes the QR token.
            if ((firstHelper.third + otherHelpers).length > 50 || helperNameJoined.length > 100 || driverPhone.orEmpty().length > 20) {
                setLoading(false)
                Toast.makeText(this@TripRegistrationActivity,
                    "Masyadong mahaba ang helper details o phone number. Paikliin muna bago kumpirmahin.",
                    Toast.LENGTH_LONG).show()
                return@launch
            }

            fun committedText(value: String): String = value.trim()
                .replace(Regex("""[<>$&"|;'\\/]"""), "")
                .replace(Regex("""\s+"""), " ")

            val registrationStartedAtMs = System.currentTimeMillis()
            val result = TripRegistrationFlow.run(queueId,
                admit = {
                    val token = currentToken
                    if (token == null) {
                        TripRegistrationFlow.Result.Error(400, "Hindi makita ang QR token. Mag-scan muli.")
                    } else {
                        val scanRequest = com.sysu.go.model.ScanRequest(
                            token = token, driverId = driverId, driverName = session.getDriverName(),
                            driverFN = driverFN, driverMI = driverMI, driverLN = driverLN,
                            truckType = truckType, truckCompany = company,
                            plateNumber = "$platePrefix-$plateSuffix", helperName = helperNameJoined,
                            driverPhone = driverPhone
                        )
                        when (val scan = withContext(Dispatchers.IO) { QRApiService.scanToken(this@TripRegistrationActivity, scanRequest) }) {
                            is QRApiService.Result.Success -> TripRegistrationFlow.Result.Success(scan.data.queueId.orEmpty())
                            is QRApiService.Result.Error -> {
                                val recovered = if (scan.code == -1 || scan.code in listOf(409, 410, 500, 502, 503))
                                    recoverAdmission(driverId, token) else null
                                if (recovered != null) TripRegistrationFlow.Result.Success(recovered)
                                else TripRegistrationFlow.Result.Error(scan.code, scan.message)
                            }
                        }
                    }
                },
                onAdmitted = { admittedId ->
                    queueId = admittedId
                    session.saveCurrentQueueDocId(admittedId)
                    DriverActionAudit.recordFreshLocation(
                        this@TripRegistrationActivity, "queue_joined", subjectId = admittedId,
                        durationMs = (System.currentTimeMillis() - registrationStartedAtMs).coerceAtLeast(0L),
                        idempotencyKey = "queue-joined:$admittedId"
                    )
                },
                register = { admittedId ->
                    val request = TripApiService.TripRegisterRequest(
                        queueId = admittedId, helperFN = firstHelper.first, helperMI = firstHelper.second,
                        helperLN = firstHelper.third + otherHelpers, company = company,
                        truckType = truckType, platePrefix = platePrefix, plateSuffix = plateSuffix,
                        driverPhone = driverPhone
                    )
                    val authToken = session.getAuthToken()
                    if (authToken.isNullOrBlank() || session.getDriverId() != driverId) {
                        TripRegistrationFlow.Result.Error(401, "Mag-sign in muli bago kumpirmahin ang biyahe.")
                    } else {
                        val registration = withContext(Dispatchers.IO) { TripApiService.registerTrip(this@TripRegistrationActivity, request, authToken) }
                        when (val response = registration) {
                            is TripApiService.Result.Success -> TripRegistrationFlow.Result.Success(admittedId)
                            is TripApiService.Result.Error -> TripRegistrationFlow.Result.Error(response.code, response.message)
                        }
                    }
                },
                confirmCommitted = { admittedId ->
                    try {
                val entry = withTimeout(8000) { awaitQueueSnapshot(admittedId).firstOrNull() }
                SessionManager(this@TripRegistrationActivity).getDriverId() == driverId &&
                            entry != null && entry["driverId"] == driverId && entry["registrationComplete"] == true &&
                            entry["helperFN"] == committedText(firstHelper.first) &&
                            entry["helperMI"] == committedText(firstHelper.second).replace(Regex("""[^a-zA-Z]"""), "").take(1).uppercase() &&
                            entry["helperLN"] == committedText(firstHelper.third + otherHelpers) &&
                            (entry["company"] ?: entry["truckCompany"]) == committedText(company) &&
                            entry["truckType"] == truckType &&
                            entry["plateNumber"] == "$platePrefix-$plateSuffix" &&
                            entry["status"] in listOf("waiting", "called", "assigned", "loading", "fully_loaded", "in_transit")
                    } catch (error: kotlinx.coroutines.CancellationException) {
                        if (error is kotlinx.coroutines.TimeoutCancellationException) false else throw error
                    } catch (_: Exception) { false }
                })
            setLoading(false)
            when (result) {
                is TripRegistrationFlow.Result.Success -> {
                    DriverActionAudit.recordFreshLocation(
                        this@TripRegistrationActivity, "trip_registration",
                        subjectId = result.queueId, outcome = "success",
                        durationMs = System.currentTimeMillis() - registrationStartedAtMs,
                        idempotencyKey = "registration-success:${result.queueId}"
                    )
                    session.saveDriverCompany(company)
                    saveRequirementsToProfile()
                    Toast.makeText(this@TripRegistrationActivity, "Nakumpirma na ang biyahe!", Toast.LENGTH_SHORT).show()
                    navigateToHome()
                }
                is TripRegistrationFlow.Result.Error -> {
                    DriverActionAudit.recordFreshLocation(
                        this@TripRegistrationActivity, "trip_registration",
                        subjectId = queueId, outcome = "failed",
                        durationMs = System.currentTimeMillis() - registrationStartedAtMs,
                        metadata = org.json.JSONObject().put("errorCode", result.code),
                        idempotencyKey = "registration-failure:$queueId:${result.code}:$registrationStartedAtMs"
                    )
                    Log.w(TAG, "Trip confirmation failed (code ${result.code})")
                    val message = if (result.code == 401) {
                        "Hindi ma-verify ang session. Mag-sign in muli; kung tuloy ang error, kailangan suriin ang server."
                    } else result.message
                    val dlgView = LayoutInflater.from(this@TripRegistrationActivity).inflate(R.layout.dialog_sysu_info, null)
                    dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_error)
                    dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Hindi nakumpirma ang biyahe"
                    dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = message
                    val dialog = AlertDialog.Builder(this@TripRegistrationActivity).setView(dlgView).create()
                    dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener { dialog.dismiss() }
                    dialog.show()
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("queueId", queueId)
        outState.putLong("driverActionRegistrationOpenedAtMs", registrationOpenedAtMs)
        super.onSaveInstanceState(outState)
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        KeyboardUtils.handleTouchOutsideEditText(this, ev)
        return super.dispatchTouchEvent(ev)
    }

    private fun navigateToHome() {
        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }

    private fun setLoading(loading: Boolean) {
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        binding.btnSubmit.isEnabled = !loading
        binding.btnAddHelper.isEnabled = !loading
        binding.etCompany.isEnabled = true
        binding.etPlatePrefix.isEnabled = !loading
        binding.etPlateSuffix.isEnabled = !loading
        binding.spTruckType.isEnabled = !loading
        binding.rvRequirements.isEnabled = !loading
        helperBindings.forEach {
            it.etHelperFN.isEnabled = !loading
            it.etHelperMI.isEnabled = !loading
            it.etHelperLN.isEnabled = !loading
            it.btnRemoveHelper.isEnabled = !loading
        }
    }
}
