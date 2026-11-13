package tv.lumen.app

import android.content.Intent
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class SourceRemoteTest {
    @Test fun dpadCenterAndMenuOpenTheSameSourceActions() {
        val ins=InstrumentationRegistry.getInstrumentation()
        val act=ins.startActivitySync(Intent(ins.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        fun js(expression:String):String {
            val latch=CountDownLatch(1);var result="null"
            ins.runOnMainSync { act.webView.evaluateJavascript(expression){ result=it;latch.countDown() } }
            assertTrue(latch.await(5,TimeUnit.SECONDS));return result
        }
        fun state():JSONObject {val raw=JSONTokener(js("JSON.stringify(__sourceTest.state())")).nextValue() as String;return JSONObject(raw)}
        fun waitFor(expression:String) {val deadline=System.currentTimeMillis()+10000;while(System.currentTimeMillis()<deadline){if(js(expression)=="true")return;Thread.sleep(50)};fail("Remote fixture timed out: $expression")}
        try {
            val bootstrap="""
                window.__handoffs=[];const bodies=new Map();
                window.Native={cacheRead:()=>null,cacheWrite:()=>{},deviceInfo:()=>'{"fireTv":true}',apps:()=>JSON.stringify([{pkg:'org.videolan.vlc',name:'VLC',role:'player'},{pkg:'idm.internet.download.manager',name:'1DM',role:'download'}]),take:id=>{const r=bodies.get(id);bodies.delete(id);return r;},
                http:(id,url)=>setTimeout(()=>{bodies.set(id,JSON.stringify({streams:[{url:'https://fixture.invalid/video.mp4',name:'1080p'},{infoHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',name:'720p'}]}));__nat('http',{id,ok:true});},0),openWith:(pkg,url,options)=>{__handoffs.push({pkg,url,options});return true;}};
            """.trimIndent()
            val bundle=ins.context.assets.open("source-actions-ui.js").bufferedReader().use{it.readText()}
            val html="<!doctype html><body><script>$bootstrap</script><script>$bundle</script>"
            ins.runOnMainSync { act.webView.loadDataWithBaseURL("file:///android_asset/web/",html,"text/html","utf-8",null);act.webView.requestFocus() }
            waitFor("!!window.__sourceTest && __sourceTest.ready()")
            js("__sourceTest.focus(1);true")
            ins.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("__sourceTest.state().menus===1")
            val menu=state();assertTrue(menu.getString("menu").contains("Play in VLC"));assertTrue(menu.getString("menu").contains("Upload to AllDebrid"));assertTrue(menu.getString("menu").contains("Download using"));assertEquals(0,menu.getInt("handoffs"));assertEquals(0,menu.getInt("topControls"))
            ins.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);waitFor("__sourceTest.state().menus===0")
            ins.sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);waitFor("__sourceTest.state().menus===1")
            assertEquals(menu.getString("menu"),state().getString("menu"))
            ins.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);waitFor("__sourceTest.state().menus===0")
            js("__sourceTest.focus(0);true");ins.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);waitFor("__sourceTest.state().menus===1")
            ins.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);waitFor("__sourceTest.state().handoffs===1")
            assertTrue(js("__handoffs[0].pkg==='org.videolan.vlc'")=="true")
        }finally{ins.runOnMainSync{act.finish()}}
    }
}
