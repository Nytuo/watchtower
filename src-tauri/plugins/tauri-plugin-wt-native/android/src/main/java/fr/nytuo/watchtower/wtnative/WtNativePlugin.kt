package fr.nytuo.watchtower.wtnative

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import java.util.ArrayDeque
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class AdvertiseArgs {
    lateinit var instance: String
    var port: Int = 0
    lateinit var serviceType: String
    var rids: Array<String> = emptyArray()
}

@InvokeArg
class BrowseArgs {
    lateinit var serviceType: String
    lateinit var onFound: Channel
}

@InvokeArg
class SecretArgs {
    lateinit var key: String
    var value: String? = null
}

@InvokeArg
class KeepAliveArgs {
    var active: Boolean = false
    var sessions: Int = 0
}

/**
 * NsdManager discovery, Android-Keystore secret storage and the foreground
 * service. Called from Rust only.
 */
@TauriPlugin
class WtNativePlugin(private val activity: Activity) : Plugin(activity) {
    private val nsd by lazy { activity.getSystemService(Context.NSD_SERVICE) as NsdManager }
    private var multicastLock: WifiManager.MulticastLock? = null
    private var registration: NsdManager.RegistrationListener? = null
    private var discovery: NsdManager.DiscoveryListener? = null
    private var found: Channel? = null

    // NsdManager.resolveService allows one resolve at a time.
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var ownName: String? = null

    /** "_watchtower-sync._tcp.local." -> "_watchtower-sync._tcp" */
    private fun nsdType(t: String): String = t.removeSuffix(".local.").removeSuffix(".")

