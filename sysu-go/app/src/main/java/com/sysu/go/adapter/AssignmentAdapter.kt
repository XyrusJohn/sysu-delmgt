package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemAssignmentCardBinding
import com.sysu.go.model.Assignment
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Adapter for assignment cards in the My Trip screen.
 *
 * Dual-button state machine per card:
 *
 * Top (btnTripAction):  PENDING VERIFICATION | LOCKED | START TRIP | END TRIP | COMPLETED
 * Bottom (btnVerification):
 *   Pre-verify  (guardVerified=false) → "GUARD VERIFICATION" — triggers the full flow
 *   Post-verify (guardVerified=true)  → "SHOW VERIFICATION"   — shows saved verification
 */
class AssignmentAdapter(
    private val onTripActionClick: (Assignment) -> Unit,
    private val onGuardPillTap: (Assignment) -> Unit,
    private val onObdTap: (Assignment) -> Unit,
    private val onVerificationAction: (assignment: Assignment, guardVerified: Boolean) -> Unit,
    private val onCancelLoading: (Assignment) -> Unit,
    private val onCancelVerification: (Assignment) -> Unit
) : ListAdapter<Assignment, AssignmentAdapter.AssignmentViewHolder>(AssignmentDiffCallback()) {

    //  sessionActiveDocId is refreshed before every submitList() call so bind() always has the current value
    var sessionActiveDocId: String? = null

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): AssignmentViewHolder {
        val binding = ItemAssignmentCardBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        val holder = AssignmentViewHolder(binding)

        //  Guard status row click — initiates guard verification flow (always opens selection)
        holder.itemView.findViewById<View>(R.id.guardStatusRow)?.setOnClickListener {
            val pos = holder.bindingAdapterPosition
            if (pos != RecyclerView.NO_POSITION) onGuardPillTap(getItem(pos))
        }

        //  OBD row click — opens ObdItemsBottomSheet
        holder.itemView.findViewById<View>(R.id.rowObd)?.setOnClickListener {
            val pos = holder.bindingAdapterPosition
            if (pos != RecyclerView.NO_POSITION) onObdTap(getItem(pos))
        }

        //  Bottom button — routes based on guard state
        //  During loading: CANCEL LOADING → dispatch directly here
        //  During fully_loading + not verified: GUARD VERIFICATION → opens guard selection flow
        //  Post-verify: SHOW VERIFICATION → shows saved verification sheet
        holder.itemView.findViewById<View>(R.id.btnShowVerification)?.setOnClickListener {
            val pos = holder.bindingAdapterPosition
            if (pos != RecyclerView.NO_POSITION) {
                val assignment = getItem(pos)
                if (assignment.isLoading) {
                    //  CANCEL LOADING — dedicated callback to handle revert
                    onCancelLoading(assignment)
                } else {
                    onVerificationAction(assignment, assignment.guardVerified)
                }
            }
        }

        //  CANCEL VERIFICATION button — reverts from VERIFY_WITH_GUARD back to loading
        holder.itemView.findViewById<View>(R.id.btnCancelVerification)?.setOnClickListener {
            val pos = holder.bindingAdapterPosition
            if (pos != RecyclerView.NO_POSITION) {
                onCancelVerification(getItem(pos))
            }
        }

        return holder
    }

    override fun onBindViewHolder(holder: AssignmentViewHolder, position: Int) {
        holder.bind(getItem(position), onTripActionClick)
    }

    inner class AssignmentViewHolder(
        private val binding: ItemAssignmentCardBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(
            assignment: Assignment,
            onTripActionClick: (Assignment) -> Unit
        ) {
            val ctx = binding.root.context
            val isLocked = assignment.isLocked(sessionActiveDocId)
            val isInTransit = assignment.isInTransit

            //  Shipment ID
            binding.tvShipmentNumber.text = assignment.shipmentNumber

            //  Core fields
            binding.tvPlateNo.text = assignment.plateNumber.ifEmpty { "—" }
            binding.tvTruckType.text = assignment.truckType.ifEmpty { "—" }
            binding.tvHelper.text = assignment.helper.ifEmpty { "—" }

            //  Guard status — pill style (green=verified, amber=pending)
            val guardPillDot: android.graphics.drawable.Drawable? = if (assignment.guardVerified) {
                ContextCompat.getDrawable(ctx, R.drawable.bg_status_dot_green)
            } else {
                ContextCompat.getDrawable(ctx, R.drawable.bg_status_dot_gold)
            }
            binding.guardPillDot.background = guardPillDot
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
                binding.tvGuardStatus.text = guardName.ifEmpty { ctx.getString(R.string.guard_status_verified) }
                binding.tvGuardStatus.setTextColor(ContextCompat.getColor(ctx, R.color.white))
            } else {
                binding.tvGuardStatus.text = ctx.getString(R.string.guard_status_pending)
                binding.tvGuardStatus.setTextColor(ContextCompat.getColor(ctx, R.color.text_amber))
            }

            //  OBD count
            binding.tvObdCount.text = assignment.obdCount.toString()

            //  Delivery date — clean calendar format only (no time metadata)
            if (assignment.deliveryTimestamp > 0) {
                val sdf = SimpleDateFormat("MMM dd, yyyy", Locale.US)
                binding.tvDeliveryDate.text = sdf.format(Date(assignment.deliveryTimestamp))
                binding.rowDeliveryDate.visibility = View.VISIBLE
            } else {
                binding.tvDeliveryDate.text = "—"
            }

            //  Customer requirements
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

            //  =============================================
            //  DUAL-BUTTON STATE MACHINE
            //
            //  Top (btnTripAction): PENDING VERIFICATION | LOCKED | START TRIP | END TRIP | COMPLETED
            //  Bottom (btnShowVerification):
            //  !guardVerified → "GUARD VERIFICATION" (solid red) — opens verification flow
            //  guardVerified → "SHOW VERIFICATION" (outline red) — shows saved verification
            //  =============================================

            //  State evaluation order (must match AssignmentActivity.onAssignmentAction)
            //
            //  1. isCompleted → terminal, no interaction
            //  2. isInTransit → END TRIP active
            //  3. driverConfirmed → READY ✓ (checked BEFORE isLocked so confirmed
            //  shipments never show LOCKED even with stale session)
            //  4. canConfirmTrip → CONFIRM SHIPMENT (guard signed, driver next)
            //  5. isLocked → LOCKED (only unconfirmed shipments can be blocked
            //  by a stale session; confirmed ones are protected)
            //  6. else → PENDING VERIFICATION (guard not signed)

            when {
                assignment.isCompleted -> {
                    binding.btnTripAction.text = "COMPLETED"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.text_muted))
                    binding.btnTripAction.isEnabled = false
                    binding.btnTripAction.alpha = 0.6f
                }
                assignment.isDelivered -> {
                    binding.btnTripAction.text = "DELIVERED"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.text_muted))
                    binding.btnTripAction.isEnabled = false
                    binding.btnTripAction.alpha = 0.6f
                }

                assignment.isInTransit -> {
                    binding.btnTripAction.text = "END TRIP"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.transit_green))
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1f
                }

                //  Loading state machine
                assignment.isLoading -> {
                    binding.btnTripAction.text = "FULLY LOADED"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.sysu_blue))
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1f
                }

                assignment.isFullyLoaded -> {
                    if (assignment.guardVerified) {
                        binding.btnTripAction.text = "START TRIP"
                        binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.sysu_red))
                        binding.btnTripAction.isEnabled = true
                        binding.btnTripAction.alpha = 1f
                    } else {
                        binding.btnTripAction.text = "GUARD VERIFICATION"
                        binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.sysu_red))
                        binding.btnTripAction.isEnabled = true
                        binding.btnTripAction.alpha = 1f
                    }
                }

                assignment.driverConfirmed -> {
                    binding.btnTripAction.text = "READY ✓"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.transit_green))
                    binding.btnTripAction.isEnabled = false
                    binding.btnTripAction.alpha = 0.8f
                }

                assignment.isLoaded || assignment.canConfirmTrip || (assignment.isFullyLoaded && assignment.guardVerified) -> {
                    //  Guard verified — ready for batch confirmation via floating bottom bar
                    binding.btnTripAction.text = "AWAITING CONFIRMATION"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.sysu_amber))
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1f
                }

                isLocked -> {
                    //  Button is clickable so driver can tap for explanation popup.
                    //  The locked state check is forwarded to the activity-level handler
                    //  which shows a contextual dialog explaining WHY.
                    binding.btnTripAction.text = "LOCKED"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.text_muted))
                    binding.btnTripAction.isEnabled = true  // clickable to show help dialog
                    binding.btnTripAction.alpha = 0.7f
                }

                assignment.isAssigned -> {
                    //  Newly assigned shipment (sap_assignment tripStatus = "assigned") — driver
                    //  hasn't started loading yet. Show "START LOADING" with the same red CTA as
                    //  the legacy pending/null state. Adding an explicit branch documents the
                    //  intent and makes the state machine easier to follow.
                    binding.btnTripAction.text = "START LOADING"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.sysu_red))
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1f
                }

                else -> {
                    //  Pending — not yet loading (legacy fallback for null/empty tripStatus)
                    binding.btnTripAction.text = "START LOADING"
                    binding.btnTripAction.setBackgroundColor(ContextCompat.getColor(ctx, R.color.sysu_red))
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1f
                }
            }

            //  Bottom btnShowVerification — separate state machine
            //
            //  loading → "CANCEL LOADING" (red outline)
            //  fully_loaded/loaded + !guardVerified → "GUARD VERIFICATION" (solid red)
            //  guardVerified → "SHOW VERIFICATION" (outline red, read-only)
            //  pending → GONE
            //
            when {
                assignment.isLoading -> {
                    binding.btnShowVerification.text = "CANCEL LOADING"
                    binding.btnShowVerification.setBackgroundResource(R.drawable.bg_btn_outline_red)
                    binding.btnShowVerification.setTextColor(
                        ContextCompat.getColor(ctx, R.color.sysu_red)
                    )
                    binding.btnShowVerification.isEnabled = true
                    binding.btnShowVerification.alpha = 1f
                    binding.btnShowVerification.visibility = View.VISIBLE
                }
                !assignment.guardVerified && assignment.isLoaded && !assignment.isFullyLoaded -> {
                    //  Guard needed + loaded but NOT fully_loaded → show here since
                    //  btnTripAction still says "START LOADING" at this stage
                    binding.btnShowVerification.text = "GUARD VERIFICATION"
                    binding.btnShowVerification.setBackgroundColor(
                        ContextCompat.getColor(ctx, R.color.sysu_red)
                    )
                    binding.btnShowVerification.setTextColor(
                        ContextCompat.getColor(ctx, R.color.white)
                    )
                    binding.btnShowVerification.isEnabled = true
                    binding.btnShowVerification.alpha = 1f
                    binding.btnShowVerification.strokeWidth = 0
                    binding.btnShowVerification.visibility = View.VISIBLE
                }
                assignment.isFullyLoaded && !assignment.guardVerified -> {
                    //  btnTripAction already shows "GUARD VERIFICATION" here → hide duplicate
                    binding.btnShowVerification.visibility = View.GONE
                }
                assignment.guardVerified -> {
                    binding.btnShowVerification.text = "SHOW VERIFICATION"
                    binding.btnShowVerification.setBackgroundResource(R.drawable.bg_btn_outline_red)
                    binding.btnShowVerification.setTextColor(
                        ContextCompat.getColor(ctx, R.color.sysu_red)
                    )
                    binding.btnShowVerification.isEnabled = true
                    binding.btnShowVerification.alpha = 1f
                    binding.btnShowVerification.visibility = View.VISIBLE
                }
                else -> {
                    binding.btnShowVerification.visibility = View.GONE
                }
            }

            //  Bottom btnCancelVerification — reverts fully_loaded → loading
            //
            //  fully_loaded + !guardVerified → "CANCEL VERIFICATION" (red outline)
            //  else → GONE
            //
            if (assignment.isFullyLoaded && !assignment.guardVerified) {
                binding.btnCancelVerification.text = "CANCEL VERIFICATION"
                binding.btnCancelVerification.visibility = View.VISIBLE
                binding.btnCancelVerification.isEnabled = true
                binding.btnCancelVerification.alpha = 1f
            } else {
                binding.btnCancelVerification.visibility = View.GONE
            }

            //  Click listener — fires for any clickable state (including LOCKED,
            //  which triggers the activity-level dialog explaining why it's blocked)
            binding.btnTripAction.setOnClickListener {
                if (assignment.isCompleted) {
                    android.util.Log.d("AssignmentAdapter", "TAP BLOCKED: isCompleted=true")
                    return@setOnClickListener
                }
                android.util.Log.d("AssignmentAdapter", "TAP: btnTripAction → calling onTripActionClick for ${assignment.docId} state=${assignment.tripStatus}")
                onTripActionClick(assignment)
            }
        }
    }

    class AssignmentDiffCallback : DiffUtil.ItemCallback<Assignment>() {
        override fun areItemsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem.docId == newItem.docId

        override fun areContentsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem == newItem
    }
}