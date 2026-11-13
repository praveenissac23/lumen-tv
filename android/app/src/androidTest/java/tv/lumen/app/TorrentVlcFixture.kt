package tv.lumen.app

import android.content.Context
import com.frostwire.jlibtorrent.SessionManager
import com.frostwire.jlibtorrent.SessionParams
import com.frostwire.jlibtorrent.SettingsPack
import com.frostwire.jlibtorrent.TorrentInfo
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** Owned demo video, a real seeder, and an HTTP tracker. No x.pe/DHT shortcut. */
class TorrentVlcFixture(context:Context):AutoCloseable {
    val payload=context.assets.open("demo.mp4").use{it.readBytes()}
    private val root=File(context.cacheDir,"vlc-fixture-${System.nanoTime()}").apply{mkdirs()}
    private val peerPort=ServerSocket(0).use{it.localPort}
    private val server=ServerSocket(0,8,InetAddress.getByName("127.0.0.1"))
    private val workers=Executors.newFixedThreadPool(4)
    private val seeder=SessionManager()
    val trackerRequests=AtomicInteger()
    val videoRequests=AtomicInteger()
    val hash:String
    val base="http://127.0.0.1:${server.localPort}"
    val tracker="$base/announce"
    val video="$base/video.mp4"
    init {
        val pieces=ByteArrayOutputStream()
        for(start in payload.indices step 16384)pieces.write(MessageDigest.getInstance("SHA-1").digest(payload.copyOfRange(start,minOf(start+16384,payload.size))))
        val info=ByteArrayOutputStream().apply{
            write("d6:lengthi${payload.size}e4:name11:fixture.mp412:piece lengthi16384e6:pieces${pieces.size()}:".toByteArray());write(pieces.toByteArray());write('e'.code)
        }.toByteArray()
        hash=MessageDigest.getInstance("SHA-1").digest(info).joinToString(""){"%02x".format(it.toInt() and 255)}
        val ti=TorrentInfo("d4:info".toByteArray()+info+"e".toByteArray())
        File(root,"fixture.mp4").writeBytes(payload)
        val settings=SettingsPack().listenInterfaces("127.0.0.1:$peerPort").activeSeeds(2).activeDownloads(2)
        settings.setEnableDht(false);settings.setEnableLsd(false)
        seeder.start(SessionParams(settings));seeder.download(ti,root)
        val deadline=System.currentTimeMillis()+20000
        while(seeder.find(ti)?.status()?.isSeeding!=true && System.currentTimeMillis()<deadline)Thread.sleep(80)
        check(seeder.find(ti)?.status()?.isSeeding==true){"VLC fixture seeder did not become ready"}
        Thread({while(!server.isClosed){
            val socket=try{server.accept()}catch(_:Exception){break}
            workers.execute {try{socket.use {
                it.soTimeout=10000
                val reader=it.getInputStream().bufferedReader();val request=reader.readLine()?.split(' ')?:return@use
                val headers=HashMap<String,String>()
                while(true){val line=reader.readLine();if(line.isNullOrEmpty())break;val at=line.indexOf(':');if(at>0)headers[line.substring(0,at).lowercase()]=line.substring(at+1).trim()}
                val output=it.getOutputStream()
                if(request.getOrNull(1)?.startsWith("/announce")==true){
                    trackerRequests.incrementAndGet()
                    val body="d8:intervali1e5:peers6:".toByteArray()+byteArrayOf(127,0,0,1,(peerPort shr 8).toByte(),peerPort.toByte())+"e".toByteArray()
                    output.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray());output.write(body)
                }else if(request.getOrNull(1)=="/video.mp4"){
                    videoRequests.incrementAndGet()
                    val range=headers["range"]?.let{r->Regex("bytes=(\\d+)-(\\d*)").matchEntire(r)}
                    val start=range?.groupValues?.get(1)?.toIntOrNull()?:0
                    val end=(range?.groupValues?.get(2)?.toIntOrNull()?:payload.lastIndex).coerceAtMost(payload.lastIndex)
                    val extra=if(range!=null)"Content-Range: bytes $start-$end/${payload.size}\r\n" else ""
                    output.write("HTTP/1.1 ${if(range!=null)"206 Partial Content" else "200 OK"}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: ${end-start+1}\r\n${extra}Connection: close\r\n\r\n".toByteArray())
                    if(request[0]!="HEAD")output.write(payload,start,end-start+1)
                }else output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            }}catch(_:Exception){try{socket.close()}catch(_:Exception){}} }
        }},"vlc-fixture-http").apply{isDaemon=true;start()}
    }
    override fun close(){server.close();workers.shutdownNow();seeder.stop();root.deleteRecursively()}
}
