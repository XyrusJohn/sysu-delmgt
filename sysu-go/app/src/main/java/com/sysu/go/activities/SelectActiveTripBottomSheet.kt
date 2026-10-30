package com.sysu.go.activities

import android.app.Dialog
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.sysu.go.R
import com.sysu.go.model.Assignment

class SelectActiveTripBottomSheet : BottomSheetDialogFragment() {

    private lateinit var assignments: List<Assignment>
    private var selectedDocId: String? = null
    var onTripSelected: ((Assignment) -> Unit)? = null

    companion object {
        const val TAG = "SelectActiveTripBottomSheet"
        fun newInstance(assignments: List<Assignment>): SelectActiveTripBottomSheet {
            val sheet = SelectActiveTripBottomSheet()
            sheet.assignments = assignments
            return sheet
        }
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val dialog = super.onCreateDialog(savedInstanceState) as BottomSheetDialog
        val context = requireContext()

        //  Root Layout
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (24 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        //  Title
        val title = TextView(context).apply {
            text = "Piliin ang Active Trip"
            textSize = 20f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, (16 * resources.displayMetrics.density).toInt())
        }
        root.addView(title)

        //  Subtitle
        val subtitle = TextView(context).apply {
            text = "Aling shipment ang gusto mong i-activate para sa biyahe?"
            textSize = 14f
            setTextColor(android.graphics.Color.GRAY)
            setPadding(0, 0, 0, (24 * resources.displayMetrics.density).toInt())
        }
        root.addView(subtitle)

        //  Radio Group (Checkmarks)
        val radioGroup = RadioGroup(context).apply {
            orientation = RadioGroup.VERTICAL
        }

        assignments.forEach { assignment ->
            val customerName = assignment.lineItems.firstOrNull()?.get("customerName") as? String ?: "Unknown Customer"
            val shipmentId = assignment.shipmentNumberRaw.ifBlank { assignment.docId }

            val rb = RadioButton(context).apply {
                text = "Shipment: $shipmentId\nCustomer: $customerName\nPlate: ${assignment.plateNumber}"
                id = View.generateViewId()
                val rbPad = (12 * resources.displayMetrics.density).toInt()
                setPadding(rbPad, rbPad, rbPad, rbPad)
                textSize = 16f
                setOnClickListener {
                    selectedDocId = assignment.docId
                }
            }
            radioGroup.addView(rb)
        }
        root.addView(radioGroup)

        //  Start Trip Button
        val btnStart = MaterialButton(context).apply {
            text = "Start Trip"
            val btnPad = (16 * resources.displayMetrics.density).toInt()
            setPadding(btnPad, btnPad, btnPad, btnPad)
            val marginTop = (24 * resources.displayMetrics.density).toInt()
            (layoutParams as? LinearLayout.LayoutParams)?.topMargin = marginTop
            setBackgroundColor(context.getColor(R.color.sysu_red))
            setTextColor(context.getColor(R.color.white))
            setOnClickListener {
                if (selectedDocId != null) {
                    val selected = assignments.first { it.docId == selectedDocId }
                    onTripSelected?.invoke(selected)
                    dismiss()
                } else {
                    Toast.makeText(context, "Pumili muna ng shipment", Toast.LENGTH_SHORT).show()
                }
            }
        }
        root.addView(btnStart)

        //  Wrap in ScrollView para safe kahit maraming shipments
        val scrollView = ScrollView(context).apply {
            addView(root)
        }

        dialog.setContentView(scrollView)
        return dialog
    }
}