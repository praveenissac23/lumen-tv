package tv.lumen.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Xml
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.InputStream

/**
 * Programme guide in SQLite. A 20,000-channel guide has over a million programmes,
 * far too many for the interface to hold; it asks for the handful it is showing.
 */
class EpgStore(ctx: Context) : SQLiteOpenHelper(ctx, "epg.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE prog (ch TEXT NOT NULL, s INTEGER NOT NULL, e INTEGER NOT NULL, t TEXT NOT NULL, d TEXT NOT NULL DEFAULT '')")
        db.execSQL("CREATE INDEX prog_ch_s ON prog(ch, s)")
        db.execSQL("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        db.execSQL("DROP TABLE IF EXISTS prog"); db.execSQL("DROP TABLE IF EXISTS meta"); onCreate(db)
    }

    @Volatile var importing = false
        private set

    /**
     * Streams an XMLTV file into the table, keeping programmes for `wanted` channels inside [from, to].
     * Existing rows are replaced at the end so the guide stays usable while importing. Returns rows kept.
     */
    fun import(input: InputStream, from: Long, to: Long, wanted: Set<String>?, onProgress: (Int) -> Unit): Int {
        importing = true
        val db = writableDatabase
        db.execSQL("DROP TABLE IF EXISTS prog_new")
        db.execSQL("CREATE TABLE prog_new (ch TEXT NOT NULL, s INTEGER NOT NULL, e INTEGER NOT NULL, t TEXT NOT NULL, d TEXT NOT NULL DEFAULT '')")
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(input, null)
        val stmt = db.compileStatement("INSERT INTO prog_new(ch, s, e, t, d) VALUES (?, ?, ?, ?, ?)")
        var ch: String? = null
        var s = 0L; var e = 0L
        var title: String? = null; var desc: String? = null
        var keep = false
        var total = 0
        var inTx = false
        try {
            db.beginTransaction(); inTx = true
            var event = parser.eventType
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) {
                    when (parser.name) {
                        "programme" -> {
                            ch = parser.getAttributeValue(null, "channel")
                            keep = ch != null && (wanted == null || wanted.contains(ch))
                            if (keep) {
                                s = Xmltv.time(parser.getAttributeValue(null, "start"))
                                e = Xmltv.time(parser.getAttributeValue(null, "stop"))
                                if (e == 0L) e = s + 1800
                                keep = s > 0 && e >= from && s <= to
                            }
                            title = null; desc = null
                        }
                        "title" -> if (keep && title == null) title = parser.nextText()
                        "desc" -> if (keep && desc == null) desc = parser.nextText()
                    }
                } else if (event == XmlPullParser.END_TAG && parser.name == "programme") {
                    if (keep && ch != null) {
                        var d = desc ?: ""
                        if (d.length > 160) d = d.substring(0, 160)
                        stmt.bindString(1, ch); stmt.bindLong(2, s); stmt.bindLong(3, e)
                        stmt.bindString(4, title ?: ""); stmt.bindString(5, d)
                        stmt.executeInsert()
                        total++
                        if (total % 5000 == 0) {
                            db.setTransactionSuccessful(); db.endTransaction(); db.beginTransaction()
                            onProgress(total)
                        }
                        if (total > 2_000_000) break
                    }
                    keep = false
                }
                event = parser.next()
            }
            db.setTransactionSuccessful()
        } catch (t: Throwable) {
            importing = false
            throw t
        } finally {
            if (inTx) db.endTransaction()
            stmt.close()
        }
        db.beginTransaction()
        try {
            // The previous import's table kept this index name when it was renamed to prog;
            // drop it first, otherwise IF NOT EXISTS would skip creating the index on prog_new.
            db.execSQL("DROP INDEX IF EXISTS prog_new_ch_s")
            db.execSQL("CREATE INDEX prog_new_ch_s ON prog_new(ch, s)")
            db.execSQL("DROP TABLE IF EXISTS prog")
            db.execSQL("ALTER TABLE prog_new RENAME TO prog")
            val cv = ContentValues().apply { put("k", "importedAt"); put("v", System.currentTimeMillis().toString()) }
            db.insertWithOnConflict("meta", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
            importing = false
        }
        return total
    }

    fun importedAt(): Long = try {
        readableDatabase.rawQuery("SELECT v FROM meta WHERE k='importedAt'", null).use { c -> if (c.moveToFirst()) c.getString(0).toLong() else 0L }
    } catch (e: Exception) { 0L }

    fun count(): Long = try {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM prog", null).use { c -> if (c.moveToFirst()) c.getLong(0) else 0L }
    } catch (e: Exception) { 0L }

    private fun row(c: android.database.Cursor): JSONArray =
        JSONArray().put(c.getLong(0)).put(c.getLong(1)).put(c.getString(2)).put(c.getString(3))

    /** Current and next programme for each channel id: {"id": [[s,e,t,d], [s,e,t,d] | null]}. */
    fun nowNext(ids: List<String>, at: Long): JSONObject {
        val out = JSONObject()
        val db = readableDatabase
        for (id in ids) {
            val arr = JSONArray()
            db.rawQuery("SELECT s, e, t, d FROM prog WHERE ch = ? AND s <= ? AND e > ? ORDER BY s DESC LIMIT 1", arrayOf(id, at.toString(), at.toString())).use { c ->
                if (c.moveToFirst()) arr.put(row(c)) else arr.put(JSONObject.NULL)
            }
            db.rawQuery("SELECT s, e, t, d FROM prog WHERE ch = ? AND s > ? ORDER BY s LIMIT 1", arrayOf(id, at.toString())).use { c ->
                if (c.moveToFirst()) arr.put(row(c)) else arr.put(JSONObject.NULL)
            }
            out.put(id, arr)
        }
        return out
    }

    /** Programmes overlapping [from, to] for each channel id: {"id": [[s,e,t,d], ...]}. */
    fun range(ids: List<String>, from: Long, to: Long): JSONObject {
        val out = JSONObject()
        val db = readableDatabase
        for (id in ids) {
            val arr = JSONArray()
            db.rawQuery("SELECT s, e, t, d FROM prog WHERE ch = ? AND e > ? AND s < ? ORDER BY s LIMIT 400", arrayOf(id, from.toString(), to.toString())).use { c ->
                while (c.moveToNext()) arr.put(row(c))
            }
            out.put(id, arr)
        }
        return out
    }

    /** Title search inside [from, to]: [[ch, s, e, t, d], ...]. */
    fun search(q: String, from: Long, to: Long, limit: Int): JSONArray {
        val out = JSONArray()
        val words = q.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(4)
        if (words.isEmpty()) return out
        val where = StringBuilder("e > ? AND s < ?")
        val args = ArrayList<String>().apply { add(from.toString()); add(to.toString()) }
        for (w in words) { where.append(" AND t LIKE ? ESCAPE '\\'"); args.add("%" + w.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%") }
        readableDatabase.rawQuery("SELECT ch, s, e, t, d FROM prog WHERE $where ORDER BY s LIMIT $limit", args.toTypedArray()).use { c ->
            while (c.moveToNext()) out.put(JSONArray().put(c.getString(0)).put(c.getLong(1)).put(c.getLong(2)).put(c.getString(3)).put(c.getString(4)))
        }
        return out
    }
}
