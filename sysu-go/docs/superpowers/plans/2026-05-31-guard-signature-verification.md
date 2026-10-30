# Guard Signature Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guard verification form below the OBD items table in Queue Details — with LN/FN/M.I. inputs, a drawing signature pad, base64 save to Firestore `sap_assignments`, and a View Verification bottom sheet. Remove the Return button.

**Architecture:** Two-state UI below OBD table: pre-verification shows a form card with name fields + VERIFY button; post-verification shows only VIEW VERIFICATION button. Signature captured via custom SignaturePadView (Canvas.drawPath) → base64 PNG → written to `sap_assignments`. View Verification shown in a BottomSheetDialogFragment.

**Tech Stack:** Android (Kotlin), Firebase Firestore, ViewBinding, Material Components, Custom Canvas View

---

## File Map

```
app/src/main/
├── java/com/sysu/go/
│   ├── activities/QueueDetailsActivity.kt          # Modify: wire verification state + Firestore write
│   └── view/SignaturePadView.kt                    # Create: custom signature drawing view
└── res/
    ├── layout/
    │   ├── activity_queue_details.xml               # Modify: add verification section, remove btnReturn
    │   ├── dialog_guard_verification.xml            # Create: BottomSheet with signature preview
    │   └── item_guard_name_input.xml                # Create: single name input row (LN / FN / MI)
    └── drawable/
        └── bg_signature_pad.xml                     # Create: signature canvas background
```

---

## Task 1: Add verification section to `activity_queue_details.xml`

**Files:**
- Modify: `app/src/main/res/layout/activity_queue_details.xml`

Locate where the OBD section ends. In ConstraintLayout, the existing scrollable content area ends with the OBD items (`llObdItemsContainer`) and empty state (`tvObdEmpty`). Add the verification section as the last child of the scroll content, wrapped in its own CardView — below the OBD table.

Pre-verification card (shown when `guardVerified != true`):
```xml
<LinearLayout
    android:id="@+id/guardVerificationSection"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="16dp"
    android:background="@drawable/bg_verification_card"
    app:layout_constraintTop_toBottomOf="@id/obdTableHeader"
    app:layout_constraintStart_toStartOf="parent"
    app:layout_constraintEnd_toEndOf="parent"
    android:layout_marginTop="12dp">

    <!-- Name input row -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:weightSum="3">

        <com.google.android.material.textfield.TextInputLayout
            android:id="@+id/tilLastName"
            style="@style/Widget.MaterialComponents.TextInputLayout.OutlinedBox.Dense"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginEnd="8dp"
            android:hint="Last Name">

            <com.google.android.material.textfield.TextInputEditText
                android:id="@+id/etLastName"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:inputType="textPersonName|textCapWords" />
        </com.google.android.material.textfield.TextInputLayout>

        <com.google.android.material.textfield.TextInputLayout
            android:id="@+id/tilFirstName"
            style="@style/Widget.MaterialComponents.TextInputLayout.OutlinedBox.Dense"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginEnd="8dp"
            android:hint="First Name">

            <com.google.android.material.textfield.TextInputEditText
                android:id="@+id/etFirstName"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:inputType="textPersonName|textCapWords" />
        </com.google.android.material.textfield.TextInputLayout>

        <com.google.android.material.textfield.TextInputLayout
            android:id="@+id/tilMI"
            style="@style/Widget.MaterialComponents.TextInputLayout.OutlinedBox.Dense"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:hint="M.I.">

            <com.google.android.material.textfield.TextInputEditText
                android:id="@+id/etMI"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:inputType="textPersonName|textCapCharacters"
                android:maxLength="2" />
        </com.google.android.material.textfield.TextInputLayout>
    </LinearLayout>

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnVerify"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="16dp"
        android:text="VERIFY"
        android:textAllCaps="true"
        app:backgroundTint="@color/sysu_red" />
</LinearLayout>
```

