package tv.lumen.app

import android.content.Context
import com.frostwire.jlibtorrent.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/** One lazy torrent session, one selected file and a loopback HTTP stream for VLC. */
class TorrentEngine(private val context: Context, private val discovery: Boolean = true) {
    private val root = File(context.cacheDir, "torrent-playback").apply { mkdirs() }
    private val session = SessionManager()
    private val clients = java.util.concurrent.ConcurrentHashMap.newKeySet<Socket>()
    private val workers = ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(8))
    @Volatile private var closed = false
    @Volatile private var cancelled = false
    @Volatile private var active: Selection? = null
    @Volatile var lastUsed = System.currentTimeMillis(); private set
    val connections = AtomicInteger()
    val bytesServed = AtomicLong()
    private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private var metadata: TorrentInfo? = null
    private var handle: TorrentHandle? = null
    private var magnet = ""
    private var directory: File? = null
    data class Selection(val token: String, val info: TorrentInfo, val handle: TorrentHandle, val file: Int, val path: File, val size: Long, val offset: Long)

    init {
        root.listFiles()?.forEach { it.deleteRecursively() }
        val settings = SettingsPack().connectionsLimit(48).activeDownloads(0).activeSeeds(0).activeLimit(0)
            .maxPeerlistSize(200).maxQueuedDiskBytes(2 * 1024 * 1024).downloadRateLimit(16 * 1024 * 1024)
            .listenInterfaces("0.0.0.0:0").uploadRateLimit(64 * 1024)
        settings.setEnableDht(discovery); settings.setEnableLsd(discovery)
        session.start(SessionParams(settings))
        thread(name="lumen-torrent-http", isDaemon=true) {
            while (!closed) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                clients.add(socket)
                try { workers.execute { try { serve(socket) } catch (_: Exception) {} finally { clients.remove(socket); try { socket.close() } catch (_: Exception) {} } } }
                catch (_: Exception) { clients.remove(socket); socket.close() }
            }
        }
    }

    fun prepare(uri: String): JSONObject {
        check(!closed) { "Torrent playback was stopped" }
        val hash = Regex("(?i)urn:btih:([a-f0-9]{40})").find(uri)?.groupValues?.get(1)?.lowercase()
            ?: throw IllegalArgumentException("This torrent link is not supported")
        cancelled=false
        lastUsed = System.currentTimeMillis()
        if (metadata?.infoHashV1()?.toHex() != hash) {
            active = null; clients.forEach { try { it.close() } catch (_: Exception) {} }
            handle?.let { session.remove(it) }; handle = null
            directory?.deleteRecursively()
            session.download(uri,root,TorrentFlags.UPLOAD_MODE.or_(TorrentFlags.STOP_WHEN_READY))
            val deadline=System.currentTimeMillis()+35000
            var candidate: TorrentHandle?=null
            var info: TorrentInfo?=null
            try {
                while(!closed && !cancelled && System.currentTimeMillis()<deadline) {
                    candidate=session.find(Sha1Hash(hash))
                    if(candidate!=null && candidate.isValid) {
                        candidate.unsetFlags(TorrentFlags.AUTO_MANAGED);candidate.resume()
                        if(candidate.status().hasMetadata()) {
                            val borrowed=candidate.torrentFile()
                            if(borrowed!=null && borrowed.isValid && borrowed.numFiles()>0) {
                                // torrentFile() is borrowed from the running handle. Own a decoded
                                // snapshot before removing that metadata-only handle.
                                info=TorrentInfo(borrowed.bencode())
                                if(info.isValid && info.numFiles()>0)break
                            }
                        }
                    }
                    Thread.sleep(80)
                }
                check(!closed && !cancelled) { "Torrent playback was stopped" }
                check(info!=null && info.isValid && info.infoHashV1().toHex().equals(hash,true)) { "No torrent metadata arrived. This source may have no reachable seeders. Try another source." }
            } finally { candidate?.let { if(it.isValid)session.remove(it) } }
            val query=android.net.Uri.parse("http://localhost/?"+uri.substringAfter('?',""))
            for(tracker in query.getQueryParameters("tr").distinct().take(32)) {
                val parsed=android.net.Uri.parse(tracker)
                if(parsed.scheme in listOf("http","https","udp") && !parsed.host.isNullOrEmpty()) info!!.addTracker(tracker)
            }
            metadata = info!!; magnet = uri; directory = File(root,hash).apply { mkdirs() }
        }
        val info = metadata!!; val files = info.files(); val list = JSONArray()
        for (i in 0 until info.numFiles()) list.put(JSONObject().put("id",i).put("name",files.filePath(i)).put("size",files.fileSize(i)))
        return JSONObject().put("hash",hash).put("files",list)
    }

    fun startStream(hash: String, index: Int): JSONObject {
        val info = metadata ?: throw IllegalStateException("Choose this source again")
        check(!closed && info.infoHashV1().toHex().equals(hash,true)) { "Choose this source again" }
        require(index in 0 until info.numFiles()) { "Invalid video file" }
        val files = info.files(); val dir = directory!!; val size = files.fileSize(index)
        check(size > 0 && size < dir.usableSpace - 128L * 1024 * 1024) { "Not enough free storage for this video. Choose a smaller source." }
        val path = File(dir,files.filePath(index)).canonicalFile
        check(path.path.startsWith(dir.canonicalPath + File.separator)) { "Invalid video path" }
        val peers = android.net.Uri.parse("http://localhost/?"+magnet.substringAfter('?',"" )).getQueryParameters("x.pe").mapNotNull { endpoint ->
            try { val split=endpoint.lastIndexOf(':'); TcpEndpoint(endpoint.substring(0,split),endpoint.substring(split+1).toInt()) } catch (_: Exception) { null }
        }
        session.download(info,dir,null,Priority.array(Priority.IGNORE,info.numFiles()),peers,TorrentFlags.PAUSED)
        val deadline = System.currentTimeMillis()+5000
        var th = session.find(info)
        while ((th == null || !th.isValid) && System.currentTimeMillis()<deadline && !closed) { Thread.sleep(50); th=session.find(info) }
        check(th != null && th.isValid && !closed) { "Could not start this torrent" }
        handle = th
        th.unsetFlags(TorrentFlags.AUTO_MANAGED); th.unsetFlags(TorrentFlags.UPLOAD_MODE); th.unsetFlags(TorrentFlags.STOP_WHEN_READY)
        th.prioritizeFiles(Priority.array(Priority.IGNORE,info.numFiles()).also { it[index]=Priority.NORMAL })
        th.setFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD); th.resume()
        val selected = Selection(UUID.randomUUID().toString(),info,th,index,path,size,files.fileOffset(index))
        active = selected; lastUsed=System.currentTimeMillis()
        // Download a verified starting piece before launching an external player.
        waitPiece(selected,(selected.offset/info.pieceLength()).toInt(),45000)
        return JSONObject().put("url","http://127.0.0.1:${server.localPort}/stream/${selected.token}")
            .put("file",files.fileName(index)).put("size",size)
    }

    private fun waitPiece(s: Selection, piece: Int, timeout: Long = 45000) {
        s.handle.piecePriority(piece,Priority.SEVEN); s.handle.setPieceDeadline(piece,0)
        val until=System.currentTimeMillis()+timeout
        while(!closed && active === s && !s.handle.havePiece(piece) && System.currentTimeMillis()<until) {
            val error=s.handle.status().errorCode()
            check(error.value()==0) { "Torrent download failed: ${error.message()}" }
            Thread.sleep(60)
        }
        check(!closed && active === s) { "Torrent playback was stopped" }
        check(s.handle.havePiece(piece)) { "No video data arrived. Try a source with more reachable seeders." }
    }

    private fun serve(socket: Socket) {
        socket.soTimeout=10000
        val input=BufferedInputStream(socket.getInputStream())
        fun line(): String { val out=java.io.ByteArrayOutputStream();while(out.size()<8192){val c=input.read();if(c<0||c==10)break;if(c!=13)out.write(c)};return out.toString("US-ASCII") }
        val request=line().split(' ');if(request.size<2)return
        val method=request[0];val headers=HashMap<String,String>()
        for(i in 0 until 40){val l=line();if(l.isEmpty())break;val at=l.indexOf(':');if(at>0)headers[l.substring(0,at).lowercase()]=l.substring(at+1).trim()}
        val s=active
        fun fail(code:Int,text:String,extra:String=""){socket.getOutputStream().write("HTTP/1.1 $code $text\r\nConnection: close\r\nContent-Length: 0\r\n$extra\r\n".toByteArray())}
        if(s==null||request[1]!="/stream/${s.token}"){fail(404,"Not Found");return}
        if(method!="GET"&&method!="HEAD"){fail(405,"Method Not Allowed");return}
        val range=headers["range"]; var start=0L;var end=s.size-1
        if(range!=null){
            val match=Regex("bytes=(\\d*)-(\\d*)").matchEntire(range)
            if(match==null){fail(416,"Range Not Satisfiable","Content-Range: bytes */${s.size}\r\n");return}
            try {
                if(match.groupValues[1].isEmpty()){val suffix=match.groupValues[2].toLong();require(suffix>0);start=(s.size-suffix).coerceAtLeast(0)}
                else { start=match.groupValues[1].toLong();if(match.groupValues[2].isNotEmpty())end=match.groupValues[2].toLong().coerceAtMost(s.size-1) }
            }catch(_:Exception){fail(416,"Range Not Satisfiable","Content-Range: bytes */${s.size}\r\n");return}
            if(start>=s.size||start>end){fail(416,"Range Not Satisfiable","Content-Range: bytes */${s.size}\r\n");return}
        }
        connections.incrementAndGet();lastUsed=System.currentTimeMillis()
        try {
            if(method=="GET") waitPiece(s,((s.offset+start)/s.info.pieceLength()).toInt())
            val type=when(s.path.extension.lowercase()){ "mp4","m4v"->"video/mp4";"mkv"->"video/x-matroska";"ts"->"video/mp2t";"webm"->"video/webm";else->"application/octet-stream" }
            val output=socket.getOutputStream()
            val status=if(range!=null)"206 Partial Content" else "200 OK"
            val contentRange=if(range!=null)"Content-Range: bytes $start-$end/${s.size}\r\n" else ""
            output.write("HTTP/1.1 $status\r\nContent-Type: $type\r\nAccept-Ranges: bytes\r\nContent-Length: ${end-start+1}\r\n${contentRange}Connection: close\r\nCache-Control: no-store\r\n\r\n".toByteArray())
            if(method=="HEAD")return
            val until=System.currentTimeMillis()+5000
            while(!s.path.exists()&&System.currentTimeMillis()<until&&!closed)Thread.sleep(30)
            RandomAccessFile(s.path,"r").use { file ->
                var position=start;val buffer=ByteArray(64*1024);val pieceLength=s.info.pieceLength()
                while(position<=end&&!closed&&active===s){
                    val absolute=s.offset+position;val piece=(absolute/pieceLength).toInt();waitPiece(s,piece)
                    // Request the next few seconds early; memory remains bounded by libtorrent's disk queue.
                    for(next in piece+1..minOf(piece+4,s.info.numPieces()-1))s.handle.setPieceDeadline(next,(next-piece)*100)
                    val count=minOf(buffer.size.toLong(),end-position+1,pieceLength-absolute%pieceLength).toInt()
                    file.seek(position);file.readFully(buffer,0,count);output.write(buffer,0,count);bytesServed.addAndGet(count.toLong())
                    position+=count;lastUsed=System.currentTimeMillis()
                }
            }
        } finally {connections.decrementAndGet();lastUsed=System.currentTimeMillis()}
    }

    fun cancelPending() { cancelled=true;active=null;clients.forEach{try{it.close()}catch(_:Exception){}} }
    fun owns(url:String)=active?.let { url=="http://127.0.0.1:${server.localPort}/stream/${it.token}" } ?: false
    fun close() { closed=true;active=null;try{server.close()}catch(_:Exception){};clients.forEach{try{it.close()}catch(_:Exception){}};workers.shutdownNow();session.stop();root.deleteRecursively() }
}
