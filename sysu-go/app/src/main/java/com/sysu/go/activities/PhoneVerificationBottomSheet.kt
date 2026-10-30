package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.isVisible
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.R
import com.sysu.go.databinding.BottomSheetPhoneVerifyBinding

/**
 * Phone verification remains unavailable until the MySQL backend has an SMS
 * verification service. This sheet never accepts or simulates an OTP.
 */
class PhoneVerificationBottomSheet : BottomSheetDialogFragment() {
    private var _binding: BottomSheetPhoneVerifyBinding? = null
    private val binding get() = _binding!!

    var onVerified: ((phoneNumber: String) -> Unit)? = null
    var onEditPhone: (() -> Unit)? = null

    companion object {
        private const val ARG_PHONE = "phone"

        fun newInstance(phoneNumber: String): PhoneVerificationBottomSheet =
            PhoneVerificationBottomSheet().apply {
                arguments = Bundle().apply { putString(ARG_PHONE, phoneNumber) }
            }
    }

    override fun getTheme(): Int = R.style.BottomSheetTheme

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = BottomSheetPhoneVerifyBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val phone = arguments?.getString(ARG_PHONE).orEmpty()
        binding.tvVerifySubtitle.text = if (phone.isBlank()) {
            "SMS verification is temporarily unavailable."
        } else {
            "SMS verification for $phone is temporarily unavailable."
        }
        binding.otpInputRow.isVisible = false
        binding.progressOtp.isVisible = false
        binding.tvOtpError.text = "A verification service is not configured. No code was sent."
        binding.tvOtpError.isVisible = true
        binding.tvResendLabel.isVisible = false
        binding.btnResendOtp.isVisible = false
        binding.btnVerifyOtp.text = "Close"
        binding.btnVerifyOtp.isEnabled = true
        binding.btnVerifyOtp.setOnClickListener {
            onEditPhone?.invoke()
            dismiss()
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
