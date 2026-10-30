package com.sysu.go.activities

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.databinding.ItemGuardSelectionBinding
import com.sysu.go.model.SecurityGuard

class GuardSelectionAdapter(
    guards: List<SecurityGuard>,
    private var selectionEnabled: Boolean = true,
    private val onGuardSelected: (SecurityGuard) -> Unit
) : RecyclerView.Adapter<GuardSelectionAdapter.GuardViewHolder>() {

    private val guards = guards.toMutableList()

    fun submitGuards(updated: List<SecurityGuard>, selectionEnabled: Boolean = this.selectionEnabled) {
        guards.clear()
        guards.addAll(updated)
        this.selectionEnabled = selectionEnabled
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): GuardViewHolder {
        val binding = ItemGuardSelectionBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return GuardViewHolder(binding)
    }

    override fun onBindViewHolder(holder: GuardViewHolder, position: Int) {
        holder.bind(guards[position])
    }

    override fun getItemCount(): Int = guards.size

    inner class GuardViewHolder(
        private val binding: ItemGuardSelectionBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(guard: SecurityGuard) {
            binding.tvInitial.text = guard.firstName.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
            binding.tvGuardName.text = guard.fullName
            binding.tvGuardId.text = guard.guardId
            binding.root.isEnabled = selectionEnabled
            binding.root.alpha = if (selectionEnabled) 1f else 0.55f
            binding.root.setOnClickListener { if (selectionEnabled) onGuardSelected(guard) }
        }
    }
}
