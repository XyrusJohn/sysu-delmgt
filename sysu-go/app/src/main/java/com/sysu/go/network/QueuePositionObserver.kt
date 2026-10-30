package com.sysu.go.network

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import android.content.Context
import com.sysu.go.utils.SessionManager
import kotlinx.coroutines.Job

//  The backend emits only this authenticated driver's FIFO rank, never queue records.
fun observeQueuePosition(owner: LifecycleOwner, queueId: String, receive: (Int?) -> Unit): Job {
    val session = (owner as? Context)?.let(::SessionManager)
    val uid = session?.getDriverId()
    val job = Job()
    val mainHandler = Handler(Looper.getMainLooper())
    var unsubscribe: (() -> Unit)? = null

    fun stopSubscription() {
        unsubscribe?.invoke()
        unsubscribe = null
    }

    fun startSubscription() {
        if (job.isCancelled || unsubscribe != null || uid == null || session?.getDriverId() != uid) return
        unsubscribe = SocketManager.subscribeRealtime(
            topic = "queuePosition",
            params = mapOf("queueId" to queueId),
            onData = { payload ->
                val data = payload as? Map<*, *> ?: return@subscribeRealtime
                if (data["queueId"] != queueId || session?.getDriverId() != uid) return@subscribeRealtime
                receive((data["position"] as? Number)?.toInt())
            },
            onError = { error ->
                Log.w("QueuePosition", "Queue position unavailable: $error")
                receive(null)
            },
        )
    }

    val observer = LifecycleEventObserver { _, event ->
        when (event) {
            Lifecycle.Event.ON_START -> startSubscription()
            Lifecycle.Event.ON_STOP -> stopSubscription()
            Lifecycle.Event.ON_DESTROY -> job.cancel()
            else -> Unit
        }
    }
    owner.lifecycle.addObserver(observer)
    job.invokeOnCompletion {
        mainHandler.post {
            stopSubscription()
            owner.lifecycle.removeObserver(observer)
        }
    }
    if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) startSubscription()
    return job
}