    private fun lockMulticast() {
        if (multicastLock == null) {
            val wm = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wm.createMulticastLock("watchtower-mdns").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
    }

    private fun unlockMulticast() {
        multicastLock?.let { if (it.isHeld) it.release() }
        multicastLock = null
    }

    @Command
    fun advertise(invoke: Invoke) {
        val args = invoke.parseArgs(AdvertiseArgs::class.java)
        try {
            stopRegistration()
            lockMulticast()
            val info = NsdServiceInfo().apply {
                serviceName = args.instance
                serviceType = nsdType(args.serviceType)
                port = args.port
                setAttribute("v", "1")
                setAttribute("r", args.rids.joinToString(","))
            }
            ownName = args.instance
            val l = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(i: NsdServiceInfo) { ownName = i.serviceName }
                override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) {}
                override fun onServiceUnregistered(i: NsdServiceInfo) {}
                override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) {}
            }
            registration = l
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "advertise failed")
        }
    }

    private fun stopRegistration() {
        registration?.let { try { nsd.unregisterService(it) } catch (_: Exception) {} }
        registration = null
    }

    @Command
    fun stop_advertise(invoke: Invoke) {
        stopRegistration()
        if (discovery == null) unlockMulticast()
        invoke.resolve()
    }

    @Command
    fun browse(invoke: Invoke) {
        val args = invoke.parseArgs(BrowseArgs::class.java)
        try {
            stopDiscovery()
            lockMulticast()
            found = args.onFound
            val l = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(t: String) {}
                override fun onDiscoveryStopped(t: String) {}
                override fun onStartDiscoveryFailed(t: String, code: Int) {}
                override fun onStopDiscoveryFailed(t: String, code: Int) {}
                override fun onServiceLost(i: NsdServiceInfo) {
                    val obj = JSObject()
                    obj.put("instance", i.serviceName)
                    obj.put("addrs", JSArray())
                    obj.put("rids", JSArray())
                    obj.put("gone", true)
                    found?.send(obj)
                }
                override fun onServiceFound(i: NsdServiceInfo) {
                    if (i.serviceName == ownName) return
                    synchronized(resolveQueue) { resolveQueue.add(i) }
                    pump()
                }
            }
            discovery = l
            nsd.discoverServices(nsdType(args.serviceType), NsdManager.PROTOCOL_DNS_SD, l)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "browse failed")
        }
    }

    @Suppress("DEPRECATION")
    private fun pump() {
        synchronized(resolveQueue) {
            if (resolving) return
            val next = resolveQueue.poll() ?: return
            resolving = true
            nsd.resolveService(next, object : NsdManager.ResolveListener {
                override fun onResolveFailed(i: NsdServiceInfo, code: Int) {
                    done()
                }

                override fun onServiceResolved(i: NsdServiceInfo) {
                    try {
                        val all = if (Build.VERSION.SDK_INT >= 34) i.hostAddresses
                        else listOfNotNull(i.host)
                        // IPv4 first; scoped link-local IPv6 cannot be dialed from Rust.
                        val hosts = all.sortedBy { it.address.size != 4 }
                            .mapNotNull { it.hostAddress }
                            .filter { !it.startsWith("fe80") }
                        val r = i.attributes["r"]?.let { String(it) } ?: ""
                        if (hosts.isNotEmpty()) {
                            val obj = JSObject()
                            obj.put("instance", i.serviceName)
                            obj.put("addrs", JSArray().apply {
                                hosts.forEach { h ->
                                    put(if (h.contains(":")) "[${h.substringBefore('%')}]:${i.port}" else "$h:${i.port}")
                                }
                            })
                            obj.put("rids", JSArray().apply {
                                r.split(",").filter { it.isNotEmpty() }.forEach { put(it) }
                            })
                            found?.send(obj)
                        }
                    } finally {
                        done()
                    }
                }

                private fun done() {
                    synchronized(resolveQueue) { resolving = false }
                    pump()
                }
            })
        }
    }

    private fun stopDiscovery() {
        discovery?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {} }
        discovery = null
        found = null
        synchronized(resolveQueue) { resolveQueue.clear(); resolving = false }
    }

    @Command
    fun stop_browse(invoke: Invoke) {
        stopDiscovery()
        if (registration == null) unlockMulticast()
        invoke.resolve()
    }

    // ---------------- Keystore-backed secrets ----------------

    private val ks: KeyStore by lazy { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }
    private val prefs by lazy { activity.getSharedPreferences("wt_secrets", Context.MODE_PRIVATE) }

    private fun masterKey(): SecretKey {
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    @Command
    fun secret_set(invoke: Invoke) {
        val a = invoke.parseArgs(SecretArgs::class.java)
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, masterKey())
            val ct = c.doFinal((a.value ?: "").toByteArray())
            val blob = Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)
            prefs.edit().putString(a.key, blob).apply()
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "could not store secret")
        }
    }

    @Command
    fun secret_get(invoke: Invoke) {
        val a = invoke.parseArgs(SecretArgs::class.java)
        try {
            val blob = prefs.getString(a.key, null)
            val out = JSObject()
            if (blob == null) {
                out.put("value", null as String?)
            } else {
                val raw = Base64.decode(blob, Base64.NO_WRAP)
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(128, raw, 0, 12))
                out.put("value", String(c.doFinal(raw, 12, raw.size - 12)))
            }
            invoke.resolve(out)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "could not read secret")
        }
    }

    @Command
    fun secret_delete(invoke: Invoke) {
        val a = invoke.parseArgs(SecretArgs::class.java)
        prefs.edit().remove(a.key).apply()
        invoke.resolve()
    }

    // ---------------- Foreground service ----------------

    @Command
    fun keepalive(invoke: Invoke) {
        val a = invoke.parseArgs(KeepAliveArgs::class.java)
        try {
            val i = Intent(activity, SessionService::class.java)
            if (a.active && a.sessions > 0) {
                if (Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED
                ) {
                    ActivityCompat.requestPermissions(
                        activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4202
                    )
                }
                i.putExtra(SessionService.EXTRA_SESSIONS, a.sessions)
                ContextCompat.startForegroundService(activity, i)
            } else {
                activity.stopService(i)
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "keepalive failed")
        }
    }

    companion object {
        private const val KEY_ALIAS = "watchtower_master_secret"
    }
}
