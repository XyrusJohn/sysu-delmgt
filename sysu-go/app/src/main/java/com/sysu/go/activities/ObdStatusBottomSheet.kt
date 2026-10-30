package com.sysu.go.activities

import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.isVisible
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.databinding.DialogObdStatusBinding

/**
 * Bottom sheet for selecting the delivery status of a single OBD item.
 *
 * Presents exactly 3 choices:
 *   1. "Delivered"
 *   2. "Rejected"
 *   3. "Delivered w/ Rejection"
 *
 * The selected status is returned via [onConfirmWithStatus] callback, which
 * fires when the driver taps "CONFIRM & TAKE PHOTO". The hosting Activity
 * should then launch the camera intent to capture the POD photo.
 *
 * Lifecycle-safe: selected status is preserved via [onSaveInstanceState]
 * so a configuration change (rotation) or OS kill during camera doesn't lose state.
 */
class ObdStatusBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogObdStatusBinding? = null
    private val binding get() = _binding!!

    /** The lineItem map from sap_assignments.lineItems for the selected OBD */
    private var lineItem: Map<String, Any?>? = null

    /** The sap_assignments document ID — passed to the callback for camera/storage use */
    private var shipmentDocId: String? = null

    /** Currently selected status string, persisted across lifecycle events */
    private var selectedStatus: String? = null

    /** Called when the driver selects a status and confirms.
     *  Arguments: (status, lineItem, shipmentDocId) */
    var onConfirmWithStatus: ((status: String, lineItem: Map<String, Any?>, shipmentDocId: String) -> Unit)? = null

    companion object {
        const val TAG = "ObdStatusBottomSheet"

        private const val ARG_LINE_ITEM = "arg_line_item"
        private const val ARG_SHIPMENT_DOC_ID = "arg_shipment_doc_id"
        private const val KEY_SELECTED_STATUS = "selectedStatus"

        fun newInstance(
            lineItem: Map<String, Any?>,
            shipmentDocId: String
        ): ObdStatusBottomSheet {
            return ObdStatusBottomSheet().apply {
                this.lineItem = lineItem
                this.shipmentDocId = shipmentDocId
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NORMAL, com.sysu.go.R.style.BottomSheetTheme)

        //  Restore selected status after config change or OS kill
        savedInstanceState?.getString(KEY_SELECTED_STATUS)?.let {
            selectedStatus = it
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogObdStatusBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        //  Let the bg_bottom_sheet drawable fill the sheet
        dialog?.window?.setBackgroundDrawableResource(android.R.color.transparent)

        //  Expand fully
        val bottomSheet = dialog?.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
        bottomSheet?.let {
            val behavior = BottomSheetBehavior.from(it)
            behavior.state = BottomSheetBehavior.STATE_EXPANDED
            behavior.skipCollapsed = true
        }

        populateOBDInfo()
        setupRadioGroup()
        setupConfirmButton()

        //  Restore selection if coming back from a config change
        restoreSelection()
    }

    /** Shows OBD number and customer name in the header */
    private fun populateOBDInfo() {
        val item = lineItem ?: return
        val obdNumber = item["obdNumber"] as? String ?: "—"
        val customerName = item["customerName"] as? String ?: "—"

        binding.tvObdInfo.text = buildString {
            append(obdNumber)
            if (customerName.isNotBlank() && customerName != "—") {
                append(" • ")
                append(customerName)
            }
        }
    }

    private fun setupRadioGroup() {
        //  Clear any prior selection — no default
        binding.rgStatus.setOnCheckedChangeListener { _, checkedId ->
            when (checkedId) {
                com.sysu.go.R.id.rbDelivered -> {
                    selectedStatus = getString(com.sysu.go.R.string.pod_status_delivered)
                    enableConfirmButton(true)
                }
                com.sysu.go.R.id.rbRejected -> {
                    selectedStatus = getString(com.sysu.go.R.string.pod_status_rejected)
                    enableConfirmButton(true)
                }
                com.sysu.go.R.id.rbDeliveredWithRejection -> {
                    selectedStatus = getString(com.sysu.go.R.string.pod_status_delivered_rejection)
                    enableConfirmButton(true)
                }
                else -> {
                    //  Nothing selected
                    enableConfirmButton(false)
                }
            }
        }
    }

    private fun enableConfirmButton(enabled: Boolean) {
        binding.btnConfirmStatus.isEnabled = enabled
        binding.btnConfirmStatus.alpha = if (enabled) 1f else 0.4f
    }

    private fun restoreSelection() {
        val status = selectedStatus ?: return
        val radioId = when (status) {
            getString(com.sysu.go.R.string.pod_status_delivered) -> com.sysu.go.R.id.rbDelivered
            getString(com.sysu.go.R.string.pod_status_rejected) -> com.sysu.go.R.id.rbRejected
            getString(com.sysu.go.R.string.pod_status_delivered_rejection) -> com.sysu.go.R.id.rbDeliveredWithRejection
            else -> null
        }
        radioId?.let {
            binding.rgStatus.check(it)
            enableConfirmButton(true)
        }
    }

    private fun setupConfirmButton() {
        //  Disabled by default — user must pick a status first
        binding.btnConfirmStatus.setOnClickListener {
            val status = selectedStatus
            val item = lineItem
            val docId = shipmentDocId

            if (status == null || item == null || docId == null) {
                Log.w(TAG, "Confirm tapped but missing data — status=$status, item=${item != null}, docId=${docId != null}")
                return@setOnClickListener
            }

            sendResultAndDismiss(status, item, docId)
        }
    }

    private fun sendResultAndDismiss(
        status: String,
        item: Map<String, Any?>,
        docId: String
    ) {
        //  Fire callback BEFORE dismiss so the Activity receives it while we're still alive
        onConfirmWithStatus?.invoke(status, item, docId)
        dismiss()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        selectedStatus?.let { outState.putString(KEY_SELECTED_STATUS, it) }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}