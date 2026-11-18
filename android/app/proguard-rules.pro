# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# TDLib: native code calls these classes by name via JNI.
-keep class org.drinkless.tdlib.** { *; }
-keepclassmembers class org.drinkless.tdlib.** { *; }

# Capacitor plugins are looked up by annotation/reflection.
-keep class com.chakrabortycompliance.amzy.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { @com.getcapacitor.annotation.PermissionCallback <methods>; @com.getcapacitor.annotation.ActivityCallback <methods>; @com.getcapacitor.PluginMethod public <methods>; }
-keep public class * extends com.getcapacitor.Plugin
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# DefaultRenderersFactory discovers the FFmpeg audio renderer by class name.
-keep class androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer { *; }

# FFmpeg's JNI_OnLoad resolves this callback by its original method name.
-keepclassmembers class androidx.media3.decoder.ffmpeg.FfmpegAudioDecoder {
    private java.nio.ByteBuffer growOutputBuffer(androidx.media3.decoder.SimpleDecoderOutputBuffer, int);
}

# Keep stack traces readable.
-keepattributes SourceFile,LineNumberTable,*Annotation*,JavascriptInterface
