package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemShipmentCardBinding
import com.sysu.go.model.Assignment

/**
 * Vertical list of shipment cards shown on the main dashboard
 * when the driver has 2+ assigned shipments.
 *
 * Each card shows: ticket icon + "My Queue" label + shipment subtitle + status dot + chevron.
 * Tapping a card opens AssignmentActivity for that specific shipment.
 *
 * Phase 1 (1 shipment): cardMyQueue handles display.
 * Phase 2+ (2+ shipments): this adapter drives a vertical RecyclerView below cardMyQueue.
 */
class ShipmentCardAdapter(
    private val sessionActiveDocId: String?,
    private val onCardClick: (Assignment) -> Unit
) : ListAdapter<Assignment, ShipmentCardAdapter.ShipmentCardViewHolder>(ShipmentCardDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ShipmentCardViewHolder {
        val binding = ItemShipmentCardBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return ShipmentCardViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ShipmentCardViewHolder, position: Int) {
        holder.bind(getItem(position), sessionActiveDocId, onCardClick)
    }

    class ShipmentCardViewHolder(
        private val binding: ItemShipmentCardBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(
            assignment: Assignment,
            sessionActiveDocId: String?,
            onCardClick: (Assignment) -> Unit
        ) {
            val ctx = binding.root.context

            //  Label always "My Queue" for dashboard cards
            binding.tvCardLabel.text = "My Queue"

            //  Subtitle: show OBD number + plate number from actual shipment data
            val subtitle = if (assignment.obdNumber.isNotBlank()) {
                "OBD ${assignment.obdNumber.take(12)}  •  ${assignment.plateNumber.ifBlank { "No plate" }}"
            } else {
                "Shipment #${assignment.shipmentNumber.uppercase().take(10)}"
            }
            binding.tvCardSubtitle.text = subtitle

            //  Status dot: green when this shipment is the active trip
            val isThisActive = assignment.isActive(sessionActiveDocId)
            if (isThisActive) {
                binding.vStatusDot.visibility = View.VISIBLE
                binding.vStatusDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            } else {
                binding.vStatusDot.visibility = View.GONE
            }

            //  Card click → open AssignmentActivity for this specific shipment
            binding.cardShipment.setOnClickListener { onCardClick(assignment) }
        }
    }

    class ShipmentCardDiffCallback : DiffUtil.ItemCallback<Assignment>() {
        override fun areItemsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem.docId == newItem.docId

        override fun areContentsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem == newItem
    }
}