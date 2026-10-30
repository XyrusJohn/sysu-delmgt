package com.sysu.go.utils

import android.util.Log
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Tracks the driver's local tracking state (ONLINE / STOPPED / OFFLINE)
 * and notifies listening Activities so they can update UI indicators
 * without any network calls.
 *
 * OFFLINE is also pushed by ConnectivityMonitor — both sources are
 * combined here so each Activity only needs one listener registration.
 */
object TrackingStateMonitor {

    private const val TAG = "TRACKING_STATE_DEFINITIVE"

    enum class State {
        /** Driver is actively moving — green indicator */
        ONLINE,
        /** Driver has been stationary 60+ seconds — yellow indicator */
        STOPPED,
        /** Network lost / battery critical / force-stopped — red indicator */
        OFFLINE
    }

    interface Listener {
        /**
         * Called whenever the tracking state changes.
         * @param state the new tracking state
         */
        fun onTrackingStateChanged(state: State)
    }

    private val listeners = CopyOnWriteArrayList<Listener>()
    private var currentState: State = State.ONLINE

    fun addListener(listener: Listener) {
        listeners.add(listener)
        Log.d(TAG, "[LISTENER] Added tracking state listener - total listeners: ${listeners.size}")
        //  Immediately notify of current state so UI is never stale
        listener.onTrackingStateChanged(currentState)
    }

    fun removeListener(listener: Listener) {
        listeners.remove(listener)
        Log.d(TAG, "[LISTENER] Removed tracking state listener - total listeners: ${listeners.size}")
    }

    /** Called by LocationServices or ConnectivityMonitor to push state changes */
    fun setState(state: State) {
        if (state != currentState) {
            Log.d(TAG, "[STATE] Tracking state: $currentState → $state")
            currentState = state
            listeners.forEach { it.onTrackingStateChanged(state) }
            Log.d(TAG, "[STATE] Tracking state change propagated to ${listeners.size} listeners")
        } else {
            Log.d(TAG, "[STATE] Tracking state change ignored - already $state")
        }
    }

    fun getCurrentState(): State {
        Log.d(TAG, "[STATE] getCurrentState called: $currentState")
        return currentState
    }
}