package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.sysu.go.R
import com.sysu.go.adapter.ConfirmShipmentSelectableAdapter
import com.sysu.go.databinding.DialogConfirmShipmentsSheetBinding
import com.sysu.go.model.Assignment

class ConfirmShipmentsBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogConfirmShipmentsSheetBinding? = null
    private val binding get() = _binding!!

    private var assignments: List<Assignment> = emptyList()
    private val selectedDocIds = mutableSetOf<String>()

    /**
     * Callback invoked when driver confirms the selected shipments.
     * Passes the list of selected docIds and whether ALL shipments are now confirmed.
     */
    var onConfirmationsSaved: ((selectedDocIds: Set<String>, allConfirmed: Boolean) -> Unit)? = null

    companion object {
        const val TAG = "ConfirmShipmentsBottomSheet"

        fun newInstance(assignments: List<Assignment>): ConfirmShipmentsBottomSheet {
            return ConfirmShipmentsBottomSheet().apply {
                this.assignments = assignments
            }
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogConfirmShipmentsSheetBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        //  Pre-populate with already driverConfirmed shipments
        assignments.forEach {
            if (it.driverConfirmed) {
                selectedDocIds.add(it.docId)
            }
        }

        setupRecyclerView()
        setupListeners()
        updateUIState()
    }

    private fun setupRecyclerView() {
        val adapter = ConfirmShipmentSelectableAdapter(
            shipments = assignments,
            selectedDocIds = selectedDocIds,
            onSelectionChanged = { _, _ ->
                updateUIState()
            }
        )

        binding.rvConfirmShipments.layoutManager = LinearLayoutManager(requireContext())
        binding.rvConfirmShipments.adapter = adapter
    }

    private fun setupListeners() {
        val adapter = binding.rvConfirmShipments.adapter as? ConfirmShipmentSelectableAdapter

        binding.cbConfirmAll.setOnClickListener {
            if (binding.cbConfirmAll.isChecked) {
                adapter?.selectAll()
            } else {
                adapter?.deselectAll()
            }
        }

        binding.cardConfirmAll.setOnClickListener {
            val newChecked = !binding.cbConfirmAll.isChecked
            binding.cbConfirmAll.isChecked = newChecked
            if (newChecked) {
                adapter?.selectAll()
            } else {
                adapter?.deselectAll()
            }
        }

        binding.btnCancel.setOnClickListener {
            dismiss()
        }

        binding.btnSaveConfirmation.setOnClickListener {
            if (selectedDocIds.isEmpty()) {
                Toast.makeText(requireContext(), "Pumili ng kahit isang shipment na ikukumpirma.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val allConfirmed = assignments.isNotEmpty() && selectedDocIds.size == assignments.size
            val selectedCount = selectedDocIds.size
            val totalCount = assignments.size

            //  Double confirmation dialog
            val dlgView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_sysu_confirmation, null)
            dlgView.findViewById<android.widget.ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_confirm)
            dlgView.findViewById<android.widget.TextView>(R.id.tvDialogTitle).text = "Kumpirmahin ang mga Shipment?"
            
            val message = if (allConfirmed) {
                "Sigurado ka bang kumpirmado na ang LAHAT ng $totalCount shipment? Pagkatapos nito ay maaari ka nang mag-Start Trip."
            } else {
                "Sigurado ka bang nais mong kumpirmahin ang $selectedCount sa $totalCount shipment? (Paalala: Kailangang kumpirmahin lahat bago makapag-Start Trip)"
            }
            dlgView.findViewById<android.widget.TextView>(R.id.tvDialogMessage).text = message

            val dialog = androidx.appcompat.app.AlertDialog.Builder(requireContext()).setView(dlgView).create()
            dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                text = "Oo, Kumpirmahin"
                backgroundTintList = ContextCompat.getColorStateList(requireContext(), R.color.sysu_red)
                setOnClickListener {
                    dialog.dismiss()
                    onConfirmationsSaved?.invoke(selectedDocIds.toSet(), allConfirmed)
                    dismiss()
                }
            }
            dlgView.findViewById<MaterialButton>(R.id.btnCancel).apply {
                text = "Bumalik"
                setOnClickListener { dialog.dismiss() }
            }
            dialog.show()
        }
    }

    private fun updateUIState() {
        val totalCount = assignments.size
        val selectedCount = selectedDocIds.size
        val allSelected = totalCount > 0 && selectedCount == totalCount

        //  Update master checkbox without loop
        binding.cbConfirmAll.setOnCheckedChangeListener(null)
        binding.cbConfirmAll.isChecked = allSelected

        //  Update header badge
        binding.tvConfirmedBadge.text = "$selectedCount/$totalCount Handa"
        if (allSelected) {
            binding.tvConfirmedBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
        } else {
            binding.tvConfirmedBadge.setBackgroundResource(R.drawable.bg_status_pill_amber)
        }

        //  Update requirement note
        if (allSelected) {
            binding.ivInfoIcon.setImageResource(R.drawable.ic_dialog_confirm)
            binding.ivInfoIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.transit_green))
            binding.tvRequirementHint.text = "Kumpleto na ang kumpirmasyon! Handa nang simulan ang biyahe sa main dashboard."
            binding.tvRequirementHint.setTextColor(ContextCompat.getColor(requireContext(), R.color.text_primary))
            binding.btnSaveConfirmation.text = "Kumpirmahin Lahat at Magpatuloy"
            binding.btnSaveConfirmation.backgroundTintList = ContextCompat.getColorStateList(requireContext(), R.color.sysu_red)
        } else {
            binding.ivInfoIcon.setImageResource(R.drawable.ic_dialog_alert)
            binding.ivInfoIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.sysu_blue))
            val remaining = totalCount - selectedCount
            binding.tvRequirementHint.text = "May $remaining pang unconfirmed shipment. Kailangang kumpirmahin lahat bago ma-unlock ang Start Trip sa dashboard."
            binding.tvRequirementHint.setTextColor(ContextCompat.getColor(requireContext(), R.color.text_secondary))
            binding.btnSaveConfirmation.text = "I-save ang Kumpirmasyon ($selectedCount/$totalCount)"
            binding.btnSaveConfirmation.backgroundTintList = ContextCompat.getColorStateList(requireContext(), R.color.sysu_red)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
