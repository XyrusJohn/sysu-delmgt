package com.sysu.go.activities

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.widget.Toast
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.inputmethod.InputMethodManager
import android.graphics.Rect
import android.view.MotionEvent
import android.text.InputType
import android.text.InputFilter
import android.text.Spanned
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.sysu.go.R
import com.sysu.go.databinding.ActivityRegistrationBinding
import com.sysu.go.network.MysqlAuthClient
import com.sysu.go.network.MysqlAuthException
import com.sysu.go.utils.Sanitizer
import com.sysu.go.utils.SessionManager
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class RegistrationActivity : AppCompatActivity() {

    private lateinit var binding: ActivityRegistrationBinding
    private var isConfirmStep: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        //  Fix for Notch/Status Bar white gap: Make status bar transparent and icons white
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        androidx.core.view.WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false // White icons for red background
        }

        binding = ActivityRegistrationBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            //  Top padding is 0 to allow red header to bleed into status bar/notch area
            v.setPadding(systemBars.left, 0, systemBars.right, systemBars.bottom)
            insets
        }

        setupTruckCompanyDropdown()
        startCircleAnimation()
        setupInputFilters()

        binding.btnBack.setOnClickListener {
            if (isConfirmStep) {
                setConfirmStep(false)
            } else {
                finish()
            }
        }

        binding.btnContinue.setOnClickListener {
            if (isConfirmStep) {
                registerDriver()
            } else {
                if (validateStep1()) {
                    setConfirmStep(true)
                }
            }
        }
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_DOWN) {
            val v = currentFocus
            if (v is android.widget.EditText) {
                val outRect = Rect()
                v.getGlobalVisibleRect(outRect)
                if (!outRect.contains(event.rawX.toInt(), event.rawY.toInt())) {
                    v.clearFocus()
                    val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
                    imm.hideSoftInputFromWindow(v.windowToken, 0)
                }
            }
        }
        return super.dispatchTouchEvent(event)
    }

    private fun setupInputFilters() {
        //  Mobile Number: Only 11 digits
        binding.etPhone.filters = arrayOf(InputFilter.LengthFilter(11), object : InputFilter {
            override fun filter(source: CharSequence?, start: Int, end: Int, dest: Spanned?, dstart: Int, dend: Int): CharSequence? {
                if (source != null && !source.toString().matches(Regex("[0-9]*"))) {
                    return ""
                }
                return null
            }
        })

        //  Middle Initial: Max 1 char, auto uppercase
        binding.etMiddleInitial.filters = arrayOf(InputFilter.LengthFilter(1), InputFilter.AllCaps())

        //  Names: Allow letters and spaces only
        val nameFilter = object : InputFilter {
            override fun filter(source: CharSequence?, start: Int, end: Int, dest: Spanned?, dstart: Int, dend: Int): CharSequence? {
                if (source != null && !source.toString().matches(Regex("[a-zA-Z\\s]*"))) {
                    return ""
                }
                return null
            }
        }
        binding.etFirstName.filters = arrayOf(nameFilter)
        binding.etLastName.filters = arrayOf(nameFilter)

        //  Real-time keyboard assistance for Sentence Case
        binding.etFirstName.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        binding.etLastName.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
    }

    private fun startCircleAnimation() {
        binding.circleContainer.post {
            val containerW = binding.circleContainer.width
            val containerH = binding.circleContainer.height
            val random = java.util.Random()

            //  Generate 3 to 5 circles dynamically for a more subtle look
            val count = random.nextInt(3) + 3 // 3, 4, or 5
            for (i in 0 until count) {
                //  Random size between 40dp–140dp
                val sizeDp = 40 + random.nextInt(101)
                val sizePx = (sizeDp * resources.displayMetrics.density).toInt()

                //  Random starting position
                val startX = random.nextInt(containerW).toFloat()
                val startY = random.nextInt(containerH).toFloat()

                //  Random speed per circle — slower drift for less annoyance
                val minSpeed = 0.2f + random.nextFloat() * 0.2f
                val maxSpeed = minSpeed + 0.2f + random.nextFloat() * 0.3f

                //  Lower opacity range to be more subtle
                val alpha = 0.25f + random.nextFloat() * 0.4f

                val circle = createBounceCircle(sizePx, alpha)

                binding.circleContainer.addView(circle)

                startBounceAnimation(
                    view = circle,
                    viewSize = sizePx,
                    containerWidth = containerW,
                    containerHeight = containerH,
                    minSpeed = minSpeed,
                    maxSpeed = maxSpeed,
                    initialX = startX,
                    initialY = startY,
                    startDelayMs = (i * 150L) + random.nextInt(500)
                )
            }
        }
    }

    private fun createBounceCircle(sizePx: Int, alpha: Float): View {
        return View(this).apply {
            layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
            background = ContextCompat.getDrawable(this@RegistrationActivity, R.drawable.bg_circle_light_red)
            this.alpha = alpha
        }
    }

    private fun startBounceAnimation(
        view: View,
        viewSize: Int,
        containerWidth: Int,
        containerHeight: Int,
        minSpeed: Float,
        maxSpeed: Float,
        initialX: Float,
        initialY: Float,
        startDelayMs: Long
    ) {
        val random = java.util.Random()

        val maxX = (containerWidth - viewSize).toFloat().coerceAtLeast(0f)
        val maxY = (containerHeight - viewSize).toFloat().coerceAtLeast(0f)

        view.translationX = initialX
        view.translationY = initialY

        var velX = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) * if (random.nextBoolean()) 1f else -1f
        var velY = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) * if (random.nextBoolean()) 1f else -1f

        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 16L
            repeatCount = ValueAnimator.INFINITE
            startDelay = startDelayMs
            addUpdateListener { _ ->
                if (random.nextFloat() < 0.02f) {
                    velX += (random.nextFloat() - 0.5f) * 0.4f
                    velX = velX.coerceIn(-maxSpeed, maxSpeed)
                }
                if (random.nextFloat() < 0.02f) {
                    velY += (random.nextFloat() - 0.5f) * 0.4f
                    velY = velY.coerceIn(-maxSpeed, maxSpeed)
                }

                var newX = view.translationX + velX
                var newY = view.translationY + velY

                if (newX <= 0) {
                    newX = 0f
                    velX = kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed)
                    velX *= (0.8f + random.nextFloat() * 0.4f)
                } else if (newX >= maxX) {
                    newX = maxX
                    velX = -kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed)
                    velX *= (0.8f + random.nextFloat() * 0.4f)
                }

                if (newY <= 0) {
                    newY = 0f
                    velY = kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed)
                    velY *= (0.8f + random.nextFloat() * 0.4f)
                } else if (newY >= maxY) {
                    newY = maxY
                    velY = -kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed)
                    velY *= (0.8f + random.nextFloat() * 0.4f)
                }

                view.translationX = newX
                view.translationY = newY
            }
            start()
        }

        ObjectAnimator.ofFloat(view, "scaleX", 1f, 1.08f).apply {
            duration = 4000L + random.nextInt(1500)
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = startDelayMs
            start()
        }

        ObjectAnimator.ofFloat(view, "scaleY", 1f, 1.06f).apply {
            duration = 4500L + random.nextInt(1500)
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = startDelayMs + 600L
            start()
        }
    }

    private fun setupTruckCompanyDropdown() {
        val companies = resources.getStringArray(R.array.truck_companies)
        val adapter = ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, companies)
        binding.actvTruckCompany.setAdapter(adapter)

        binding.actvTruckCompany.setOnClickListener {
            binding.actvTruckCompany.showDropDown()
        }

        binding.actvTruckCompany.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) {
                binding.actvTruckCompany.showDropDown()
            }
        }
    }

    private fun setConfirmStep(confirm: Boolean) {
        isConfirmStep = confirm

        if (confirm) {
            binding.btnContinue.text = getString(R.string.register_confirm)
            binding.indicatorDetails.setBackgroundColor(ContextCompat.getColor(this, R.color.white))
            binding.indicatorConfirm.setBackgroundColor(ContextCompat.getColor(this, R.color.white))
            binding.indicatorDetails.alpha = 0.5f
            binding.indicatorConfirm.alpha = 1.0f

            //  Show summary notice
            binding.phoneVerifySection.visibility = View.VISIBLE
            binding.ivPhoneVerified.visibility = View.GONE
            binding.btnSendOtp.visibility = View.GONE
            binding.tvPhoneVerified.text = "Please review your details before confirming."
            binding.tvPhoneVerified.setTextColor(ContextCompat.getColor(this, R.color.sysu_gold))

            //  Disable inputs
            val confirmBg = ContextCompat.getDrawable(this, R.drawable.bg_input_field_confirm)
            binding.etFirstName.background = confirmBg
            binding.etLastName.background = confirmBg
            binding.etMiddleInitial.background = confirmBg
            binding.etPhone.background = confirmBg
            binding.actvTruckCompany.background = confirmBg
            binding.etUsername.background = confirmBg
            binding.etAccountPassword.background = confirmBg

            binding.etFirstName.isEnabled = false
            binding.etLastName.isEnabled = false
            binding.etMiddleInitial.isEnabled = false
            binding.etPhone.isEnabled = false
            binding.actvTruckCompany.isEnabled = false
            binding.etUsername.isEnabled = false
            binding.etAccountPassword.isEnabled = false

            binding.btnContinue.isEnabled = true
        } else {
            //  Going back to Step 1
            binding.phoneVerifySection.visibility = View.GONE
            binding.btnContinue.text = getString(R.string.register_continue)
            binding.indicatorDetails.setBackgroundColor(ContextCompat.getColor(this, R.color.white))
            binding.indicatorConfirm.setBackgroundColor(ContextCompat.getColor(this, R.color.white))
            binding.indicatorDetails.alpha = 1.0f
            binding.indicatorConfirm.alpha = 0.5f

            //  Restore backgrounds
            val defaultBg = ContextCompat.getDrawable(this, R.drawable.bg_input_field)
            binding.etFirstName.background = defaultBg
            binding.etLastName.background = defaultBg
            binding.etMiddleInitial.background = defaultBg
            binding.etPhone.background = defaultBg
            binding.actvTruckCompany.background = defaultBg
            binding.etUsername.background = defaultBg
            binding.etAccountPassword.background = defaultBg

            binding.etFirstName.isEnabled = true
            binding.etLastName.isEnabled = true
            binding.etMiddleInitial.isEnabled = true
            binding.etPhone.isEnabled = true
            binding.actvTruckCompany.isEnabled = true
            binding.etUsername.isEnabled = true
            binding.etAccountPassword.isEnabled = true
        }
    }

    private fun validateStep1(): Boolean {
        val firstName = binding.etFirstName.text.toString().trim()
        val lastName = binding.etLastName.text.toString().trim()
        val phone = binding.etPhone.text.toString().trim()
        val truckCompany = binding.actvTruckCompany.text.toString().trim()
        val username = binding.etUsername.text.toString().trim()
        val password = binding.etAccountPassword.text.toString()

        if (lastName.isEmpty()) {
            binding.etLastName.error = "Required"
            return false
        }
        if (firstName.isEmpty()) {
            binding.etFirstName.error = "Required"
            return false
        }
        if (phone.isEmpty() || phone.length < 10) {
            binding.etPhone.error = "Valid phone number required"
            return false
        }
        if (truckCompany.isEmpty()) {
            binding.actvTruckCompany.error = "Required"
            return false
        }
        if (!username.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{2,31}"))) {
            binding.etUsername.error = "Use 3–32 letters, numbers, dots, underscores, or hyphens"
            return false
        }
        if (password.length !in 8..128) {
            binding.etAccountPassword.error = "Password must contain 8–128 characters"
            return false
        }
        return true
    }

    private fun registerDriver() {
        val firstName = Sanitizer.sanitize(binding.etFirstName.text.toString().trim(), 50)
        val middleInitial = Sanitizer.sanitizeMI(binding.etMiddleInitial.text.toString().trim())
        val lastName = Sanitizer.sanitize(binding.etLastName.text.toString().trim(), 50)
        val phone = Sanitizer.sanitizePhone(binding.etPhone.text.toString().trim())
        val truckCompany = Sanitizer.sanitize(binding.actvTruckCompany.text.toString().trim(), 100)
        val username = binding.etUsername.text.toString().trim()
        val password = binding.etAccountPassword.text.toString()
        val displayName = buildString {
            append(firstName)
            if (middleInitial.isNotEmpty()) append(" ${middleInitial.replace(".", "") }.")
            append(" $lastName")
        }.trim()
        val profile = mapOf(
            "fn" to firstName,
            "mi" to middleInitial,
            "ln" to lastName,
            "name" to displayName,
            "phone" to phone,
            "truckingCompany" to truckCompany,
        )

        setLoading(true)
        lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    MysqlAuthClient().register(username, password, profile)
                }
                withContext(Dispatchers.IO) { runCatching { MysqlAuthClient().logout(result.token) } }
                SessionManager(this@RegistrationActivity).apply {
                    saveUsername(result.user.username ?: username)
                    clearSession()
                }
                setLoading(false)
                Toast.makeText(
                    this@RegistrationActivity,
                    "Registration submitted. An administrator must approve your driver account before sign-in.",
                    Toast.LENGTH_LONG,
                ).show()
                val login = Intent(this@RegistrationActivity, LoginActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                }
                startActivity(login)
                finish()
            } catch (error: Exception) {
                setLoading(false)
                showError((error as? MysqlAuthException)?.message
                    ?: "Account service is unavailable. Check your local backend and try again.")
            }
        }
    }
    private fun setLoading(loading: Boolean) {
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        binding.btnContinue.isEnabled = !loading
        binding.btnBack.isEnabled = !loading
        binding.etUsername.isEnabled = !loading && !isConfirmStep
        binding.etAccountPassword.isEnabled = !loading && !isConfirmStep
    }

    private fun showError(message: String) {
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_info, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_error)
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Error"
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = message
        val dialog = AlertDialog.Builder(this).setView(dlgView).create()
        dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener { dialog.dismiss() }
        dialog.show()
    }
}
