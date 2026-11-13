package tv.lumen.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exercises the actual JS bridge and installed VLC, including Lumen going into the background. */
@RunWith(AndroidJUnit4::class)
class VlcHandoffTest {
    @Test fun actualVlcPlaysDirectAndTrackerDiscoveredTorrentAndSurvivesEmptyActivityResult() {
        val ins=InstrumentationRegistry.getInstrumentation();val context=ins.targetContext
        context.packageManager.getPackageInfo("org.videolan.vlc",0) // Required test dependency, never silently skipped.
        val act=ins.startActivitySync(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val screenshots=File(context.getExternalFilesDir(null),"vlc-tests").apply{mkdirs()}
        fun shell(command:String)=ParcelFileDescriptor.AutoCloseInputStream(ins.uiAutomation.executeShellCommand(command)).bufferedReader().use{it.readText()}
        fun js(expression:String):String {
            val done=CountDownLatch(1);var answer="null"
            ins.runOnMainSync{act.webView.evaluateJavascript(expression){answer=it;done.countDown()}}
            check(done.await(5,TimeUnit.SECONDS)){"JS bridge did not respond"};return answer
        }
        fun waitFor(label:String,timeout:Long=20000,condition:()->Boolean){
            val until=System.currentTimeMillis()+timeout
            while(System.currentTimeMillis()<until){if(condition())return;Thread.sleep(200)}
            File(screenshots,"failure-media-session.txt").writeText(shell("dumpsys media_session"))
            File(screenshots,"failure-activities.txt").writeText(shell("dumpsys activity activities"))
            fail(label)
        }
        fun vlcPlaying():Boolean {
            val sessions=shell("dumpsys media_session")
            return sessions.contains("org.videolan.vlc") && Regex("state=3\\b").containsMatchIn(sessions)
        }
        fun screenshot(name:String){ins.uiAutomation.takeScreenshot()?.let{bitmap->File(screenshots,name).outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()}}
        fun chooseVlc(index:Int){
            assertEquals("true",js("__sourceTest.focus($index);true"))
            ins.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("OK did not open source actions"){js("__sourceTest.state().menus===1")=="true"}
            ins.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
        }
        TorrentVlcFixture(context).use { fixture ->
            try {
                val streams="""{"streams":[{"url":${JSONObject.quote(fixture.video)},"name":"1080p direct fixture"},{"infoHash":"${fixture.hash}","fileIdx":0,"name":"720p tracker fixture","sources":[${JSONObject.quote("tracker:"+fixture.tracker)}]}]}"""
                val bootstrap="""
                    const actual=window.Native,bodies=new Map();window.__handoffs=[];
                    window.Native={deviceInfo:()=>actual.deviceInfo(),cacheRead:()=>null,cacheWrite:()=>{},apps:()=>actual.apps(),
                      http:(id,url)=>setTimeout(()=>{bodies.set(id,${JSONObject.quote(streams)});__nat('http',{id,ok:true});},0),
                      take:id=>{if(bodies.has(id)){const v=bodies.get(id);bodies.delete(id);return v;}return actual.take(id);},
                      torrentPrepare:(id,magnet)=>actual.torrentPrepare(id,magnet),torrentStart:(id,hash,file)=>actual.torrentStart(id,hash,file),torrentCancel:()=>actual.torrentCancel(),
                      openWith:(pkg,url,options)=>{__handoffs.push({pkg,url});return actual.openWith(pkg,url,options);}};
                """.trimIndent()
                val bundle=ins.context.assets.open("source-actions-ui.js").bufferedReader().use{it.readText()}
                ins.runOnMainSync{act.webView.loadDataWithBaseURL("file:///android_asset/web/","<body><script>$bootstrap</script><script>$bundle</script>","text/html","utf-8",null);act.webView.requestFocus()}
                waitFor("Source fixture failed to load"){js("!!window.__sourceTest && __sourceTest.ready()")=="true"}
                chooseVlc(0)
                waitFor("Installed VLC did not play the direct video",30000){vlcPlaying() && fixture.videoRequests.get()>0}
                Thread.sleep(1400);assertTrue("Direct playback stopped immediately",vlcPlaying());screenshot("vlc-direct-video.png")
                shell("am force-stop org.videolan.vlc")
                waitFor("Lumen did not return after VLC"){shell("dumpsys activity activities").lineSequence().any{it.contains("mResumedActivity")&&it.contains("tv.lumen.app")}}
                ins.runOnMainSync{act.webView.requestFocus()}
                chooseVlc(1)
                waitFor("Installed VLC did not play the tracker-discovered torrent",70000){vlcPlaying() && (TorrentRuntime.current?.bytesServed?.get()?:0)>1024}
                assertTrue("Tracker discovery was bypassed",fixture.trackerRequests.get()>0)
                // Single-task players can report an empty cancellation as they open.
                ins.runOnMainSync {
                    val callback=MainActivity::class.java.getDeclaredMethod("onActivityResult",Int::class.javaPrimitiveType,Int::class.javaPrimitiveType,Intent::class.java)
                    callback.isAccessible=true;callback.invoke(act,MainActivity.REQ_EXT,Activity.RESULT_CANCELED,null)
                }
                Thread.sleep(1400)
                assertNotNull("Empty activity result killed the torrent engine",TorrentRuntime.current)
                assertTrue("VLC stopped while Lumen handled an empty result",vlcPlaying())
                val handoff=org.json.JSONTokener(js("JSON.stringify(__handoffs[1])")).nextValue() as String
                val url=JSONObject(handoff).getString("url")
                val request=URL(url).openConnection() as HttpURLConnection
                request.setRequestProperty("Range","bytes=0-1023");request.readTimeout=5000
                try{assertEquals(206,request.responseCode);assertEquals(1024,request.inputStream.use{it.readBytes()}.size)}finally{request.disconnect()}
                screenshot("vlc-torrent-video.png")
                File(screenshots,"verified.txt").writeText("Installed VLC direct playback: PASS\nTracker-only peer discovery: PASS\nNative bridge torrent playback while Lumen is backgrounded: PASS\nEmpty activity result keeps stream available: PASS\n"+shell("dumpsys media_session"))
            } finally {
                screenshot("final-state.png");shell("am force-stop org.videolan.vlc");TorrentRuntime.stop(context)
                ins.runOnMainSync{act.finish()}
            }
        }
    }
}
