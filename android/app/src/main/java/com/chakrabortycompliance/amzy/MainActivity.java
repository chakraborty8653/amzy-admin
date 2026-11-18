package com.chakrabortycompliance.amzy;

import android.os.Bundle;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.util.Rational;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import com.chakrabortycompliance.amzy.telegram.TelegramAuthPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    private boolean pictureInPicturePlaybackActive;
    private String pictureInPictureTitle = "AMZY";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TelegramAuthPlugin.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && !isInPictureInPictureMode()) hideSystemBars();
    }

    public boolean setPictureInPicturePlaybackActive(boolean active, String title) {
        pictureInPicturePlaybackActive = active;
        if (title != null && !title.trim().isEmpty()) pictureInPictureTitle = title.trim();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        setPictureInPictureParams(createPictureInPictureParams());
        return true;
    }

    public void setVideoPlaybackActive(boolean active) {
        if (active) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    public boolean enterPictureInPicturePlayback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !pictureInPicturePlaybackActive) return false;
        enterPictureInPictureMode(createPictureInPictureParams());
        return true;
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (pictureInPicturePlaybackActive
            && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !isInPictureInPictureMode()) {
            enterPictureInPicturePlayback();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        PluginHandle pluginHandle = getBridge() == null ? null : getBridge().getPlugin("TelegramAuth");
        Plugin plugin = pluginHandle == null ? null : pluginHandle.getInstance();
        if (plugin instanceof TelegramAuthPlugin) {
            ((TelegramAuthPlugin) plugin).onPictureInPictureModeChanged(isInPictureInPictureMode);
        }
        if (!isInPictureInPictureMode && getWindow() != null) hideSystemBars();
    }

    private PictureInPictureParams createPictureInPictureParams() {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational(16, 9))
            .setTitle(pictureInPictureTitle);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(pictureInPicturePlaybackActive);
        }
        return builder.build();
    }

    private void hideSystemBars() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) return;
            controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            controller.setSystemBarsBehavior(
                WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }
}
