package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.databinding.DialogGuardSelectionBinding
import com.sysu.go.model.SecurityGuard

class GuardSelectionBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogGuardSelectionBinding? = null
    private val binding get() = _binding!!

    private var guards: List<SecurityGuard> = emptyList()
    private var onGuardSelected: ((SecurityGuard) -> Unit)? = null
    private var guardAdapter: GuardSelectionAdapter? = null
    private var selectionEnabled = true
    private var statusMessage: String? = null

    companion object {
        const val TAG = "GuardSelectionBottomSheet"

        fun newInstance(
            guards: List<SecurityGuard>,
            selectionEnabled: Boolean = true,
            statusMessage: String? = null,
            onGuardSelected: (SecurityGuard) -> Unit
        ): GuardSelectionBottomSheet {
            return GuardSelectionBottomSheet().apply {
                this.guards = guards
                this.selectionEnabled = selectionEnabled
                this.statusMessage = statusMessage
                this.onGuardSelected = onGuardSelected
            }
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogGuardSelectionBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.tvSubheader.text = statusMessage ?: "Tap a guard to confirm selection"

        binding.rvGuards.apply {
            layoutManager = LinearLayoutManager(requireContext())
            guardAdapter = GuardSelectionAdapter(guards, selectionEnabled) { guard ->
                onGuardSelected?.invoke(guard)
                dismiss()
            }
            adapter = guardAdapter
        }
    }

    fun updateGuards(updated: List<SecurityGuard>, selectionEnabled: Boolean = true, statusMessage: String? = null) {
        guards = updated.toList()
        this.selectionEnabled = selectionEnabled
        this.statusMessage = statusMessage
        bindingOrNull()?.tvSubheader?.text = statusMessage ?: "Tap a guard to confirm selection"
        guardAdapter?.submitGuards(guards, selectionEnabled)
    }

    private fun bindingOrNull() = _binding

    override fun onDestroyView() {
        super.onDestroyView()
        guardAdapter = null
        _binding = null
    }
}
