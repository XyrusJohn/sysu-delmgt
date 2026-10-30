import org.gradle.testing.jacoco.tasks.JacocoReport
import java.util.Properties

plugins {
    id("jacoco")
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

fun isPrivateNetworkHost(value: String): Boolean {
    if (value == "localhost") return true
    if (value.endsWith(".mshome.net") && value.length > ".mshome.net".length) return true
    val octets = value.split('.').map { it.toIntOrNull() ?: return false }
    if (octets.size != 4 || octets.any { it !in 0..255 }) return false
    return octets[0] == 10
        || (octets[0] == 172 && octets[1] in 16..31)
        || (octets[0] == 192 && octets[1] == 168)
}

val phoneLocalHost = providers.gradleProperty("sysuPhoneLocalHost").orNull
phoneLocalHost?.let { host -> require(isPrivateNetworkHost(host)) { "sysuPhoneLocalHost must be a private network host; received '$host'" } }
val appEnv = Properties().apply {
    file(".env").takeIf { it.isFile }?.inputStream()?.use(::load)
}
val debugLocalHost = providers.gradleProperty("sysuDebugHost")
    .orElse(providers.environmentVariable("SYSU_GO_DEBUG_HOST"))
    .orElse(appEnv.getProperty("SYSU_GO_DEBUG_HOST", ""))
    .get()
require(isPrivateNetworkHost(debugLocalHost)) { "sysuDebugHost must be a private network host; received '$debugLocalHost'" }

android {
    namespace = "com.sysu.go"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sysu.go"
        buildConfigField("boolean", "USE_LOCAL_SERVICES", "false")
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Local emulator builds connect through the emulator bridge to localhost services.
    testBuildType = providers.gradleProperty("sysuTestBuildType").orElse("debug").get()

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
            buildConfigField("boolean", "USE_LOCAL_SERVICES", "true")
            buildConfigField("String", "API_BASE_URL", "\"http://$debugLocalHost:3001\"")
            buildConfigField("String", "SOCKET_URL", "\"http://$debugLocalHost:3001\"")
        }
        create("emulator") {
            initWith(getByName("debug"))
            matchingFallbacks += listOf("debug")
            buildConfigField("boolean", "USE_LOCAL_SERVICES", "true")
            applicationIdSuffix = ".debug"
            signingConfig = signingConfigs.getByName("debug")
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3001\"")
            buildConfigField("String", "SOCKET_URL", "\"http://10.0.2.2:3001\"")
        }
        if (phoneLocalHost != null) {
            create("phoneLocal") {
                initWith(getByName("debug"))
                matchingFallbacks += listOf("debug")
                buildConfigField("boolean", "USE_LOCAL_SERVICES", "true")
                applicationIdSuffix = ".phoneLocal"
                signingConfig = signingConfigs.getByName("debug")
                buildConfigField("String", "API_BASE_URL", "\"http://$phoneLocalHost:3001\"")
                buildConfigField("String", "SOCKET_URL", "\"http://$phoneLocalHost:3001\"")
            }
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("String", "API_BASE_URL", "\"https://sysu-go.onrender.com\"")
            buildConfigField("String", "SOCKET_URL", "\"https://sysu-go.onrender.com\"")
        }
        create("liveTest") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
    }

    sourceSets.getByName("liveTest").res.srcDir("src/release/res")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = "11"
    }

    buildFeatures {
        viewBinding = true
        dataBinding = true
        buildConfig = true
    }

}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)

    // Location
    implementation(libs.play.services.location)

    // CameraX for QR scanning
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    // Decode CameraX frames locally without a hosted scanner service.
    implementation(libs.zxing.core)

    // Lifecycle
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")

    // Socket.IO (for live location tracking)
    implementation("io.socket:socket.io-client:2.1.0") {
        exclude(group = "org.json", module = "json")
    }

    // Security (for encrypted SharedPreferences)
    implementation("androidx.security:security-crypto:1.1.0")

    // JSON
    implementation("com.google.code.gson:gson:2.10.1")
}

// Scoped evidence for the shipped QR transport; this is not whole-app coverage.
jacoco { toolVersion = "0.8.15" }
tasks.register<JacocoReport>("qrTransportCoverage") {
    dependsOn("testDebugUnitTest")
    executionData(layout.buildDirectory.file("outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec"))
    classDirectories.setFrom(fileTree(layout.buildDirectory.dir("tmp/kotlin-classes/debug")) {
        include("com/sysu/go/network/QrHttpClient*.class")
    })
    sourceDirectories.setFrom(files("src/main/java"))
    reports { xml.required.set(true); html.required.set(true) }
}

tasks.register<JacocoReport>("environmentPolicyCoverage") {
    dependsOn("testDebugUnitTest")
    executionData(layout.buildDirectory.file("outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec"))
    classDirectories.setFrom(fileTree(layout.buildDirectory.dir("tmp/kotlin-classes/debug")) { include("com/sysu/go/config/EnvironmentPolicy*.class") })
    sourceDirectories.setFrom(files("src/main/java"))
    reports { xml.required.set(true); html.required.set(true) }
}
