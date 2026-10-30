plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "tv.lumen.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "tv.lumen.app"
        minSdk = 22          // Fire OS 5 / Android 5.1 and newer
        targetSdk = 34
        // GitHub sets BUILD_NUMBER to the build count, so every build is a newer version.
        val build = (System.getenv("BUILD_NUMBER") ?: "1").toInt()
        versionCode = build
        versionName = "1.$build"
    }

    // A fixed signing key lets each new build install over the previous one.
    // It comes from the repository's private secrets; without them the build falls back to a temporary key.
    val ksFile = file("lumen.jks")
    val ksPass = System.getenv("KEYSTORE_PASSWORD")
    signingConfigs {
        if (ksFile.exists() && !ksPass.isNullOrEmpty()) {
            create("lumen") {
                storeFile = ksFile
                storePassword = ksPass
                keyAlias = "lumen"
                keyPassword = ksPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("lumen") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    androidResources { noCompress += listOf("mp4") }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    val media3 = "1.4.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.annotation:annotation-experimental:1.4.1")
    implementation("androidx.core:core:1.13.1")
}
