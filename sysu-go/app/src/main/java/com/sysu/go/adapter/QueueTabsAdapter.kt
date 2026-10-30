package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemQueueTabBinding

/**
 * Data class representing a single queue entry tab shown on the main dashboard.
 * One tab per assigned shipment on the dashboard's horizontal scrollable row.
 *
 * @param queueDocId  The queue entry ID returned by the API
 * @param status      Queue status string (assigned, loading, in_transit, called, waiting)
 * @param hasShipment True if this entry has a sap_assignment attached (guard verified + START TRIP available)
 * @param position    Queue position number, null when assigned/loading/in_transit
 */
data class QueueTab(
    val queueDocId: String,
    val status: String,
    val hasShipment: Boolean,
    val position: Int? = null
)

/**
 * Horizontal scrollable row of queue tabs — each tab is a full-width card
 * showing the ticket icon, "Assignment" / "My Queue" label, subtitle details, and chevron.
 * Tapping any tab opens AssignmentActivity.
 *
 * Phase 1: 1 tab (1 sap_assignment doc → 1 shipment).
 * Phase 2+ (multiple shipments): horizontal scroll, one tab per shipment.
 */
class QueueTabsAdapter(
    private val sessionActiveDocId: String?,
    private val onTabClick: (QueueTab) -> Unit
) : ListAdapter<QueueTab, QueueTabsAdapter.QueueTabViewHolder>(QueueTabDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): QueueTabViewHolder {
        val binding = ItemQueueTabBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return QueueTabViewHolder(binding)
    }

    override fun onBindViewHolder(holder: QueueTabViewHolder, position: Int) {
        holder.bind(getItem(position), sessionActiveDocId, onTabClick)
    }

    class QueueTabViewHolder(
        private val binding: ItemQueueTabBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(
            tab: QueueTab,
            sessionActiveDocId: String?,
            onTabClick: (QueueTab) -> Unit
        ) {
            val ctx = binding.root.context

            //  Label: "Assignment" when shipment attached, "My Queue" otherwise
            binding.tvTabLabel.text = if (tab.hasShipment) "Assignment" else "My Queue"

            //  Subtitle: human-readable status detail
            binding.tvTabSubtitle.text = when {
                tab.hasShipment && tab.status == "in_transit" -> "Trip in progress"
                tab.hasShipment && tab.status == "loading" -> "Shipment assigned"
                tab.hasShipment && tab.status == "assigned" -> "Assigned"
                tab.hasShipment -> "Tap to view shipment"
                tab.status == "called" -> "Proceed to bay"
                tab.status == "in_transit" -> "Trip in progress"
                tab.position != null -> "Position ${tab.position} in queue"
                else -> tab.status.replaceFirstChar { it.uppercase() }
            }

            //  Ticket icon tint — red when shipment attached, muted when still queuing
            if (tab.hasShipment) {
                binding.ivTabTicketIcon.setColorFilter(ContextCompat.getColor(ctx, R.color.sysu_red))
            } else {
                binding.ivTabTicketIcon.setColorFilter(ContextCompat.getColor(ctx, R.color.text_muted))
            }

            //  Status dot — green pulse when this specific shipment is the active trip
            //  (visible only for the one shipment that has an active in_transit trip)
            if (tab.hasShipment && tab.status == "in_transit" && tab.queueDocId == sessionActiveDocId) {
                binding.vTabStatusDot.visibility = View.VISIBLE
                binding.vTabStatusDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            } else {
                binding.vTabStatusDot.visibility = View.GONE
            }

            //  Card click → open Assignment screen
            binding.cardTab.setOnClickListener { onTabClick(tab) }
        }
    }

    class QueueTabDiffCallback : DiffUtil.ItemCallback<QueueTab>() {
        override fun areItemsTheSame(oldItem: QueueTab, newItem: QueueTab): Boolean =
            oldItem.queueDocId == newItem.queueDocId

        override fun areContentsTheSame(oldItem: QueueTab, newItem: QueueTab): Boolean =
            oldItem == newItem
    }
}
