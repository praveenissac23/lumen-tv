package tv.lumen.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/** Keeps the local stream alive while VLC is the foreground app. */
class TorrentPlaybackService : Service() {
    private val handler=Handler(Looper.getMainLooper())
    private val idleCheck=object:Runnable {
        override fun run() { val e=TorrentRuntime.current;if(e!=null && e.connections.get()==0 && System.currentTimeMillis()-e.lastUsed>5*60000)TorrentRuntime.stop(this@TorrentPlaybackService) else handler.postDelayed(this,30000) }
    }
    override fun onCreate() {
        super.onCreate()
        val manager=getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if(Build.VERSION.SDK_INT>=26) manager.createNotificationChannel(NotificationChannel("torrent-playback","Torrent playback",NotificationManager.IMPORTANCE_LOW))
        val back=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop=PendingIntent.getService(this,1,Intent(this,TorrentPlaybackService::class.java).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder=if(Build.VERSION.SDK_INT>=26) Notification.Builder(this,"torrent-playback") else Notification.Builder(this)
        startForeground(83,builder.setSmallIcon(R.drawable.ic_torrent_status).setContentTitle("Lumen torrent playback")
            .setContentText("Streaming on this device").setContentIntent(back).setOngoing(true)
            .addAction(Notification.Action.Builder(null,"Stop",stop).build()).build())
        handler.postDelayed(idleCheck,30000)
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int { if(intent?.action=="stop")TorrentRuntime.stop(this);return START_NOT_STICKY }
    override fun onDestroy() { handler.removeCallbacks(idleCheck);TorrentRuntime.stop(this);super.onDestroy() }
    override fun onBind(intent:Intent?):IBinder?=null
}

object TorrentRuntime {
    private val executor=Executors.newSingleThreadExecutor()
    private val generation=AtomicInteger()
    @Volatile var current:TorrentEngine?=null;private set
    fun prepare(context:Context,uri:String,reply:(JSONObject?,String?)->Unit) {
        val request=generation.incrementAndGet();current?.cancelPending()
        executor.execute {
            if(request!=generation.get()){reply(null,"Selection cancelled");return@execute}
            try {
                val engine=current ?: TorrentEngine(context.applicationContext).also { current=it }
                val result=engine.prepare(uri)
                if(request==generation.get())reply(result,null)else reply(null,"Selection cancelled")
            } catch(e:Throwable) { reply(null,e.message?:"Torrent engine could not start");if(request==generation.get())stop(context) }
        }
    }
    fun start(context:Context,hash:String,file:Int,reply:(JSONObject?,String?)->Unit) {
        val request=generation.get()
        executor.execute {
            try { val result=current?.startStream(hash,file) ?: throw IllegalStateException("Choose this source again");if(request==generation.get())reply(result,null)else reply(null,"Selection cancelled") }
            catch(e:Throwable){reply(null,e.message?:"Torrent playback could not start");if(request==generation.get())stop(context)}
        }
    }
    fun stop(context:Context) {
        val request=generation.incrementAndGet();current?.cancelPending()
        executor.execute {
            if(request==generation.get()){
                current?.close();current=null
                Handler(Looper.getMainLooper()).post { if(request==generation.get()) context.stopService(Intent(context,TorrentPlaybackService::class.java)) }
            }
        }
    }
}
