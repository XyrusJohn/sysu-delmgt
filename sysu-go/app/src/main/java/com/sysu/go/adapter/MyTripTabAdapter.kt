package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemMyTripTabCardBinding
import com.sysu.go.model.Assignment
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MyTripTabAdapter(
    initialHasActiveTrip: Boolean,
    var activeShipmentId: String?,
    private val onTripActionClicked: (Assignment, String) -> Unit,
    private val onObdTap: (List<Map<String, Any>>, String) -> Unit,
    private val onShowVerification: (Assignment) -> Unit
) : ListAdapter<Assignment, MyTripTabAdapter.MyTripTabViewHolder>(AssignmentDiffCallback()) {

    /**
     * When true, non-active shipments show START LOADING/START TRIP as disabled.
     * Custom setter calls notifyDataSetChanged() so DiffUtil-based submitList()
     * rebinds cards whose data hasn't changed but whose UI depends on this flag.
     */
    var hasActiveTrip: Boolean = initialHasActiveTrip
        set(value) {
            if (field != value) {
                field = value
                notifyDataSetChanged()
            }
        }

    /** Set to a record ID while its card is submitting END_TRIP. */
    var endingDocId: String? = null
        private set

    /** Called by MyTripActivity to mark which card is being ended */
    fun setEndingDocId(docId: String?) {
        endingDocId = docId
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MyTripTabViewHolder {
        val binding = ItemMyTripTabCardBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return MyTripTabViewHolder(binding)
    }

    override fun onBindViewHolder(holder: MyTripTabViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class MyTripTabViewHolder(val binding: ItemMyTripTabCardBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(assignment: Assignment) {
            val ctx = binding.root.context

            //  Header fields (mirrors AssignmentAdapter exactly)

            binding.tvShipmentNumber.text = assignment.shipmentNumber

            binding.tvPlateNo.text = assignment.plateNumber.ifEmpty { "—" }
            binding.tvTruckType.text = assignment.truckType.ifEmpty { "—" }
            binding.tvHelper.text = assignment.helper.ifEmpty { "—" }

            //  Delivery date
            if (assignment.deliveryTimestamp > 0) {
                val sdf = SimpleDateFormat("MMM dd, yyyy", Locale.US)
                binding.tvDeliveryDate.text = sdf.format(Date(assignment.deliveryTimestamp))
            } else {
                binding.tvDeliveryDate.text = "—"
            }

            //  OBD count
            binding.tvObdCount.text = assignment.lineItems.size.toString()

            //  POD pending count — items still needing POD capture
            val podPending = assignment.lineItems.count { (it["isPodCompleted"] as? Boolean) != true }
            if (podPending > 0) {
                binding.tvPodPending.text = "$podPending pending"
                binding.tvPodPending.visibility = View.VISIBLE
            } else {
                binding.tvPodPending.visibility = View.GONE
            }

            //  Guard verified pill

            binding.guardPillDot.background = ContextCompat.getDrawable(
                ctx,
                if (assignment.guardVerified) R.drawable.bg_status_dot_green
                else R.drawable.bg_status_dot_gold
            )
            binding.guardPill.setBackgroundResource(
                if (assignment.guardVerified) R.drawable.bg_status_pill_green
                else R.drawable.bg_status_pill_amber
            )
            if (assignment.guardVerified) {
                val guardName = buildString {
                    if (assignment.guardFirstName.isNotEmpty()) {
                        append(assignment.guardFirstName)
                        if (assignment.guardLastName.isNotEmpty()) {
                            append(" ${assignment.guardLastName.firstOrNull() ?: ""}.")
                        }
                    }
                }
                binding.tvGuardStatus.text = guardName.ifEmpty {
                    ctx.getString(R.string.guard_status_verified)
                }
                binding.tvGuardStatus.setTextColor(
                    ContextCompat.getColor(ctx, R.color.white)
                )
            } else {
                binding.tvGuardStatus.text = ctx.getString(R.string.guard_status_pending)
                binding.tvGuardStatus.setTextColor(
                    ContextCompat.getColor(ctx, R.color.text_amber)
                )
            }

            //  Driver confirmed pill (same logic as guard pill)

            binding.driverPillDot.background = ContextCompat.getDrawable(
                ctx,
                if (assignment.driverConfirmed) R.drawable.bg_status_dot_green
                else R.drawable.bg_status_dot_gold
            )
            binding.driverPill.setBackgroundResource(
                if (assignment.driverConfirmed) R.drawable.bg_status_pill_green
                else R.drawable.bg_status_pill_amber
            )
            binding.tvDriverStatus.text = if (assignment.driverConfirmed) {
                ctx.getString(R.string.guard_status_verified)
            } else {
                ctx.getString(R.string.guard_status_pending)
            }
            binding.tvDriverStatus.setTextColor(
                ContextCompat.getColor(
                    ctx,
                    if (assignment.driverConfirmed) R.color.white else R.color.text_amber
                )
            )

            //  Customer requirements table

            val reqMap = assignment.requirements
            fun setReq(tv: android.widget.TextView, key: String) {
                val checked = reqMap[key] ?: false
                tv.text = if (checked) "✔" else "—"
                tv.setTextColor(
                    ContextCompat.getColor(
                        ctx,
                        if (checked) R.color.transit_green else R.color.text_muted
                    )
                )
            }
            setReq(binding.tvReqAircon, "aircon")
            setReq(binding.tvReqVest, "reflectorizedVest")
            setReq(binding.tvReqHeadcap, "headcap")
            setReq(binding.tvReqSafetyShoes, "safetyShoes")
            setReq(binding.tvReqPants, "pants")
            setReq(binding.tvReqClosedShoes, "closedShoes")

            //  Trip status badge + button state

            when (assignment.tripStatus) {
                "in_transit" -> {
                    binding.tvTripStatusBadge.text = "ON TRANSIT"
                    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_red)
                    binding.tvTripStatusBadge.setTextColor(
                        ContextCompat.getColor(ctx, R.color.white)
                    )

                    val isEnding = assignment.docId == endingDocId

                    //  END TRIP appears when all PODs captured and not already ending.
                    //  Disable the button while the END_TRIP request is in flight.
                    if (isEnding) {
                        binding.btnTripAction.text = "ENDING..."
                        binding.btnTripAction.isEnabled = false
                        binding.btnTripAction.alpha = 0.5f
                    } else if (assignment.isPodComplete) {
                        //  All PODs done — show END SHIPMENT so the driver must
                        //  explicitly press it before the map icon enables return-to-base.
                        //  This enforces the agreed flow: PODs done → END SHIPMENT
                        //  → all shipments completed → map icon → floating return panel.
                        binding.btnTripAction.text = "END SHIPMENT"
                        binding.btnTripAction.isEnabled = true
                        binding.btnTripAction.alpha = 1.0f
                        binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.transit_green)
                    } else {
                        binding.btnTripAction.text = "OPEN ACTIVE TRIP 🔒"
                        binding.btnTripAction.isEnabled = true
                        binding.btnTripAction.alpha = 1.0f
                        binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)
                    }

                    binding.btnShowVerification.visibility = View.GONE
                }
                "completed" -> {
                    binding.tvTripStatusBadge.text = "COMPLETED"
                    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
                    binding.tvTripStatusBadge.setTextColor(
                        ContextCompat.getColor(ctx, R.color.white)
                    )

                    binding.btnTripAction.text = "VIEW SUMMARY"
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1.0f
                    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)

                    binding.btnShowVerification.visibility = View.GONE
                }
                                "loading" -> {
                binding.tvTripStatusBadge.text = "LOADING..."
                binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_amber)
                binding.tvTripStatusBadge.setTextColor(
                    ContextCompat.getColor(ctx, R.color.white)
                )

                //  Primary: FULLY LOADED
                binding.btnTripAction.visibility = View.VISIBLE
                binding.btnTripAction.text = "FULLY LOADED"
                binding.btnTripAction.isEnabled = true
                binding.btnTripAction.alpha = 1.0f
                binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_blue)

                //  Secondary: CANCEL LOADING — rein free card to previous state
                binding.btnShowVerification.visibility = View.VISIBLE
                binding.btnShowVerification.text = "CANCEL LOADING"
                binding.btnShowVerification.setTextColor(
                    ContextCompat.getColor(ctx, R.color.sysu_red)
                )
                binding.btnShowVerification.isEnabled = true
                binding.btnShowVerification.strokeColor = ContextCompat.getColorStateList(ctx, R.color.sysu_red)
                binding.btnShowVerification.setOnClickListener {
                    onTripActionClicked(assignment, "CANCEL_LOADING")
                }
            }
            "fully_loaded" -> {
                if (assignment.guardVerified) {
                    //  Guard already verified via external trigger; treat as loaded
                    binding.tvTripStatusBadge.text = "LOADED"
                    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
                    binding.tvTripStatusBadge.setTextColor(
                        ContextCompat.getColor(ctx, R.color.white)
                    )
                    binding.btnTripAction.visibility = View.VISIBLE
                    binding.btnTripAction.text = "START TRIP"
                    binding.btnTripAction.isEnabled = true  // always clickable — locked tap shows help dialog
                    binding.btnTripAction.alpha = if (hasActiveTrip) 0.45f else 1.0f
                    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)
                } else {
                    binding.tvTripStatusBadge.text = "FULLY LOADED"
                    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_blue)
                    binding.tvTripStatusBadge.setTextColor(
                        ContextCompat.getColor(ctx, R.color.white)
                    )
                    binding.btnTripAction.visibility = View.VISIBLE
                    binding.btnTripAction.text = "VERIFY WITH GUARD"
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1.0f
                    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_amber)
                }

                binding.btnShowVerification.visibility = View.GONE
            }
            "loaded" -> {
                binding.tvTripStatusBadge.text = "LOADED"
                binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
                binding.tvTripStatusBadge.setTextColor(
                    ContextCompat.getColor(ctx, R.color.white)
                )

                binding.btnTripAction.visibility = View.VISIBLE
                binding.btnTripAction.text = "START TRIP"
                binding.btnTripAction.isEnabled = true  // always clickable — locked tap shows help dialog
                binding.btnTripAction.alpha = if (hasActiveTrip) 0.45f else 1.0f
                binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)

                binding.btnShowVerification.visibility = View.VISIBLE
                binding.btnShowVerification.setOnClickListener {
                    onShowVerification(assignment)
                }
            }
                else -> {
                    //  pending / confirmed (legacy fallback — also handles the explicit
                    //  tripStatus="assigned" from the new sap_assignment schema since it
                    //  shares the same UI as the legacy null/pending state).
                    if (assignment.guardVerified && assignment.driverConfirmed) {
                        binding.tvTripStatusBadge.text = "CONFIRMED"
                        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_amber)
                        binding.tvTripStatusBadge.setTextColor(
                            ContextCompat.getColor(ctx, R.color.white)
                        )
                    } else {
                        //  "ASSIGNED" badge now displays the explicit string instead of "PENDING"
                        //  when the new schema is in use.
                        binding.tvTripStatusBadge.text = assignment.tripStatus?.uppercase() ?: "PENDING"
                        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_gray)
                        binding.tvTripStatusBadge.setTextColor(
                            ContextCompat.getColor(ctx, R.color.text_secondary)
                        )
                    }

                    binding.btnTripAction.text = "START LOADING"

                    //  Always clickable — locked tap shows help dialog explaining why
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = if (hasActiveTrip) 0.45f else 1.0f
                    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)
                    binding.btnTripAction.visibility = View.VISIBLE

                    //  Show verification button if guard verified (to re-show saved verification)
                    binding.btnShowVerification.visibility = if (assignment.guardVerified) {
                        View.VISIBLE
                    } else {
                        View.GONE
                    }
                    binding.btnShowVerification.setOnClickListener {
                        onShowVerification(assignment)
                    }
                }
            }

            binding.btnTripAction.setOnClickListener {
                val baseAction = when (binding.btnTripAction.text) {
                    "END TRIP", "ENDING..." -> "END_TRIP"
                    "END SHIPMENT" -> "END_SHIPMENT"
                    "START TRIP" -> "START_TRIP"
                    "START LOADING" -> "START_LOADING"
                    "FULLY LOADED" -> "FULLY_LOADED"
                    "VERIFY WITH GUARD" -> "VERIFY_GUARD"
                    "VIEW SUMMARY" -> "VIEW_SUMMARY"
                    "OPEN ACTIVE TRIP 🔒", "OPEN ACTIVE TRIP" -> "OPEN_ACTIVE_TRIP"
                    else -> "OPEN_ACTIVE_TRIP"
                }
                //  Route locked taps to contextual help: when another trip is in
                //  transit, tapping START TRIP or START LOADING explains why it's blocked.
                val action = if (hasActiveTrip && (baseAction == "START_TRIP" || baseAction == "START_LOADING")) {
                    "LOCKED_HAS_ACTIVE_TRIP"
                } else {
                    baseAction
                }
                onTripActionClicked(assignment, action)
            }

            //  OBD row: STRICTLY unlocked only when trip is in_transit (POD phase) or
            //  completed (post-trip view). LOCKED for everything else:
            //  - loaded / fully_loaded / loading / driver_confirmed / assigned: pre-trip
            //  - delivered: POD work is done
            //  - null: not even assigned yet
            //
            //  Per the spec: drivers cannot POD or interact with OBD items until they
            //  have explicitly started the trip (i.e. tripStatus flipped to in_transit
            //  via the START TRIP button). The "loaded" state means guard has verified
            //  but the trip hasn't started — keeping OBD locked here closes the gap
            //  where a driver could open MyTripActivity and POD a shipment before
            //  pressing START TRIP.
            val isObdLocked = assignment.tripStatus != "in_transit" &&
                assignment.tripStatus != "completed"
            if (isObdLocked) {
                binding.ivObdChevron.setImageResource(R.drawable.ic_lock)
                binding.rowObd.alpha = 0.5f
            } else {
                binding.ivObdChevron.setImageResource(R.drawable.ic_ticket)
                binding.rowObd.alpha = 1.0f
            }

            binding.rowObd.setOnClickListener {
                if (isObdLocked) {
                    android.widget.Toast.makeText(
                        ctx,
                        ctx.getString(R.string.obd_locked_msg),
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                    return@setOnClickListener
                }
                onObdTap(assignment.lineItems, assignment.docId)
            }

            binding.root.setOnClickListener {
                //  Card tap: if in_transit (and no child button was tapped), trigger same action as button.
                //  Guard with isPressed() to avoid double-firing when the button was clicked.
                if (assignment.tripStatus == "in_transit" &&
                    !binding.btnTripAction.isPressed) {
                    onTripActionClicked(assignment, "OPEN_ACTIVE_TRIP")
                }
            }
        }
    }

    private class AssignmentDiffCallback : DiffUtil.ItemCallback<Assignment>() {
        override fun areItemsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem.docId == newItem.docId

        override fun areContentsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem == newItem
    }
}
