package tv.lumen.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Full-screen search with a real Android text field.
 *
 * On Fire TV the remote's mic button goes to Alexa, except while Amazon's keyboard is open
 * for a text field: then holding it dictates into the field. Dialogs and WebView inputs don't
 * reliably bring that keyboard up; a focused field in its own activity does, as in other apps.
 *
 * Returns the text in EXTRA_TEXT (RESULT_OK) or RESULT_CANCELED.
 */
class SearchActivity : Activity() {
    private lateinit var edit: EditText
    private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN)
        fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#12161B"))
            setPadding(dp(72), dp(48), dp(72), dp(24))
        }
        root.addView(TextView(this).apply {
            text = intent.getStringExtra(EXTRA_TITLE) ?: "Search"
            setTextColor(Color.parseColor("#ECE7DD")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
        })
        root.addView(TextView(this).apply {
            text = intent.getStringExtra(EXTRA_HINT) ?: ""
            setTextColor(Color.parseColor("#A9A398")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setPadding(0, dp(8), 0, dp(20))
        })
        edit = EditText(this).apply {
            val initial = intent.getStringExtra(EXTRA_INITIAL) ?: ""
            setText(initial); setSelection(initial.length)
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            hint = "Channel, film, series or programme"
            setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#80786E"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            setPadding(dp(20), dp(14), dp(20), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1F2530")); cornerRadius = dp(12).toFloat()
                setStroke(dp(2), Color.parseColor("#CFA968"))
            }
            setOnEditorActionListener { v, _, _ -> finishWith(v.text.toString()); true }
        }
        root.addView(edit, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(TextView(this).apply {
            text = "Hold the mic button and speak. Back searches; Back on an empty box cancels."
            setTextColor(Color.parseColor("#80786E")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(16), 0, 0); gravity = Gravity.START
        })
        setContentView(root)
        edit.requestFocus()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !done && !opened) {
            opened = true
            // Bring up the Amazon keyboard: ask nicely, then insist, then "press OK" on the field
            // the way the remote would (Fire OS versions differ in which of these they honour).
            showKeyboard()
            for (ms in longArrayOf(150, 400, 800)) edit.postDelayed({ if (!done && !keyboardUp()) showKeyboard() }, ms)
            edit.postDelayed({ if (!done) pressOk() }, 700)   // harmless if the keyboard is already up
        }
    }

    private var opened = false

    private fun keyboardUp(): Boolean {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        return imm.isActive(edit) && imm.isAcceptingText && isImeShowing
    }
    private var isImeShowing = false

    private fun pressOk() {
        edit.requestFocus()
        edit.onKeyDown(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER))
        edit.onKeyUp(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER))
        edit.performClick()
    }

    private fun showKeyboard() {
        edit.requestFocus()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        @Suppress("DEPRECATION")
        val ok = imm.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT) || imm.showSoftInput(edit, InputMethodManager.SHOW_FORCED)
        if (ok) isImeShowing = true
    }

    // Back (keyboard already closed): search what's in the box, or cancel if it's empty.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if ((event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_ESCAPE)) {
            if (event.action == KeyEvent.ACTION_UP) finishWith(edit.text.toString())
            return true
        }
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
            if (event.action == KeyEvent.ACTION_UP) { showKeyboard(); pressOk() }
            return true
        }
        if (event.keyCode == KeyEvent.KEYCODE_ENTER || event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            if (event.action == KeyEvent.ACTION_UP) finishWith(edit.text.toString())
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun finishWith(text: String) {
        if (done) return
        done = true
        val t = text.trim()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(edit.windowToken, 0)
        if (t.isEmpty()) setResult(RESULT_CANCELED) else setResult(RESULT_OK, Intent().putExtra(EXTRA_TEXT, t))
        finish()
    }

    companion object {
        const val EXTRA_TITLE = "title"
        const val EXTRA_HINT = "hint"
        const val EXTRA_INITIAL = "initial"
        const val EXTRA_TEXT = "text"
    }
}
