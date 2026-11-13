package tv.lumen.app

import android.content.ContextWrapper
import android.media.MediaMetadataRetriever
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.frostwire.jlibtorrent.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class TorrentEngineTest {
    @Test fun localPeerTorrentProducesSeekablePlayableVideoWithoutDebrid() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val temp=File(context.cacheDir,"native-torrent-test-${System.nanoTime()}").apply{mkdirs()}
        val isolated=object:ContextWrapper(context){override fun getCacheDir()=temp}
        val payload=context.assets.open("demo.mp4").use{it.readBytes()}
        val pieces=ByteArrayOutputStream()
        var offset=0
        while(offset<payload.size){pieces.write(MessageDigest.getInstance("SHA-1").digest(payload.copyOfRange(offset,minOf(offset+16384,payload.size))));offset+=16384}
        val info=ByteArrayOutputStream().apply{
            write("d6:lengthi${payload.size}e4:name11:fixture.mp412:piece lengthi16384e6:pieces${pieces.size()}:".toByteArray());write(pieces.toByteArray());write('e'.code)
        }.toByteArray()
        val torrent="d4:info".toByteArray()+info+"e".toByteArray()
        val hash=MessageDigest.getInstance("SHA-1").digest(info).joinToString(""){"%02x".format(it.toInt() and 255)}
        val seedDir=File(temp,"seed").apply{mkdirs()};File(seedDir,"fixture.mp4").writeBytes(payload)
        val port=ServerSocket(0).use{it.localPort}
        val settings=SettingsPack().listenInterfaces("127.0.0.1:$port").activeSeeds(2).activeDownloads(2)
        settings.setEnableDht(false);settings.setEnableLsd(false)
        val seeder=SessionManager();seeder.start(SessionParams(settings))
        val engine=TorrentEngine(isolated,false)
        try {
            val ti=TorrentInfo(torrent);assertTrue(ti.isValid)
            seeder.download(ti,seedDir)
            val deadline=System.currentTimeMillis()+20000
            while(System.currentTimeMillis()<deadline && seeder.find(ti)?.status()?.isSeeding!=true)Thread.sleep(100)
            assertTrue("Fixture seeder must be ready",seeder.find(ti)?.status()?.isSeeding==true)
            val metadata=engine.prepare("magnet:?xt=urn:btih:$hash&x.pe=127.0.0.1:$port")
            assertEquals(hash,metadata.getString("hash"));assertEquals("fixture.mp4",metadata.getJSONArray("files").getJSONObject(0).getString("name"))
            val result=engine.startStream(hash,0);val url=result.getString("url")
            assertTrue(url.startsWith("http://127.0.0.1:"));assertEquals(payload.size.toLong(),result.getLong("size"))
            fun request(range:String?,method:String="GET"):kotlin.Pair<HttpURLConnection,ByteArray>{
                val c=URL(url).openConnection() as HttpURLConnection;c.connectTimeout=10000;c.readTimeout=20000;c.requestMethod=method
                if(range!=null)c.setRequestProperty("Range",range)
                val code=c.responseCode;val bytes=if(method=="HEAD"||code>=400)ByteArray(0)else c.inputStream.use{it.readBytes()}
                return c to bytes
            }
            val (range,bytes)=request("bytes=12345-52345")
            assertEquals(206,range.responseCode);assertEquals("bytes 12345-52345/${payload.size}",range.getHeaderField("Content-Range"));assertArrayEquals(payload.copyOfRange(12345,52346),bytes);range.disconnect()
            val(tail,end)=request("bytes=-128");assertEquals(206,tail.responseCode);assertArrayEquals(payload.takeLast(128).toByteArray(),end);tail.disconnect()
            val(head,_)=request(null,"HEAD");assertEquals(200,head.responseCode);assertEquals(payload.size.toLong(),head.getHeaderFieldLong("Content-Length",-1));head.disconnect()
            val(bad,_bad)=request("bytes=${payload.size}-");assertEquals(416,bad.responseCode);bad.disconnect()
            val retriever=MediaMetadataRetriever()
            try { retriever.setDataSource(url,emptyMap());assertTrue("Android must parse the video from the torrent HTTP stream",(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?:0)>0);val frame=retriever.getFrameAtTime(1000000);assertNotNull("Android must decode a video frame from the torrent stream",frame);frame?.recycle() } finally {retriever.release()}
            val pool=Executors.newSingleThreadExecutor()
            try {
                val future=pool.submit<Boolean>{try{engine.prepare("magnet:?xt=urn:btih:${"f".repeat(40)}");false}catch(_:Exception){true}}
                Thread.sleep(300);engine.cancelPending();assertTrue("Cancellation must stop metadata wait",future.get(5,TimeUnit.SECONDS))
            }finally{pool.shutdownNow()}
        } finally {engine.close();seeder.stop();temp.deleteRecursively()}
    }
}
