package tv.lumen.app

import android.util.JsonReader
import android.util.JsonToken
import android.util.JsonWriter
import java.io.File
import java.io.InputStreamReader

/**
 * Streams an Xtream Codes list (live streams, films or series) straight from the network
 * into a compact JSON file, keeping only the fields the interface needs.
 * A 30 MB provider response becomes a ~3 MB file and never sits in memory whole.
 */
object Catalog {

    private val LIVE = mapOf(
        "stream_id" to "id", "num" to "num", "name" to "name", "category_id" to "cat",
        "stream_icon" to "logo", "epg_channel_id" to "epg", "tv_archive" to "arch", "tv_archive_duration" to "archDays",
    )
    private val MOVIE = mapOf(
        "stream_id" to "id", "name" to "name", "category_id" to "cat", "stream_icon" to "img",
        "rating_5based" to "r5", "rating" to "r", "year" to "year", "releaseDate" to "date", "added" to "added", "container_extension" to "ext",
    )
    private val SERIES = mapOf(
        "series_id" to "id", "name" to "name", "category_id" to "cat", "cover" to "img", "rating_5based" to "r5",
        "releaseDate" to "date", "release_date" to "date", "last_modified" to "added", "plot" to "plot", "genre" to "genre",
    )

    /** Returns the number of items written. */
    fun fetch(url: String, kind: String, dest: File): Int {
        val fields = when (kind) { "live" -> LIVE; "movie" -> MOVIE; else -> SERIES }
        val (conn, stream) = Net.open(url, 120000)
        val tmp = File(dest.path + ".tmp")
        var count = 0
        try {
            val reader = JsonReader(InputStreamReader(stream, Charsets.UTF_8))
            reader.isLenient = true
            JsonWriter(tmp.bufferedWriter(Charsets.UTF_8)).use { w ->
                w.beginArray()
                if (reader.peek() == JsonToken.BEGIN_ARRAY) {
                    reader.beginArray()
                    while (reader.hasNext()) {
                        if (reader.peek() != JsonToken.BEGIN_OBJECT) { reader.skipValue(); continue }
                        reader.beginObject()
                        w.beginObject()
                        while (reader.hasNext()) {
                            val name = reader.nextName()
                            val out = fields[name]
                            if (out == null) { reader.skipValue(); continue }
                            when (reader.peek()) {
                                JsonToken.STRING -> {
                                    var v = reader.nextString()
                                    if (out == "plot" && v.length > 300) v = v.substring(0, 300)
                                    w.name(out).value(v)
                                }
                                JsonToken.NUMBER -> {
                                    val v = reader.nextString()
                                    val l = v.toLongOrNull()
                                    if (l != null) w.name(out).value(l) else w.name(out).value(v.toDoubleOrNull() ?: 0.0)
                                }
                                JsonToken.BOOLEAN -> w.name(out).value(reader.nextBoolean())
                                else -> reader.skipValue()
                            }
                        }
                        reader.endObject()
                        w.endObject()
                        count++
                    }
                    reader.endArray()
                } else {
                    // Some servers answer with an object (error or empty list)
                    reader.skipValue()
                }
                w.endArray()
            }
            if (!tmp.renameTo(dest)) { dest.delete(); tmp.renameTo(dest) }
        } finally {
            try { stream.close() } catch (e: Exception) { }
            conn.disconnect()
            tmp.delete()
        }
        return count
    }
}
