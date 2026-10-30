package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.util.Base64
import android.graphics.BitmapFactory
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.R
import com.sysu.go.databinding.DialogGuardVerificationBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class GuardVerificationBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogGuardVerificationBinding? = null
    private val binding get() = _binding!!

    private var guardFirstName: String = ""
    private var guardLastName: String = ""
    private var guardMI: String = ""
    private var signatureBase64: String = ""
    private var verifiedAtMillis: Long = 0L

    /** Called after the user confirms on the second tap. */
    var onSubmitConfirmed: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setStyle(STYLE_NORMAL, R.style.BottomSheetTheme)
        arguments?.let {
            guardFirstName = it.getString(ARG_FIRST_NAME, "")
            guardLastName = it.getString(ARG_LAST_NAME, "")
            guardMI = it.getString(ARG_MI, "")
            signatureBase64 = it.getString(ARG_SIGNATURE, "")
            verifiedAtMillis = it.getLong(ARG_VERIFIED_AT, 0L)
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogGuardVerificationBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        dialog?.window?.setBackgroundDrawableResource(android.R.color.transparent)

        val fullName = listOfNotNull(guardFirstName, guardMI.replace(".", "").trim().takeIf { it.isNotBlank() }?.let { "$it." }, guardLastName)
            .joinToString(" ")
        binding.tvGuardFullName.text = fullName.ifBlank { "—" }

        if (signatureBase64.isNotBlank()) {
            try {
                val bytes = Base64.decode(signatureBase64, Base64.NO_WRAP)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (bitmap != null) {
                    binding.ivSignature.setImageBitmap(bitmap)
                } else {
                    binding.ivSignature.setImageDrawable(null)
                }
            } catch (e: Exception) {
                binding.ivSignature.setImageDrawable(null)
            }
        }

        if (verifiedAtMillis > 0) {
            val sdf = SimpleDateFormat("MMMM d, yyyy  h:mm a", Locale.getDefault())
            binding.tvVerifiedAt.text = sdf.format(Date(verifiedAtMillis))
        } else {
            binding.tvVerifiedAt.text = "—"
        }

        //  Require a second tap to confirm the submission.
        binding.btnGuardVerificationSubmit.setOnClickListener {
            onSubmitConfirmed?.invoke()
            dismiss()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "GuardVerificationBottomSheet"
        private const val ARG_FIRST_NAME = "first_name"
        private const val ARG_LAST_NAME = "last_name"
        private const val ARG_MI = "mi"
        private const val ARG_SIGNATURE = "signature"
        private const val ARG_VERIFIED_AT = "verified_at"

        fun newInstance(
            firstName: String,
            lastName: String,
            mi: String,
            signature: String,
            verifiedAt: Long
        ): GuardVerificationBottomSheet {
            return GuardVerificationBottomSheet().apply {
                arguments = Bundle().apply {
                    putString(ARG_FIRST_NAME, firstName)
                    putString(ARG_LAST_NAME, lastName)
                    putString(ARG_MI, mi)
                    putString(ARG_SIGNATURE, signature)
                    putLong(ARG_VERIFIED_AT, verifiedAt)
                }
            }
        }
    }
}
