package com.sysu.go.activities

import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.checkbox.MaterialCheckBox
import com.sysu.go.R

class RequirementEditAdapter(
    private val onCheckedChanged: (Int, Boolean) -> Unit
) : ListAdapter<RequirementItem, RequirementEditAdapter.ViewHolder>(RequirementDiffCallback()) {

    private val checkedState = mutableMapOf<Int, Boolean>()

    override fun onCreateViewHolder(parent: android.view.ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_requirement_edit, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position), checkedState[getItem(position).id] ?: false)
    }

    fun setChecked(position: Int, checked: Boolean) {
        checkedState[getItem(position).id] = checked
    }

    /**
     * Sets all checked states at once from an API requirements map.
     * and refreshes the UI.
     */
    fun setRequirementsMap(map: Map<String, Boolean>) {
        map["aircon"]?.let { checkedState[0] = it }
        map["reflectorizedVest"]?.let { checkedState[1] = it }
        map["safetyShoes"]?.let { checkedState[2] = it }
        map["headcap"]?.let { checkedState[3] = it }
        map["pants"]?.let { checkedState[4] = it }
        map["closedShoes"]?.let { checkedState[5] = it }
        notifyDataSetChanged()
    }

    /**
     * Returns checked requirements as a map for the driver profile API:
     * { "aircon" -> true, "reflectorizedVest" -> false, ... }
     */
    fun getRequirementsMap(): Map<String, Boolean> = mapOf(
        "aircon" to (checkedState[0] ?: false),
        "reflectorizedVest" to (checkedState[1] ?: false),
        "safetyShoes" to (checkedState[2] ?: false),
        "headcap" to (checkedState[3] ?: false),
        "pants" to (checkedState[4] ?: false),
        "closedShoes" to (checkedState[5] ?: false)
    )

    inner class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val ivIcon: ImageView = itemView.findViewById(R.id.ivIcon)
        private val tvLabel: TextView = itemView.findViewById(R.id.tvLabel)
        private val cb: MaterialCheckBox = itemView.findViewById(R.id.cbRequirement)

        fun bind(item: RequirementItem, checked: Boolean) {
            ivIcon.setImageResource(item.iconRes)
            tvLabel.text = item.label
            //  Remove listener before setting checked state to avoid triggering updates
            cb.setOnCheckedChangeListener(null)
            cb.isChecked = checked
            updateTint(checked)
            cb.setOnCheckedChangeListener { _, isChecked ->
                checkedState[item.id] = isChecked
                updateTint(isChecked)
                onCheckedChanged(item.id, isChecked)
            }
        }

        private fun updateTint(checked: Boolean) {
            val color = if (checked) {
                ContextCompat.getColor(itemView.context, R.color.sysu_red)
            } else {
                ContextCompat.getColor(itemView.context, R.color.text_muted)
            }
            ivIcon.setColorFilter(color)
            tvLabel.setTextColor(color)
        }
    }

    class RequirementDiffCallback : DiffUtil.ItemCallback<RequirementItem>() {
        override fun areItemsTheSame(oldItem: RequirementItem, newItem: RequirementItem) = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: RequirementItem, newItem: RequirementItem) = oldItem == newItem
    }
}

class RequirementDisplayAdapter : ListAdapter<Pair<String, Boolean>, RequirementDisplayAdapter.ViewHolder>(DisplayDiffCallback()) {

    override fun onCreateViewHolder(parent: android.view.ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_requirement_chip, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val ivIcon: ImageView = itemView.findViewById(R.id.ivChipIcon)
        private val tvLabel: TextView = itemView.findViewById(R.id.tvChipLabel)
        private val ivIndicator: ImageView = itemView.findViewById(R.id.ivChipIndicator)

        fun bind(pair: Pair<String, Boolean>) {
            val (key, checked) = pair
            val (iconRes, label) = RequirementData.getChipData(key)
            ivIcon.setImageResource(iconRes)
            tvLabel.text = label
            ivIcon.setColorFilter(
                ContextCompat.getColor(itemView.context,
                    if (checked) R.color.sysu_red else R.color.text_muted
                )
            )
            ivIndicator.setImageResource(
                if (checked) R.drawable.req_indicator_filled else R.drawable.req_indicator_empty
            )
            tvLabel.setTextColor(
                ContextCompat.getColor(itemView.context,
                    if (checked) R.color.text_primary else R.color.text_muted
                )
            )
        }
    }

    class DisplayDiffCallback : DiffUtil.ItemCallback<Pair<String, Boolean>>() {
        override fun areItemsTheSame(oldItem: Pair<String, Boolean>, newItem: Pair<String, Boolean>) =
            oldItem.first == newItem.first
        override fun areContentsTheSame(oldItem: Pair<String, Boolean>, newItem: Pair<String, Boolean>) =
            oldItem == newItem
    }
}

data class RequirementItem(
    val id: Int,
    val label: String,
    val iconRes: Int
)

object RequirementData {
    fun getAll(): List<RequirementItem> = listOf(
        RequirementItem(0, "Aircon", R.drawable.ic_req_aircon),
        RequirementItem(1, "Reflectorized Vest", R.drawable.ic_req_vest),
        RequirementItem(2, "Safety Shoes", R.drawable.ic_req_safety_shoes),
        RequirementItem(3, "Headcap", R.drawable.ic_req_headcap),
        RequirementItem(4, "Pants", R.drawable.ic_req_pants),
        RequirementItem(5, "Closed Shoes", R.drawable.ic_req_shoes)
    )

    /** Maps API string keys to the corresponding icon resource and display label. */
    fun getChipData(key: String): Pair<Int, String> = when (key) {
        "aircon" -> R.drawable.ic_req_aircon to "Aircon"
        "reflectorizedVest" -> R.drawable.ic_req_vest to "Reflectorized Vest"
        "safetyShoes" -> R.drawable.ic_req_safety_shoes to "Safety Shoes"
        "headcap" -> R.drawable.ic_req_headcap to "Headcap"
        "pants" -> R.drawable.ic_req_pants to "Pants"
        "closedShoes" -> R.drawable.ic_req_shoes to "Closed Shoes"
        else -> R.drawable.ic_req_aircon to key
    }
}
