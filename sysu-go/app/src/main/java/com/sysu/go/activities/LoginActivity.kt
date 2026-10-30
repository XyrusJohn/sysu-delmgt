package com.sysu.go.activities

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.text.Spannable
import android.text.SpannableString
import android.text.TextPaint
import android.text.SpannableStringBuilder
import android.text.style.ForegroundColorSpan
import android.text.style.MetricAffectingSpan
import android.widget.*
import android.view.LayoutInflater
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import com.google.android.material.button.MaterialButton
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.sysu.go.R
import com.sysu.go.network.MysqlAuthClient
import com.sysu.go.network.MysqlAuthException
import com.sysu.go.utils.SessionManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LoginActivity : AppCompatActivity() {

    private lateinit var etUsername: EditText
    private lateinit var etPassword: EditText
    private lateinit var btnLogin: Button
    private lateinit var tvRegister: TextView
    private lateinit var cbShowPassword: CheckBox
    private lateinit var progressBar: ProgressBar


    @SuppressLint("MissingInflatedId")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        
        //  Fix for Notch/Status Bar white gap
        window.setFlags(
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        )

        setContentView(R.layout.activity_login)

        val mainLayout = findViewById<android.view.View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(mainLayout) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, maxOf(systemBars.bottom, imeBottom))
            insets
        }

        etUsername = findViewById(R.id.etUsername)
        etPassword = findViewById(R.id.etPassword)
        btnLogin = findViewById(R.id.btnLogin)
        tvRegister = findViewById(R.id.btnRegister)
        cbShowPassword = findViewById(R.id.cbShowPassword)
        progressBar = findViewById(R.id.progressBar)

        startTypewriterAnimation()

        findViewById<TextView>(R.id.tvUsernameLabel).text = getString(R.string.login_username_label)
        etUsername.hint = "your.username"
        etUsername.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            etUsername.setAutofillHints("username")
        }
        etUsername.setText(SessionManager(this).getUsername().orEmpty())

        cbShowPassword.setOnCheckedChangeListener { _, isChecked ->
            val cursorPos = etPassword.selectionStart
            if (isChecked) {
                etPassword.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            } else {
                etPassword.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }
            etPassword.setSelection(cursorPos)
        }

        btnLogin.setOnClickListener { loginWithUsername() }
        tvRegister.setOnClickListener {
            startActivity(Intent(this, RegistrationActivity::class.java))
        }

        //  Check if redirected because account was deleted
        val deletedMsg = intent.getStringExtra("EXTRA_ACCOUNT_DELETED_MSG")
        if (!deletedMsg.isNullOrBlank()) {
            AlertDialog.Builder(this)
                .setTitle("Account Deleted")
                .setMessage(deletedMsg)
                .setPositiveButton("OK", null)
                .setCancelable(false)
                .show()
        }

    }

    private fun startTypewriterAnimation() {
        val tvMainTitle = findViewById<TextView>(R.id.tvMainTitle)
        val fullText = getString(R.string.login_main_title) // "Sign Into Your\nFleet"
        
        val redColor = Color.parseColor("#c8102e")
        val typeface = ResourcesCompat.getFont(this, R.font.bacasime_antique)

        lifecycleScope.launch {
            while (true) {
                //  Type forward
                for (i in 0..fullText.length) {
                    val currentText = fullText.substring(0, i)
                    val ssb = SpannableStringBuilder(currentText).append("|")
                    
                    applyTitleStyles(ssb, fullText, i, redColor, typeface)
                    
                    tvMainTitle.text = ssb
                    delay(100)
                }
                
                //  Blink cursor at the end
                repeat(3) {
                    val ssbNoCursor = SpannableStringBuilder(fullText)
                    applyTitleStyles(ssbNoCursor, fullText, fullText.length, redColor, typeface)
                    tvMainTitle.text = ssbNoCursor
                    delay(500)
                    
                    val ssbWithCursor = SpannableStringBuilder(fullText).append("|")
                    applyTitleStyles(ssbWithCursor, fullText, fullText.length, redColor, typeface)
                    tvMainTitle.text = ssbWithCursor
                    delay(500)
                }

                //  Backspace effect
                for (i in fullText.length downTo 0) {
                    val currentText = fullText.substring(0, i)
                    val ssb = SpannableStringBuilder(currentText).append("|")
                    
                    applyTitleStyles(ssb, fullText, i, redColor, typeface)
                    
                    tvMainTitle.text = ssb
                    delay(50)
                }
                delay(500)
            }
        }
    }

    private fun applyTitleStyles(ssb: SpannableStringBuilder, fullText: String, currentIndex: Int, color: Int, tf: Typeface?) {
        //  Apply font to the entire length (including cursor) to prevent size jumping
        if (tf != null) {
            ssb.setSpan(CustomTypefaceSpan(tf), 0, ssb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        }

        val targetWords = listOf("Your", "Fleet")
        
        for (word in targetWords) {
            val start = fullText.indexOf(word)
            if (start != -1 && currentIndex > start) {
                //  Color even partial words as they are being typed
                val end = currentIndex.coerceAtMost(start + word.length)
                ssb.setSpan(ForegroundColorSpan(color), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
        }
    }

    class CustomTypefaceSpan(private val typeface: Typeface) : MetricAffectingSpan() {
        override fun updateDrawState(ds: TextPaint) {
            applyCustomTypeFace(ds, typeface)
        }

        override fun updateMeasureState(paint: TextPaint) {
            applyCustomTypeFace(paint, typeface)
        }

        private fun applyCustomTypeFace(paint: Paint, tf: Typeface) {
            paint.typeface = tf
        }
    }

    private fun loginWithUsername() {
        val username = etUsername.text.toString().trim()
        val password = etPassword.text.toString()
        if (!username.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{2,31}"))) {
            etUsername.error = "Enter a valid username"
            etUsername.requestFocus()
            return
        }
        if (password.isEmpty()) {
            etPassword.error = "Password is required"
            etPassword.requestFocus()
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) { MysqlAuthClient().login(username, password) }
                if (result.user.role != "driver" || result.user.status != "active") {
                    withContext(Dispatchers.IO) { MysqlAuthClient().logout(result.token) }
                    setLoading(false)
                    showError("An active, administrator-approved driver account is required.")
                    return@launch
                }
                val profile = result.user.profile
                val firstName = profile["fn"].orEmpty()
                val middleInitial = profile["mi"].orEmpty()
                val lastName = profile["ln"].orEmpty()
                val displayName = profile["name"]?.takeIf { it.isNotBlank() }
                    ?: result.user.displayName?.takeIf { it.isNotBlank() }
                    ?: listOf(firstName, middleInitial.takeIf { it.isNotBlank() }?.plus("."), lastName).filterNotNull().joinToString(" ")
                if (firstName.isBlank() || lastName.isBlank() || profile["phone"].isNullOrBlank()) {
                    withContext(Dispatchers.IO) { MysqlAuthClient().logout(result.token) }
                    setLoading(false)
                    showError("Your driver profile is incomplete. Contact an administrator to update it.")
                    return@launch
                }
                val session = SessionManager(this@LoginActivity)
                if (!session.saveAuthToken(result.token)) {
                    withContext(Dispatchers.IO) { MysqlAuthClient().logout(result.token) }
                    setLoading(false)
                    showError("Secure session storage is unavailable on this device.")
                    return@launch
                }
                session.saveUsername(result.user.username ?: username)
                session.saveDriverSessionWithSplit(result.user.id, firstName, middleInitial, lastName, displayName,
                    profile["phone"].orEmpty(), profile["truckingCompany"].orEmpty())
                setLoading(false)
                navigateToMain()
            } catch (error: Exception) {
                setLoading(false)
                showError((error as? MysqlAuthException)?.message
                    ?: "Account service is unavailable. Check your local backend and try again.")
            }
        }
    }
    private fun navigateToMain() {
        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }

    private fun setLoading(loading: Boolean) {
        progressBar.visibility = if (loading) ProgressBar.VISIBLE else ProgressBar.GONE
        btnLogin.isEnabled = !loading
        etUsername.isEnabled = !loading
        etPassword.isEnabled = !loading
    }

    private fun showError(message: String) {
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_info, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_error)
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Login Error"
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = message
        val dialog = AlertDialog.Builder(this).setView(dlgView).create()
        dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener { dialog.dismiss() }
        dialog.show()
    }
}
