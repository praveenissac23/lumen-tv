package tv.lumen.app

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * A real Android text box for search and voice.
 *
 * Fire TV gives apps no speech recogniser and keeps the Alexa button for itself, but its
 * keyboard dictates into any focused native text field when the remote's microphone button
 * is held. Text boxes inside the WebView don't get the keyboard reliably, so this one is native.
 */
class TextEntry(private val act: MainActivity) {
    private var dialog: Dialog? = null

    fun show(title: String, hint: String, initial: String, onDone: (String?) -> Unit) {
        dialog?.dismiss()
        val d = Dialog(act)
        d.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val dp = act.resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        var finished = false
        fun finish(text: String?) {
            if (finished) return
            finished = true
            hideKeyboard(d)
            try { d.dismiss() } catch (e: Exception) { }
            if (dialog === d) dialog = null
            act.webView.requestFocus()
            onDone(text?.trim()?.takeIf { it.isNotEmpty() })
        }

        val box = LinearLayout(act).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(28), px(24), px(28), px(20))
            background = GradientDrawable().apply { setColor(Color.parseColor("#1B2029")); cornerRadius = px(16).toFloat() }
        }
        box.addView(TextView(act).apply {
            text = title; setTextColor(Color.parseColor("#ECE7DD")); textSize = 22f
        })
        box.addView(TextView(act).apply {
            text = hint; setTextColor(Color.parseColor("#A9A398")); textSize = 15f
            setPadding(0, px(6), 0, px(14))
        })
        val edit = EditText(act).apply {
            setText(initial); setSelection(initial.length)
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            textSize = 22f
            setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#80786E"))
            this.hint = "Channel, film, series or programme"
            setOnEditorActionListener { v, _, _ -> finish(v.text.toString()); true }
            setOnKeyListener { v, code, ev ->
                if (ev.action == KeyEvent.ACTION_UP && (code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER)) {
                    finish((v as EditText).text.toString()); true
                } else false
            }
        }
        box.addView(edit, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val row = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END; setPadding(0, px(14), 0, 0) }
        val search = Button(act).apply { text = "Search"; setOnClickListener { finish(edit.text.toString()) } }
        val type = Button(act).apply { text = "Keyboard"; setOnClickListener { edit.requestFocus(); showKeyboard(edit) } }
        val cancel = Button(act).apply { text = "Cancel"; setOnClickListener { finish(null) } }
        row.addView(cancel); row.addView(type); row.addView(search)
        box.addView(row)

        d.setContentView(box)
        d.setCanceledOnTouchOutside(false)
        d.setOnCancelListener { finish(null) }        // Back key
        d.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setLayout((act.resources.displayMetrics.widthPixels * 0.55f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
            setGravity(Gravity.CENTER_HORIZONTAL or Gravity.TOP)
            attributes = attributes.apply { y = px(60) }
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN)
        }
        d.setOnShowListener {
            edit.requestFocus()
            edit.postDelayed({ showKeyboard(edit) }, 120)
            edit.postDelayed({ showKeyboard(edit) }, 450)   // some Fire OS versions ignore the first request
        }
        dialog = d
        d.show()
    }

    fun dismiss() { dialog?.dismiss(); dialog = null }

    private fun showKeyboard(edit: EditText) {
        val imm = act.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        if (!imm.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)) {
            @Suppress("DEPRECATION")
            imm.showSoftInput(edit, InputMethodManager.SHOW_FORCED)
        }
    }

    private fun hideKeyboard(d: Dialog) {
        val v = d.currentFocus ?: return
        val imm = act.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(v.windowToken, 0)
    }
}
