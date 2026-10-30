package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemShipmentCardHorizontalBinding
import com.sysu.go.model.Assignment

/**
 * Horizontal-scrolling shipment card adapter for the main dashboard's rvShipmentCards
 * when the driver has 2+ assigned shipments.
 *
 * Produces compact, horizontal cards (260dp wide) that scroll left/right as a carousel.
 * Each card shows: ticket icon + "My Queue" label + shipment subtitle + optional green dot
 * + chevron. Tapping a card opens AssignmentActivity for that specific shipment.
 */
class ShipmentCardHorizontalAdapter(
    private val sessionActiveDocId: String?,
    private val onCardClick: (Assignment) -> Unit
) : ListAdapter<Assignment, ShipmentCardHorizontalAdapter.ShipmentCardHorizontalViewHolder>(
    ShipmentCardHorizontalDiffCallback()
) {

    override fun onCreateViewHolder(
        parent: ViewGroup,
        viewType: Int
    ): ShipmentCardHorizontalViewHolder {
        val binding = ItemShipmentCardHorizontalBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return ShipmentCardHorizontalViewHolder(binding)
    }

    override fun onBindViewHolder(
        holder: ShipmentCardHorizontalViewHolder,
        position: Int
    ) {
        holder.bind(getItem(position), sessionActiveDocId, onCardClick)
    }

    class ShipmentCardHorizontalViewHolder(
        private val binding: ItemShipmentCardHorizontalBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(
            assignment: Assignment,
            sessionActiveDocId: String?,
            onCardClick: (Assignment) -> Unit
        ) {
            //  Label is always "My Queue" for dashboard cards
            binding.tvCardLabelHoriz.text = "My Queue"

            //  Show OBD number + plate as subtitle — not docId
            //  shipmentNumber getter returns obdNumber if set, else docId fallback
            val label = if (assignment.obdNumber.isNotBlank()) {
                "OBD ${assignment.obdNumber.take(10)}  •  ${assignment.plateNumber.ifBlank { "—" }}"
            } else {
                "Shipment #${assignment.shipmentNumber.uppercase().take(10)}"
            }
            binding.tvCardSubtitleHoriz.text = label

            //  Green status dot appears only on the active (current-trip) shipment
            val isThisActive = assignment.isActive(sessionActiveDocId)
            binding.vStatusDotHoriz.visibility = if (isThisActive) View.VISIBLE else View.GONE

            //  Card tap → AssignmentActivity for this shipment
            binding.cardShipmentHoriz.setOnClickListener { onCardClick(assignment) }
        }
    }

    class ShipmentCardHorizontalDiffCallback : DiffUtil.ItemCallback<Assignment>() {
        override fun areItemsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem.docId == newItem.docId

        override fun areContentsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem == newItem
    }
}