Post-verification button (shown when `guardVerified == true`, replaces the above):
```xml
<com.google.android.material.button.MaterialButton
    android:id="@+id/btnViewVerification"
    style="@style/Widget.MaterialComponents.Button.OutlinedButton"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginTop="12dp"
    android:text="VIEW VERIFICATION"
    android:textAllCaps="true"
    android:visibility="gone"
    app:strokeColor="@color/sysu_red"
    app:layout_constraintTop_toBottomOf="@id/obdTableHeader"
    app:layout_constraintStart_toStartOf="parent"
    app:layout_constraintEnd_toEndOf="parent" />
```

Also:
- Remove `btnReturn` button and its `android:layout_constraintBottom_toBottomOf` reference from `activity_queue_details.xml`

Background drawable for the card:
```xml
<!-- res/drawable/bg_verification_card.xml -->
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#FFFFFFFF" />
    <corners android:radius="12dp" />
    <stroke android:width="1dp" android:color="#E0E0E0" />
</shape>
```

- [ ] **Step 1: Add `bg_verification_card.xml` drawable**

Create `app/src/main/res/drawable/bg_verification_card.xml` with the shape above.

- [ ] **Step 2: Modify `activity_queue_details.xml`**
- Add verification section CardView (pre-verification) below the OBD section as the last child in the scroll content
- Add `btnViewVerification` MaterialButton (post-verification, visibility gone initially)
- Remove the `btnReturn` button element and any reference to it
- Keep the `btnBack` chevron — that stays (it is the back navigation)

---

## Task 2: Create `SignaturePadView.kt`

**Files:**
- Create: `app/src/main/java/com/sysu/go/view/SignaturePadView.kt`

A custom View that captures touch drawing and exports a Bitmap as base64 PNG.

```kotlin
package com.sysu.go.view

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import java.io.ByteArrayOutputStream
import android.util.Base64

class SignaturePadView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val path = Path()
    private val paint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 6f
        color = Color.BLACK
    }

    private var lastX = 0f
    private var lastY = 0f

    private var isEmpty = true

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawPath(path, paint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x
        val y = event.y

        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                path.moveTo(x, y)
                lastX = x
                lastY = y
                isEmpty = false
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                path.quadTo(lastX, lastY, (x + lastX) / 2, (y + lastY) / 2)
                lastX = x
                lastY = y
            }
            MotionEvent.ACTION_UP -> {
                path.lineTo(lastX, lastY)
            }
        }

        invalidate()
        return true
    }

    fun clear() {
        path.reset()
        isEmpty = true
        invalidate()
    }

    fun isEmpty(): Boolean = isEmpty

    fun getSignatureBase64(): String? {
        if (isEmpty) return null

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE) // white background
        draw(canvas)

        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        val byteArray = stream.toByteArray()
        return Base64.encodeToString(byteArray, Base64.NO_WRAP)
    }
}
```

- [ ] **Step 1: Create `app/src/main/java/com/sysu/go/view/SignaturePadView.kt`** with the code above

- [ ] **Step 2: Register the view package in `AndroidManifest.xml`** (if not already auto-included)
No manifest change needed — custom views in the app's package are auto-discovered via ViewBinding.

---

## Task 3: Create `dialog_guard_verification.xml` — Bottom Sheet layout

**Files:**
- Create: `app/src/main/res/layout/dialog_guard_verification.xml`

