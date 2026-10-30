package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemMyTripObdBinding

/**
 * RecyclerView adapter for the OBD items list inside MyTripActivity.
 *
 * Each row shows: OBD number, customer name, quantity, color-coded status pill,
 * and a camera icon (shown only after POD photo is captured).
 *
 * Clicking any row opens [ObdStatusBottomSheet] for POD status selection.
 *
 * @param onItemClick Called when a row is tapped: (lineItem, position)
 */
class ObdTripAdapter(
    private val onItemClick: (item: Map<String, Any?>, position: Int) -> Unit
) : ListAdapter<Map<String, Any?>, ObdTripAdapter.ObdTripViewHolder>(ObdTripDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ObdTripViewHolder {
        val binding = ItemMyTripObdBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return ObdTripViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ObdTripViewHolder, position: Int) {
        holder.bind(getItem(position), position)
    }

    inner class ObdTripViewHolder(
        private val binding: ItemMyTripObdBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: Map<String, Any?>, position: Int) {
            val ctx = binding.root.context

            //  OBD number can arrive as a numeric Long or Integer from the API.
            binding.tvObdNumber.text = when (val nn = item["obdNumber"]) {
                is String -> nn.ifBlank { "—" }
                is Number -> nn.toString()
                else -> (nn as? String)?.ifBlank { "—" } ?: "—"
            }

            //  Customer name — combine name + address if both exist
            val customerName = item["customerName"] as? String ?: "—"
            binding.tvCustomerName.text = customerName

            //  Quantity — supports double/float
            val qty = (item["quantity"] as? Number)?.toDouble()
            binding.tvQuantity.text = if (qty != null) {
                if (qty == qty.toLong().toDouble()) qty.toLong().toString()
                else qty.toString()
            } else {
                "—"
            }

            //  Delivery Status — delivered/rejected/delivered_w_rej are compared case-insensitively
            val deliveryStatus = (item["deliveryStatus"] as? String)?.trim()?.uppercase() ?: ""
            bindStatusPill(binding, ctx, deliveryStatus)

            //  POD camera indicator — visible only after photo is captured
            val podImageUrl = item["podImageUrl"] as? String
            binding.ivPodIndicator.isVisible = !podImageUrl.isNullOrBlank()

            //  Row click — opens ObdStatusBottomSheet for this OBD item
            binding.root.setOnClickListener {
                onItemClick(item, bindingAdapterPosition)
            }
        }

        private fun bindStatusPill(
            binding: ItemMyTripObdBinding,
            ctx: android.content.Context,
            status: String?
        ) {
            //  All comparisons use .uppercase() on both sides — status is already upper-cased by caller.
            val (text, textColor, bgDrawable) = when (status?.uppercase()) {
                ctx.getString(R.string.pod_status_delivered).uppercase() -> Triple(
                    ctx.getString(R.string.pod_delivered_label),
                    R.color.white,
                    R.drawable.bg_status_pill_green
                )
                ctx.getString(R.string.pod_status_rejected).uppercase() -> Triple(
                    ctx.getString(R.string.pod_rejected_label),
                    R.color.white,
                    R.drawable.bg_status_pill_red
                )
                ctx.getString(R.string.pod_status_delivered_rejection).uppercase() -> Triple(
                    ctx.getString(R.string.pod_delivered_with_rejection_label),
                    R.color.white,
                    R.drawable.bg_status_pill_amber
                )
                else -> Triple(
                    ctx.getString(R.string.pod_pending_label),
                    R.color.text_secondary,
                    R.drawable.bg_status_pill_gray
                )
            }

            binding.tvDeliveryStatus.text = text
            binding.tvDeliveryStatus.setTextColor(ContextCompat.getColor(ctx, textColor))
            binding.tvDeliveryStatus.setBackgroundResource(bgDrawable)
        }
    }

    class ObdTripDiffCallback : DiffUtil.ItemCallback<Map<String, Any?>>() {
        override fun areItemsTheSame(
            oldItem: Map<String, Any?>,
            newItem: Map<String, Any?>
        ): Boolean {
            return oldItem["obdNumber"] == newItem["obdNumber"]
        }

        override fun areContentsTheSame(
            oldItem: Map<String, Any?>,
            newItem: Map<String, Any?>
        ): Boolean {
            return oldItem.size == newItem.size && oldItem.all { (key, value) ->
                newItem.containsKey(key) && newItem[key] == value
            }
        }
    }
}
