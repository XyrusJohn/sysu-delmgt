package com.sysu.go.activities

import android.content.Intent
import android.os.Bundle
import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.MotionEvent
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.sysu.go.R
import com.sysu.go.databinding.ActivityUpdateInfoBinding
import com.sysu.go.databinding.ItemHelperInputBinding
import com.sysu.go.model.ScanRequest
import com.sysu.go.network.QRApiService
import com.sysu.go.network.DriverProfileApiService
import com.sysu.go.network.MysqlAuthClient
import com.sysu.go.network.SocketManager
import com.sysu.go.utils.KeyboardUtils
import com.sysu.go.utils.Sanitizer
import com.sysu.go.utils.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class UpdateInfoActivity : AppCompatActivity() {

    private lateinit var binding: ActivityUpdateInfoBinding
    private var currentToken: String? = null
    private val helperBindings = mutableListOf<ItemHelperInputBinding>()
    private var truckCompanySubscription: (() -> Unit)? = null
    private lateinit var truckCompanyAdapter: ArrayAdapter<String>

    private lateinit var requirementsAdapter: RequirementEditAdapter

    private val truckTypes = arrayOf("AUV", "4W", "6W", "10W", "20F", "40F")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityUpdateInfoBinding.inflate(layoutInflater)
        setContentView(binding.root)

        currentToken = intent.getStringExtra("token")
        if (currentToken == null) {
            Toast.makeText(this, "No token provided", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val sessionManager = SessionManager(this)
        if (sessionManager.getDriverId() == null) {
            Toast.makeText(this, "Not logged in", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        setupTruckTypeSpinner()
        setupTruckCompanySuggestions()
        setupRequirements()

        //  Load existing requirements if driver already has a profile
        val session = SessionManager(this)
        session.getDriverId()?.let { loadRequirements(it) }

        //  Add initial helper
        addHelperView()

        binding.btnAddHelper.setOnClickListener { addHelperView() }
        binding.btnSubmit.setOnClickListener { submitInfo() }
    }

    override fun onStart() {
        super.onStart()
        if (truckCompanySubscription == null) {
            truckCompanySubscription = SocketManager.subscribeRealtime(
                topic = "truckCompanies",
                onData = { data ->
                    val names = (data as? List<*>)
                        ?.mapNotNull { (it as? Map<*, *>)?.get("name") as? String }
                        ?.map(String::trim)
                        ?.filter(String::isNotEmpty)
                        ?.distinct()
                        .orEmpty()
                    truckCompanyAdapter.clear()
                    truckCompanyAdapter.addAll(names)
                    truckCompanyAdapter.notifyDataSetChanged()
                },
                onError = { android.util.Log.w("UpdateInfoActivity", "Truck company suggestions unavailable: $it") },
            )
        }
    }

    override fun onStop() {
        truckCompanySubscription?.invoke()
        truckCompanySubscription = null
        super.onStop()
    }

    private fun setupTruckCompanySuggestions() {
        truckCompanyAdapter = ArrayAdapter(
            this,
            android.R.layout.simple_dropdown_item_1line,
            resources.getStringArray(R.array.truck_companies).toMutableList(),
        )
        binding.etTruckCompany.setAdapter(truckCompanyAdapter)
        binding.etTruckCompany.threshold = 0
        binding.etTruckCompany.setOnClickListener { binding.etTruckCompany.showDropDown() }
    }

    private fun addHelperView() {
        val inflater = LayoutInflater.from(this)
        val helperBinding = ItemHelperInputBinding.inflate(inflater, binding.helpersContainer, true)
        helperBindings.add(helperBinding)
        
        updateHelperLabels()

        helperBinding.btnRemoveHelper.setOnClickListener {
            if (helperBindings.size > 1) {
                binding.helpersContainer.removeView(helperBinding.root)
                helperBindings.remove(helperBinding)
                updateHelperLabels()
            } else {
                Toast.makeText(this, "At least one helper is required", Toast.LENGTH_SHORT).show()
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
    }

    private fun setupRequirements() {
        requirementsAdapter = RequirementEditAdapter { _, _ -> }
        binding.requirementsContainer.layoutManager = LinearLayoutManager(this)
        binding.requirementsContainer.adapter = requirementsAdapter
        requirementsAdapter.submitList(RequirementData.getAll())
    }

    private fun loadRequirements(driverId: String) {
        if (SessionManager(this).getDriverId() != driverId) return
        lifecycleScope.launch {
            val requirements = runCatching {
                withContext(Dispatchers.IO) {
                    DriverProfileApiService.getOwn(this@UpdateInfoActivity).requirements
                }
            }.getOrElse {
                android.util.Log.w("UpdateInfoActivity", "Driver requirements unavailable", it)
                return@launch
            }
            requirementsAdapter.setRequirementsMap(requirements)
        }
    }

    private fun submitInfo() {
        val truckCompany = Sanitizer.sanitize(binding.etTruckCompany.text.toString().trim(), 100)
        val platePrefix = Sanitizer.sanitizePlatePrefix(binding.etPlatePrefix.text.toString().trim())
        val plateSuffix = Sanitizer.sanitizePlateSuffix(binding.etPlateSuffix.text.toString().trim())
        val truckType = binding.spTruckType.selectedItem?.toString() ?: ""

        if (platePrefix.length < 2) {
            binding.etPlatePrefix.error = "2-4 alphanumeric characters"
            return
        }
        if (plateSuffix.length < 3) {
            binding.etPlateSuffix.error = "3-4 digits required"
            return
        }

        val helpers = mutableListOf<String>()
        var hasError = false
        
        helperBindings.forEach { b ->
            val fn = Sanitizer.sanitize(b.etHelperFN.text.toString().trim(), 50)
            val mi = Sanitizer.sanitizeMI(b.etHelperMI.text.toString().trim())
            val ln = Sanitizer.sanitize(b.etHelperLN.text.toString().trim(), 50)
            
            if (fn.isEmpty()) {
                b.etHelperFN.error = "Required"
                hasError = true
            }
            if (ln.isEmpty()) {
                b.etHelperLN.error = "Required"
                hasError = true
            }
            
            if (!hasError) {
                val fullName = buildString {
                    append(fn)
                    if (mi.isNotEmpty()) append(" ${mi.replace(".", "")}.")
                    append(" $ln")
                }.trim()
                helpers.add(fullName)
            }
        }

        if (hasError) return
        if (truckCompany.isEmpty()) {
            binding.etTruckCompany.error = "Required"
            return
        }

        setLoading(true)

        val sessionManager = SessionManager(this)
        val driverId = sessionManager.getDriverId() ?: return
        val driverName = sessionManager.getDriverName()
        val (driverFN, driverMI, driverLN) = sessionManager.getDriverNameParts()
        val driverPhone = sessionManager.getDriverPhone()
        val token = currentToken ?: return

        val fullPlate = "$platePrefix-$plateSuffix"
        val helpersJoined = helpers.joinToString(", ")

        val request = ScanRequest(
            token = token,
            driverId = driverId,
            driverName = driverName,
            driverFN = driverFN,
            driverMI = driverMI,
            driverLN = driverLN,
            truckType = truckType,
            truckCompany = truckCompany,
            plateNumber = fullPlate,
            helperName = helpersJoined,
            driverPhone = driverPhone
        )

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                QRApiService.scanToken(this@UpdateInfoActivity, request)
            }
            setLoading(false)

            when (result) {
                is QRApiService.Result.Success -> {
                    val returnedQueueId = result.data.queueId
                    if (returnedQueueId == null) {
                        val dlgView = LayoutInflater.from(this@UpdateInfoActivity).inflate(R.layout.dialog_sysu_info, null)
                        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_error)
                        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Error"
                        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "No queue ID returned. Please contact support."
                        val dialog = AlertDialog.Builder(this@UpdateInfoActivity).setView(dlgView).create()
                        dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener { dialog.dismiss(); finish() }
                        dialog.show()
                        return@launch
                    }

                    val profileSaved = saveDriverProfile(
                        queueId = returnedQueueId,
                        name = driverName,
                        fn = driverFN,
                        mi = driverMI,
                        ln = driverLN,
                        phone = driverPhone.orEmpty(),
                        truckType = truckType,
                        plateNumber = fullPlate,
                        truckCompany = truckCompany,
                        helper = helpersJoined,
                        requirements = requirementsAdapter.getRequirementsMap(),
                    )

                    Toast.makeText(
                        this@UpdateInfoActivity,
                        getString(R.string.join_queue_success),
                        Toast.LENGTH_LONG
                    ).show()

                    //  Reset token in local session if needed, but backend handles refresh
                    
                    //  Navigate to TripRegistrationActivity with queueId
                    val intent = Intent(this@UpdateInfoActivity, TripRegistrationActivity::class.java)
                    intent.putExtra("queueId", returnedQueueId)
                    intent.putExtra("profileSaveWarning", !profileSaved)
                    intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP
                    startActivity(intent)
                    finish()
                }
                is QRApiService.Result.Error -> {
                    val msg = when {
                        result.code == 400 -> getString(R.string.already_in_queue)
                        result.code == 410 -> getString(R.string.token_expired)
                        else -> "We could not join the queue right now. Check your connection and try again."
                    }
                    val dlgView2 = LayoutInflater.from(this@UpdateInfoActivity).inflate(R.layout.dialog_sysu_info, null)
                    dlgView2.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_error)
                    dlgView2.findViewById<TextView>(R.id.tvDialogTitle).text = "Registration Error"
                    dlgView2.findViewById<TextView>(R.id.tvDialogMessage).text = msg
                    val dialog2 = AlertDialog.Builder(this@UpdateInfoActivity).setView(dlgView2).create()
                    dlgView2.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener {
                        dialog2.dismiss()
                        if (result.code == 410) finish()
                    }
                    dialog2.show()
                }
            }
        }
    }

    private suspend fun saveDriverProfile(
        queueId: String,
        name: String,
        fn: String,
        mi: String,
        ln: String,
        phone: String,
        truckType: String,
        plateNumber: String,
        truckCompany: String,
        helper: String,
        requirements: Map<String, Boolean>,
    ): Boolean {
        try {
            withContext(Dispatchers.IO) {
                val authToken = SessionManager(this@UpdateInfoActivity).getAuthToken()
                    ?.takeIf(String::isNotBlank) ?: throw java.io.IOException("Please sign in again")
                MysqlAuthClient().updateProfile(
                    context = this@UpdateInfoActivity,
                    token = authToken,
                    displayName = name,
                    profile = mapOf(
                        "name" to name,
                        "fn" to fn,
                        "mi" to mi,
                        "ln" to ln,
                        "phone" to phone,
                        "truckingCompany" to truckCompany,
                    ),
                )
                DriverProfileApiService.updateRegistration(
                    context = this@UpdateInfoActivity,
                    queueId = queueId,
                    name = name,
                    truckType = truckType,
                    plateNumber = plateNumber,
                    truckingCompany = truckCompany,
                    helper = helper,
                    requirements = requirements,
                )
            }
            return true
        } catch (e: Exception) {
            android.util.Log.e("UpdateInfoActivity", "Failed to save driver profile")
            com.sysu.go.diagnostics.SystemErrorReporter.reportOperationFailure("driver-profile", e)
            return false
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        binding.btnSubmit.isEnabled = !loading
        binding.btnAddHelper.isEnabled = !loading
        binding.etTruckCompany.isEnabled = !loading
        binding.etPlatePrefix.isEnabled = !loading
        binding.etPlateSuffix.isEnabled = !loading
        binding.spTruckType.isEnabled = !loading
        helperBindings.forEach { 
            it.etHelperFN.isEnabled = !loading
            it.etHelperMI.isEnabled = !loading
            it.etHelperLN.isEnabled = !loading
            it.btnRemoveHelper.isEnabled = !loading
        }
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        KeyboardUtils.handleTouchOutsideEditText(this, ev)
        return super.dispatchTouchEvent(ev)
    }
}