This is shown when tapping VIEW VERIFICATION — it displays the guard's name, signature image, and timestamp.

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="24dp"
    android:background="@drawable/bg_bottom_sheet">

    <!-- Title -->
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="VERIFIED BY"
        android:textSize="12sp"
        android:textAllCaps="true"
        android:textColor="@color/text_muted"
        android:fontFamily="@font/atkinson_hyperlegible_regular"
        android:letterSpacing="0.1" />

    <View
        android:layout_width="match_parent"
        android:layout_height="1dp"
        android:layout_marginTop="4dp"
        android:layout_marginBottom="16dp"
        android:background="#E0E0E0" />

    <!-- Guard full name -->
    <TextView
        android:id="@+id/tvGuardFullName"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Juan P. Dela Cruz"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="@color/text_primary"
        android:fontFamily="@font/atkinson_hyperlegible_regular" />

    <!-- Signature image -->
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="16dp"
        android:text="Signature"
        android:textSize="12sp"
        android:textColor="@color/text_muted"
        android:layout_marginBottom="8dp" />

    <androidx.cardview.widget.CardView
        android:layout_width="match_parent"
        android:layout_height="160dp"
        app:cardCornerRadius="8dp"
        app:cardElevation="0dp"
        app:cardBackgroundColor="#FAFAFA"
        app:cardUseCompatPadding="true">

        <ImageView
            android:id="@+id/ivSignature"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:scaleType="fitCenter"
            android:adjustViewBounds="true" />
    </androidx.cardview.widget.CardView>

    <!-- Timestamp -->
    <TextView
        android:id="@+id/tvVerifiedAt"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="16dp"
        android:text="May 31, 2026  2:45 PM"
        android:textSize="14sp"
        android:textColor="@color/text_muted"
        android:fontFamily="@font/atkinson_hyperlegible_regular" />

</LinearLayout>
```

Background drawable for bottom sheet:
```xml
<!-- res/drawable/bg_bottom_sheet.xml -->
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#FFFFFFFF" />
    <corners
        android:topLeftRadius="20dp"
        android:topRightRadius="20dp" />
</shape>
```

- [ ] **Step 1: Create `app/src/main/res/drawable/bg_bottom_sheet.xml`**

- [ ] **Step 2: Create `app/src/main/res/layout/dialog_guard_verification.xml`** with the layout above

---

## Task 4: Create `GuardVerificationBottomSheet.kt`

**Files:**
- Create: `app/src/main/java/com/sysu/go/activities/GuardVerificationBottomSheet.kt`

A BottomSheetDialogFragment that receives guard name + signature base64 + timestamp and displays them.

```kotlin
package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.util.Base64
import android.graphics.BitmapFactory
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.databinding.DialogGuardVerificationBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class GuardVerificationBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogGuardVerificationBinding? = null
    private val binding get() = _binding!!

    private var guardFirstName: String = ""
    private var guardLastName: String = ""
    private var guardMI: String = ""
    private var signatureBase64: String = ""
    private var verifiedAtMillis: Long = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        arguments?.let {
            guardFirstName = it.getString(ARG_FIRST_NAME, "")
            guardLastName = it.getString(ARG_LAST_NAME, "")
            guardMI = it.getString(ARG_MI, "")
            signatureBase64 = it.getString(ARG_SIGNATURE, "")
            verifiedAtMillis = it.getLong(ARG_VERIFIED_AT, 0L)
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogGuardVerificationBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val fullName = listOfNotNull(guardFirstName, guardMI.takeIf { it.isNotBlank() }?.let { "$it." }, guardLastName)
            .joinToString(" ")
        binding.tvGuardFullName.text = fullName.ifBlank { "—" }

        if (signatureBase64.isNotBlank()) {
            try {
                val bytes = Base64.decode(signatureBase64, Base64.NO_WRAP)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                binding.ivSignature.setImageBitmap(bitmap)
            } catch (e: Exception) {
                binding.ivSignature.setImageDrawable(null)
            }
        }

        if (verifiedAtMillis > 0) {
            val sdf = SimpleDateFormat("MMMM d, yyyy  h:mm a", Locale.getDefault())
            binding.tvVerifiedAt.text = sdf.format(Date(verifiedAtMillis))
        } else {
            binding.tvVerifiedAt.text = "—"
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "GuardVerificationBottomSheet"
        private const val ARG_FIRST_NAME = "first_name"
        private const val ARG_LAST_NAME = "last_name"
        private const val ARG_MI = "mi"
        private const val ARG_SIGNATURE = "signature"
        private const val ARG_VERIFIED_AT = "verified_at"

        fun newInstance(
            firstName: String,
            lastName: String,
            mi: String,
            signature: String,
            verifiedAt: Long
        ): GuardVerificationBottomSheet {
            return GuardVerificationBottomSheet().apply {
                arguments = Bundle().apply {
                    putString(ARG_FIRST_NAME, firstName)
                    putString(ARG_LAST_NAME, lastName)
                    putString(ARG_MI, mi)
                    putString(ARG_SIGNATURE, signature)
                    putLong(ARG_VERIFIED_AT, verifiedAt)
                }
            }
        }
    }
}
```

- [ ] **Step 1: Create `app/src/main/java/com/sysu/go/activities/GuardVerificationBottomSheet.kt`**

---

## Task 5: Create `SignaturePadBottomSheet.kt`

**Files:**
- Create: `app/src/main/java/com/sysu/go/activities/SignaturePadBottomSheet.kt`

A BottomSheetDialogFragment that hosts the SignaturePadView, with Clear and Confirm buttons.

```kotlin
package com.sysu.go.activities

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.activityViewModels
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.sysu.go.databinding.DialogSignaturePadBinding
import com.sysu.go.view.SignaturePadView

