package com.sysu.go.activities

import android.os.Bundle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.R
import com.sysu.go.databinding.DialogSignaturePadBinding

class SignaturePadBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogSignaturePadBinding? = null
    private val binding get() = _binding!!

    var onSignatureConfirmed: ((base64: String) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NORMAL, R.style.BottomSheetTheme)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogSignaturePadBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        //  Transparent background so bg_bottom_sheet drawable fills the sheet
        dialog?.window?.setBackgroundDrawableResource(android.R.color.transparent)

        //  Drag handle + peek height — show enough to hint there's a sheet
        val bottomSheet = dialog?.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
        bottomSheet?.let {
            val behavior = BottomSheetBehavior.from(it)
            behavior.peekHeight = 560  // enough to show canvas + buttons without scrolling
            behavior.state = BottomSheetBehavior.STATE_EXPANDED
        }

        //  Hide placeholder the moment user starts drawing
        binding.signaturePad.viewTreeObserver.addOnPreDrawListener {
            if (!binding.signaturePad.isEmpty()) {
                binding.signatureHintContainer.visibility = View.GONE
            } else {
                binding.signatureHintContainer.visibility = View.VISIBLE
            }
            true
        }

        binding.btnClear.setOnClickListener {
            binding.signaturePad.clear()
            binding.signatureHintContainer.visibility = View.VISIBLE
        }

        binding.btnConfirm.setOnClickListener {
            if (binding.signaturePad.isEmpty()) {
                Toast.makeText(requireContext(), "Paki-drawing ang iyong pirma", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            binding.btnConfirm.isEnabled = false
            binding.btnClear.isEnabled = false
            viewLifecycleOwner.lifecycleScope.launch {
                try {
                val base64 = binding.signaturePad.getSignatureBase64()
                if (base64 != null) {
                    onSignatureConfirmed?.invoke(base64)
                    dismiss()
                } else {
                    Toast.makeText(requireContext(), "Pumalya ang pag-save ng signature. Subukan ulit.", Toast.LENGTH_SHORT).show()
                }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    if (isAdded) Toast.makeText(requireContext(), "Unable to save signature. Please retry.", Toast.LENGTH_SHORT).show()
                } finally {
                    _binding?.btnConfirm?.isEnabled = true
                    _binding?.btnClear?.isEnabled = true
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "SignaturePadBottomSheet"
    }
}