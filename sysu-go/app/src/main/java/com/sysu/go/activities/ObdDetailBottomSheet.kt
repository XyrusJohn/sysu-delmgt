package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.sysu.go.R

/**
 * Lightweight bottom sheet that shows OBD item detail when driver taps an OBD row
 * inside ObdItemsBottomSheet — works for ALL states (PENDING, UNLOADING, COMPLETE).
 *
 * Arguments are passed via Bundle (same pattern as ObdStatusBottomSheet).
 */
class ObdDetailBottomSheet : BottomSheetDialogFragment() {

    companion object {
        const val TAG = "ObdDetailBottomSheet"

        fun newInstance(item: Map<String, Any?>): ObdDetailBottomSheet {
            return ObdDetailBottomSheet().apply {
                arguments = Bundle().apply {
                    putString("obdNumber", item["obdNumber"]?.toString())
                    putString("customerName", item["customerName"] as? String)
                    putString("deliveryStatus", item["deliveryStatus"] as? String)
                    putString("unloadStatus", item["unloadStatus"] as? String)
                    putString("quantity", item["quantity"]?.toString())
                    putBoolean("isPodCompleted", item["isPodCompleted"] as? Boolean ?: false)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        isCancelable = true
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.dialog_obd_detail, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val obdNumber = arguments?.getString("obdNumber") ?: "—"
        val customerName = arguments?.getString("customerName") ?: "—"
        val deliveryStatus = arguments?.getString("deliveryStatus")?.uppercase()?.trim() ?: ""
        val unloadStatus = arguments?.getString("unloadStatus") ?: ""
        val quantity = arguments?.getString("quantity") ?: "—"
        val isPodCompleted = arguments?.getBoolean("isPodCompleted") ?: false

        val tvObdNumber = view.findViewById<TextView>(R.id.tvObdNumber)
        val tvCustomerName = view.findViewById<TextView>(R.id.tvCustomerName)
        val tvDeliveryStatus = view.findViewById<TextView>(R.id.tvDeliveryStatus)
        val tvUnloadStatus = view.findViewById<TextView>(R.id.tvUnloadStatus)
        val tvQuantity = view.findViewById<TextView>(R.id.tvQuantity)
        val tvPodCaptured = view.findViewById<TextView>(R.id.tvPodCaptured)
        val llStatusRow = view.findViewById<View>(R.id.llStatusRow)
        val llUnloadRow = view.findViewById<View>(R.id.llUnloadRow)
        val llQuantityRow = view.findViewById<View>(R.id.llQuantityRow)
        val llPodRow = view.findViewById<View>(R.id.llPodRow)
        val btnClose = view.findViewById<MaterialButton>(R.id.btnClose)

        tvObdNumber.text = obdNumber
        tvCustomerName.text = customerName

        //  Delivery status pill — color-coded
        if (deliveryStatus.isNotBlank()) {
            llStatusRow.visibility = View.VISIBLE
            val (bgRes, textColor) = when (deliveryStatus) {
                "DELIVERED" -> R.drawable.bg_status_pill_green to R.color.white
                "REJECTED"  -> R.drawable.bg_status_pill_red to R.color.white
                "DELIVERED W/ REJECTION" -> R.drawable.bg_status_pill_amber to R.color.text_amber
                else -> R.drawable.bg_status_pill_amber to R.color.text_amber
            }
            tvDeliveryStatus.text = deliveryStatus
            tvDeliveryStatus.setBackgroundResource(bgRes)
            tvDeliveryStatus.setTextColor(ContextCompat.getColor(requireContext(), textColor))
        } else {
            llStatusRow.visibility = View.GONE
        }

        //  Unload state
        if (unloadStatus.isNotBlank()) {
            llUnloadRow.visibility = View.VISIBLE
            tvUnloadStatus.text = unloadStatus
        } else {
            llUnloadRow.visibility = View.GONE
        }

        //  Quantity
        llQuantityRow.visibility = View.VISIBLE
        tvQuantity.text = quantity

        //  POD captured
        llPodRow.visibility = View.VISIBLE
        tvPodCaptured.text = if (isPodCompleted) "YES" else "NO"

        btnClose.setOnClickListener { dismiss() }
    }
}