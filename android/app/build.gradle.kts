plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val torrentAbi = providers.gradleProperty("torrentAbi").orElse("armeabi-v7a").get()
require(torrentAbi in listOf("armeabi-v7a","arm64-v8a","x86_64"))

android {
    namespace = "tv.lumen.app"
    testBuildType = providers.gradleProperty("testVariant").orElse("debug").get()
    compileSdk = 34

    defaultConfig {
        applicationId = "tv.lumen.app"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
    packaging { jniLibs.useLegacyPackaging = true }
    androidResources { noCompress += listOf("mp4") }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("com.google.errorprone:error_prone_annotations:2.28.0")
    val torrentVersion = "2.0.15.3"
    implementation("com.frostwire:jlibtorrent:$torrentVersion")
    val nativeArtifact=mapOf("armeabi-v7a" to "arm","arm64-v8a" to "arm64","x86_64" to "x86_64").getValue(torrentAbi)
    releaseImplementation("com.frostwire:jlibtorrent-android-$nativeArtifact:$torrentVersion")
    debugImplementation("com.frostwire:jlibtorrent-android-x86_64:$torrentVersion")
    val media3 = "1.4.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.annotation:annotation-experimental:1.4.1")
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.webkit:webkit:1.8.0")
}
