package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.databinding.DialogRequirementsEditBinding
import com.sysu.go.network.DriverProfileApiService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class RequirementsEditBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogRequirementsEditBinding? = null
    private val binding get() = _binding!!

    private lateinit var adapter: RequirementEditAdapter
    private var driverId: String? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogRequirementsEditBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        driverId = arguments?.getString(ARG_DRIVER_ID)

        setupRecyclerView()
        loadCurrentRequirements()
        setupButtons()
    }

    private fun setupRecyclerView() {
        adapter = RequirementEditAdapter { _, _ -> }
        binding.rvRequirements.layoutManager = LinearLayoutManager(requireContext())
        binding.rvRequirements.adapter = adapter
        adapter.submitList(RequirementData.getAll())
    }

    private fun loadCurrentRequirements() {
        if (driverId == null) return
        viewLifecycleOwner.lifecycleScope.launch {
            runCatching { withContext(Dispatchers.IO) { DriverProfileApiService.getOwn(requireContext()) } }
                .onSuccess { adapter.setRequirementsMap(it.requirements) }
                .onFailure { Toast.makeText(requireContext(), "Hindi ma-load ang requirements", Toast.LENGTH_SHORT).show() }
            }
    }

    private fun setupButtons() {
        binding.btnCancel.setOnClickListener {
            dismiss()
        }
        binding.btnSave.setOnClickListener {
            saveRequirements()
        }
    }

    private fun saveRequirements() {
        val id = driverId
        if (id == null) {
            Toast.makeText(requireContext(), "Hindi makita ang Driver ID", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnSave.isEnabled = false
        binding.btnSave.text = "Saving..."

        viewLifecycleOwner.lifecycleScope.launch {
            val saved = runCatching {
                withContext(Dispatchers.IO) {
                    DriverProfileApiService.updateRequirements(requireContext(), adapter.getRequirementsMap())
                }
            }.isSuccess
            if (saved) {
                Toast.makeText(requireContext(), "Na-save ang requirements", Toast.LENGTH_SHORT).show()
                dismiss()
            } else {
                binding.btnSave.isEnabled = true
                binding.btnSave.text = "Save"
                Toast.makeText(requireContext(), "Hindi ma-save", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "RequirementsEditBottomSheet"
        private const val ARG_DRIVER_ID = "driver_id"

        fun newInstance(driverId: String): RequirementsEditBottomSheet {
            return RequirementsEditBottomSheet().apply {
                arguments = Bundle().apply {
                    putString(ARG_DRIVER_ID, driverId)
                }
            }
        }
    }
}