class SignaturePadBottomSheet : BottomSheetDialogFragment() {

    private var _binding: DialogSignaturePadBinding? = null
    private val binding get() = _binding!!

    var onSignatureConfirmed: ((base64: String) -> Unit)? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = DialogSignaturePadBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.btnClear.setOnClickListener {
            binding.signaturePad.clear()
        }

        binding.btnConfirm.setOnClickListener {
            if (binding.signaturePad.isEmpty()) {
                Toast.makeText(requireContext(), "Please draw your signature", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val base64 = binding.signaturePad.getSignatureBase64()
            if (base64 != null) {
                onSignatureConfirmed?.invoke(base64)
                dismiss()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "SignaturePadBottomSheet"
    }
}
```

- [ ] **Step 1: Create `app/src/main/java/com/sysu/go/activities/SignaturePadBottomSheet.kt`**

---

## Task 6: Create `dialog_signature_pad.xml`

**Files:**
- Create: `app/src/main/res/layout/dialog_signature_pad.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="24dp"
    android:background="@drawable/bg_bottom_sheet">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Sign Below"
        android:textSize="16sp"
        android:textStyle="bold"
        android:textColor="@color/text_primary"
        android:layout_marginBottom="16dp" />

    <!-- Canvas card -->
    <androidx.cardview.widget.CardView
        android:layout_width="match_parent"
        android:layout_height="200dp"
        app:cardCornerRadius="8dp"
        app:cardElevation="2dp"
        app:cardBackgroundColor="#FFFFFFFF"
        app:cardUseCompatPadding="false">

        <com.sysu.go.view.SignaturePadView
            android:id="@+id/signaturePad"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:background="@drawable/bg_signature_pad" />
    </androidx.cardview.widget.CardView>

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:text="Draw your signature with your finger"
        android:textSize="12sp"
        android:textColor="@color/text_muted" />

    <!-- Buttons -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:layout_marginTop="16dp">

        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnClear"
            style="@style/Widget.MaterialComponents.Button.OutlinedButton"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginEnd="8dp"
            android:text="Clear" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnConfirm"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="2"
            android:text="Confirm"
            app:backgroundTint="@color/sysu_red" />
    </LinearLayout>

</LinearLayout>
```

Signature pad background drawable:
```xml
<!-- res/drawable/bg_signature_pad.xml -->
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#FFFFFFFF" />
    <stroke android:width="1dp" android:color="#E0E0E0" />
</shape>
```

- [ ] **Step 1: Create `app/src/main/res/drawable/bg_signature_pad.xml`**

- [ ] **Step 2: Create `app/src/main/res/layout/dialog_signature_pad.xml`**

---

## Task 7: Wire `QueueDetailsActivity.kt` — verification state, Firestore write, bottom sheets

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/QueueDetailsActivity.kt`

Changes:
1. Add binding references for `etLastName`, `etFirstName`, `etMI`, `btnVerify`, `guardVerificationSection`, `btnViewVerification`
2. Remove `binding.btnReturn.setOnClickListener` from `setupUI()`
3. After loading `sap_assignments` data, check `guardVerified` field and switch UI state accordingly
4. Wire `btnVerify` → validate fields → open `SignaturePadBottomSheet`
5. On signature confirmed → write to Firestore (`sap_assignments` doc update) → switch to post-verification state
6. Wire `btnViewVerification` → open `GuardVerificationBottomSheet` with stored data

```kotlin
// Add to imports
import com.sysu.go.activities.GuardVerificationBottomSheet
import com.sysu.go.activities.SignaturePadBottomSheet
import com.google.firebase.firestore.FieldValue
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import android.util.Base64
import android.graphics.BitmapFactory
import android.view.View

// In setupUI(), remove:
// binding.btnReturn.setOnClickListener { finish() }
// Keep: binding.btnBack.setOnClickListener { finish() }

// Add to class property
private var currentSapDocId: String = ""

// In loadQueueDetails(), after populateObdItems(), add verification state:
// Check guardVerified after loading sap_assignments data

// In loadQueueDetails(), inside the sap_assignments success callback,
// after the DEBUG block, add:
val guardVerified = assignSnaps.documents[0].getBoolean("guardVerified") ?: false
android.util.Log.d("OBD", ">>> guardVerified: $guardVerified")

if (guardVerified) {
    // Post-verification state
    binding.guardVerificationSection.visibility = View.GONE
    binding.btnViewVerification.visibility = View.VISIBLE

    // Store for later use when opening bottom sheet
    currentGuardFirstName = assignSnaps.documents[0].getString("guardFirstName") ?: ""
    currentGuardLastName = assignSnaps.documents[0].getString("guardLastName") ?: ""
    currentGuardMI = assignSnaps.documents[0].getString("guardMI") ?: ""
    currentGuardSignature = assignSnaps.documents[0].getString("guardSignature") ?: ""
    val ts = assignSnaps.documents[0].getTimestamp("verifiedAt")
    currentVerifiedAtMillis = ts?.toDate()?.time ?: 0L
} else {
    // Pre-verification state
    binding.guardVerificationSection.visibility = View.VISIBLE
    binding.btnViewVerification.visibility = View.GONE
}

// Add class-level variables:
private var currentGuardFirstName: String = ""
private var currentGuardLastName: String = ""
private var currentGuardMI: String = ""
private var currentGuardSignature: String = ""
private var currentVerifiedAtMillis: Long = 0L

// In setupUI(), add btnVerify and btnViewVerification wiring:
binding.btnVerify.setOnClickListener {
    val lastName = binding.etLastName.text?.toString()?.trim() ?: ""
    val firstName = binding.etFirstName.text?.toString()?.trim() ?: ""
    val mi = binding.etMI.text?.toString()?.trim() ?: ""

    if (lastName.isBlank() || firstName.isBlank()) {
        binding.tilLastName.error = if (lastName.isBlank()) "Required" else null
        binding.tilFirstName.error = if (firstName.isBlank()) "Required" else null
        return@setOnClickListener
    }
    binding.tilLastName.error = null
    binding.tilFirstName.error = null

    // Open signature pad
    val sigSheet = SignaturePadBottomSheet()
    sigSheet.onSignatureConfirmed = { base64 ->
        saveVerificationToFirestore(base64, lastName, firstName, mi)
    }
    sigSheet.show(supportFragmentManager, SignaturePadBottomSheet.TAG)
}

binding.btnViewVerification.setOnClickListener {
    val sheet = GuardVerificationBottomSheet.newInstance(
        firstName = currentGuardFirstName,
        lastName = currentGuardLastName,
        mi = currentGuardMI,
        signature = currentGuardSignature,
        verifiedAt = currentVerifiedAtMillis
    )
    sheet.show(supportFragmentManager, GuardVerificationBottomSheet.TAG)
}

// Add new method:
private fun saveVerificationToFirestore(signatureBase64: String, lastName: String, firstName: String, mi: String) {
    if (currentSapDocId.isBlank()) {
        android.util.Log.e("OBD", ">>> currentSapDocId is blank, cannot save verification")
        return
    }

    val updates = mapOf(
        "guardVerified" to true,
        "guardFirstName" to firstName,
        "guardLastName" to lastName,
        "guardMI" to mi,
        "guardSignature" to signatureBase64,
        "verifiedAt" to com.google.firebase.Timestamp.now()
    )

    db.collection("sap_assignments").document(currentSapDocId)
        .update(updates)
        .addOnSuccessListener {
            android.util.Log.d("OBD", ">>> verification saved successfully")

            // Update UI to post-verification state
            binding.guardVerificationSection.visibility = View.GONE
            binding.btnViewVerification.visibility = View.VISIBLE

            currentGuardFirstName = firstName
            currentGuardLastName = lastName
            currentGuardMI = mi
            currentGuardSignature = signatureBase64
            currentVerifiedAtMillis = System.currentTimeMillis()

            android.widget.Toast.makeText(this, "Verification saved", android.widget.Toast.LENGTH_SHORT).show()
        }
        .addOnFailureListener { e ->
            android.util.Log.e("OBD", ">>> verification save FAILED: ${e.message}")
            android.widget.Toast.makeText(this, "Failed to save verification. Try again.", android.widget.Toast.LENGTH_SHORT).show()
        }
}
```

- [ ] **Step 1: Add imports for new classes and Firebase FieldValue**

- [ ] **Step 2: Remove `binding.btnReturn.setOnClickListener { finish() }` from `setupUI()`**

- [ ] **Step 3: Add class-level variables for guard data and `currentSapDocId`**

- [ ] **Step 4: In `loadQueueDetails()` sap_assignments callback, after `assignSnaps.documents[0].id` assignment — store `currentSapDocId`. Add guardVerified state check and UI state swap after the OBD items population.**

- [ ] **Step 5: In `setupUI()`, add `btnVerify.setOnClickListener` with field validation + signature pad open**

- [ ] **Step 6: In `setupUI()`, add `btnViewVerification.setOnClickListener` with bottom sheet open**

- [ ] **Step 7: Add `saveVerificationToFirestore()` method and wire it to the signature pad callback**

- [ ] **Step 8: Verify `currentSapDocId` is set in the sap_assignments callback — it needs to be captured before calling `saveVerificationToFirestore()`**

---

## Self-Review Checklist

1. **Spec coverage:** All spec requirements mapped
   - ✅ Form (LN, FN, M.I.) — Task 1
   - ✅ VERIFY button → opens signature pad — Task 5, 7
   - ✅ SignaturePadView → base64 — Task 2
   - ✅ Firestore write to `sap_assignments` — Task 7
   - ✅ Timestamp captured — Task 7
   - ✅ Post-verification state (VIEW VERIFICATION button) — Task 1
   - ✅ VIEW VERIFICATION bottom sheet — Task 3, 4
   - ✅ Remove Return button — Task 1
2. **Placeholder scan:** No "TBD", "TODO", or vague steps — all code shown inline
3. **Type consistency:** `guardFirstName`/`guardLastName`/`guardMI`/`guardSignature`/`verifiedAt` used consistently across all tasks
4. **`currentSapDocId`:** Set in the sap_assignments callback before `populateObdItems()`, used in `saveVerificationToFirestore()` — referenced in Task 7 Step 4 and Step 8

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-guard-signature-verification.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**