package com.karelian.aventura

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * A foreground service that keeps the process alive and the CPU awake
 * while AI text generation is in progress.
 *
 * Started from [MainActivity] via the `AndroidBridge` JavaScript interface
 * when the user triggers a generation and the "Background Generation"
 * experimental feature is enabled.
 *
 * The service:
 * - Posts a persistent notification ("Generating story…") so Android
 *   treats the process as foreground-priority.
 * - Acquires a [PowerManager.PARTIAL_WAKE_LOCK] with a 10-minute timeout
 *   so the CPU stays on even when the screen is off.
 * - Automatically releases the wake lock and stops when
 *   [stopGenerationService] is called from JS (or after the 10-min safety timeout).
 */
class GenerationForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "generation_channel"
        const val NOTIFICATION_ID = 1001
        private const val WAKE_LOCK_TAG = "aventura:generation"
        private const val WAKE_LOCK_TIMEOUT_MS = 10L * 60 * 1000 // 10 minutes
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        createWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)
        acquireWakeLock()
        return START_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // -- Notification ----------------------------------------------------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Story Generation",
                NotificationManager.IMPORTANCE_LOW   // no sound, minimal visual
            ).apply {
                description = "Shown while AI text generation is running in the background"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        // Tapping the notification returns to the app
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Generating story…")
            .setContentText("AI generation is running. Tap to return.")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pendingIntent)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    // -- Wake Lock -------------------------------------------------------------

    private fun createWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    }

    private fun acquireWakeLock() {
        wakeLock?.let {
            if (!it.isHeld) it.acquire(WAKE_LOCK_TIMEOUT_MS)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }
}