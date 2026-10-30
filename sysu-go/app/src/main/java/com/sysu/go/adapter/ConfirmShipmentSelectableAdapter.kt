package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemConfirmShipmentSelectableBinding
import com.sysu.go.model.Assignment

class ConfirmShipmentSelectableAdapter(
    private val shipments: List<Assignment>,
    private val selectedDocIds: MutableSet<String>,
    private val onSelectionChanged: (selectedCount: Int, totalCount: Int) -> Unit
) : RecyclerView.Adapter<ConfirmShipmentSelectableAdapter.ViewHolder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemConfirmShipmentSelectableBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(shipments[position])
    }

    override fun getItemCount(): Int = shipments.size

    fun selectAll() {
        selectedDocIds.clear()
        shipments.forEach { selectedDocIds.add(it.docId) }
        notifyDataSetChanged()
        onSelectionChanged(selectedDocIds.size, shipments.size)
    }

    fun deselectAll() {
        selectedDocIds.clear()
        notifyDataSetChanged()
        onSelectionChanged(0, shipments.size)
    }

    inner class ViewHolder(val binding: ItemConfirmShipmentSelectableBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: Assignment) {
            val ctx = binding.root.context
            val isChecked = selectedDocIds.contains(item.docId)

            binding.tvShipmentNumber.text = "Shipment #${item.shipmentNumber}"

            val subtitle = buildString {
                if (item.plateNumber.isNotBlank()) append(item.plateNumber) else append("No plate")
                if (item.helper.isNotBlank()) append("  •  ${item.helper}")
            }
            binding.tvShipmentSubtitle.text = subtitle

            val obdText = if (item.obdCount > 0) "${item.obdCount} OBD items" else if (item.lineItems.isNotEmpty()) "${item.lineItems.size} OBD items" else "Shipment Details Ready"
            binding.tvObdInfo.text = obdText

            //  Guard status badge
            if (item.guardVerified) {
                binding.tvItemGuardBadge.visibility = View.VISIBLE
                binding.tvItemGuardBadge.text = "Verified"
                binding.tvItemGuardBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
                binding.tvItemGuardBadge.setTextColor(ContextCompat.getColor(ctx, R.color.white))
            } else {
                binding.tvItemGuardBadge.visibility = View.VISIBLE
                binding.tvItemGuardBadge.text = "Pending Guard"
                binding.tvItemGuardBadge.setBackgroundResource(R.drawable.bg_status_pill_amber)
                binding.tvItemGuardBadge.setTextColor(ContextCompat.getColor(ctx, R.color.white))
            }

            //  Checkbox state without triggering infinite listener loop
            binding.cbShipmentConfirm.setOnCheckedChangeListener(null)
            binding.cbShipmentConfirm.isChecked = isChecked

            val toggleAction = {
                val newChecked = !selectedDocIds.contains(item.docId)
                if (newChecked) {
                    selectedDocIds.add(item.docId)
                } else {
                    selectedDocIds.remove(item.docId)
                }
                binding.cbShipmentConfirm.isChecked = newChecked
                onSelectionChanged(selectedDocIds.size, shipments.size)
            }

            binding.cbShipmentConfirm.setOnClickListener {
                if (binding.cbShipmentConfirm.isChecked) {
                    selectedDocIds.add(item.docId)
                } else {
                    selectedDocIds.remove(item.docId)
                }
                onSelectionChanged(selectedDocIds.size, shipments.size)
            }

            binding.cardConfirmItem.setOnClickListener {
                toggleAction()
            }
        }
    }
}
