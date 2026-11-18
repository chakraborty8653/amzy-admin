package com.chakrabortycompliance.amzy.telegram;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Canvas;
import android.graphics.Bitmap;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.media.MediaMetadataRetriever;
import android.content.res.ColorStateList;
import android.content.ContentValues;
import android.content.ContentResolver;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.graphics.drawable.Drawable;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.PopupMenu;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.activity.result.ActivityResult;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.chakrabortycompliance.amzy.BuildConfig;
import com.chakrabortycompliance.amzy.MainActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.drinkless.tdlib.Client;
import org.drinkless.tdlib.TdApi;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.TimeZone;

@CapacitorPlugin(name = "TelegramAuth")
public class TelegramAuthPlugin extends Plugin {
    private static final String DEVICE_KEY_ALIAS = "amzy_cloud_device_key";
    private static final String CLOUD_SESSION_PREFS = "amzy_cloud_session";
    private static final String CLOUD_SESSION_TOKEN = "telegram_token";
        private static final String CLOUD_SYNC_DISABLED = "sync_disabled";
    private static final String STEP_INITIALIZING = "initializing";
    private static final String STEP_PHONE = "phone";
    private static final String STEP_CODE = "code";
    private static final String STEP_PASSWORD = "password";
    private static final String STEP_READY = "ready";
    private static final String STEP_LOGGED_OUT = "loggedOut";

    private static volatile TelegramAuthPlugin activePlugin;
    private static volatile Client client;
    private static volatile String authStep = STEP_INITIALIZING;
    private static volatile TdApi.User currentUser;
    private static volatile String lastError;
    private static volatile boolean clientClosed;
    private static final AtomicBoolean tdlibParametersSubmitted = new AtomicBoolean();

    private final Map<String, PrivateVideoStream> privateVideoStreams = new ConcurrentHashMap<>();
    private final Map<Integer, VideoDownloadTask> videoDownloadTasks = new ConcurrentHashMap<>();
    private final Set<Integer> playableVideoFileIds = ConcurrentHashMap.newKeySet();
    private final Handler playerHandler = new Handler(Looper.getMainLooper());
    private ExoPlayer exoPlayer;
    private FrameLayout nativePlaybackLayer;
    private PlayerView nativePlayerView;
    private WebView nativePlayerWebView;
    private LinearLayout nativePlaybackControls;
    private LinearLayout nativePlaybackBottomBar;
    private LinearLayout nativePlaybackOverlay;
    private ImageView nativePlaybackLoadingLogo;
    private TextView nativePlaybackTitle;
    private TextView nativePlaybackSubtitle;
    private TextView nativePlaybackStatus;
    private Button nativePlaybackDownloadFallbackButton;
    private TextView nativePlaybackTime;
    private ProgressBar nativePlaybackSpinner;
    private SeekBar nativePlaybackSeekBar;
    private Button nativePlaybackPlayButton;
    private Button nativePlaybackVolumeButton;
    private Button nativePlaybackSubtitleButton;
    private Button nativePlaybackAudioButton;
    private Button nativePlaybackOrientationButton;
    private Button nativePlaybackZoomButton;
    private RotationLockDrawable nativePlaybackOrientationIcon;
    private boolean playbackOrientationLocked;
    private boolean playbackZoomEnabled;
    private int previousRequestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean playbackSubtitlesEnabled;
    private TextView nativePlaybackGestureFeedback;
    private float gestureStartX;
    private float gestureStartY;
    private float gestureStartValue;
    private int gestureAdjustmentSide;
    private boolean gestureTracking;
    private boolean gestureAdjusting;
    private long lastPlaybackTapTime;
    private int lastPlaybackTapSide;
    private float previousWindowBrightness = -1f;
    private float playbackBrightness = 0.5f;
    private boolean playbackBrightnessCaptured;
    private volatile int activeVideoFileId;
    private long activeVideoFileSize;
    private String activeVideoTitle = "Telegram video";
    private volatile boolean playerIsLoading = true;
    private boolean inPictureInPictureMode;
    private volatile boolean playerEnded;
    private volatile String playerError;
    private volatile String playerStatusMessage;
    private volatile boolean fallbackDownloadActive;
    private volatile boolean streamErrorSent;
    private volatile long streamBytesSent;
    private final AtomicLong pendingStreamBytes = new AtomicLong();
    private final AtomicBoolean streamUiUpdatePending = new AtomicBoolean();

    private volatile int pendingStreamFileId;
    private boolean playbackControlsVisible = true;
    private boolean immersivePlaybackActive;
    private int previousSystemUiVisibility;
    private int previousSystemBarsBehavior;
    private boolean previousStatusBarVisible = true;
    private boolean previousNavigationBarVisible = true;
    private final Runnable playerStateUpdater = new Runnable() {
        @Override
        public void run() {
            if (exoPlayer == null || nativePlayerView == null
                || nativePlayerView.getVisibility() != View.VISIBLE) {
                return;
            }

            emitVideoPlayerState(null);
            playerHandler.postDelayed(this, 500);
        }
    };

    private static final class PrivateVideoStream {
        final int fileId;
        final long size;

        PrivateVideoStream(int fileId, long size) {
            this.fileId = fileId;
            this.size = size;
        }
    }

    private static final class VideoDownloadTask {
        final String itemId;
        final String title;
        final String mimeType;
        final PluginCall call;

        VideoDownloadTask(String itemId, String title, String mimeType, PluginCall call) {
            this.itemId = itemId;
            this.title = title;
            this.mimeType = mimeType;
            this.call = call;
        }
    }

    private interface RestrictionCheckCallback {
        void onResult(boolean restricted, String error);
    }

    @PluginMethod
    public void getCloudSessionToken(PluginCall call) {
        String token = getContext()
            .getSharedPreferences(CLOUD_SESSION_PREFS, 0)
            .getString(CLOUD_SESSION_TOKEN, "");
        JSObject result = new JSObject();
        result.put("token", token);
        call.resolve(result);
    }

    @PluginMethod
    public void setCloudSessionToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token.isEmpty()) {
            call.reject("Cloud session token is missing.");
            return;
        }
        boolean saved = getContext()
            .getSharedPreferences(CLOUD_SESSION_PREFS, 0)
            .edit()
            .putString(CLOUD_SESSION_TOKEN, token)
            .commit();
        if (!saved) {
            call.reject("Could not save the cloud session on this device.");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void clearCloudSessionToken(PluginCall call) {
        boolean cleared = getContext()
            .getSharedPreferences(CLOUD_SESSION_PREFS, 0)
            .edit()
            .remove(CLOUD_SESSION_TOKEN)
            .commit();
        if (!cleared) {
            call.reject("Could not clear the cloud session on this device.");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void getCloudSyncDisabled(PluginCall call) {
        boolean disabled = getContext()
            .getSharedPreferences(CLOUD_SESSION_PREFS, 0)
            .getBoolean(CLOUD_SYNC_DISABLED, false);
        JSObject result = new JSObject();
        result.put("disabled", disabled);
        call.resolve(result);
    }

    @PluginMethod
    public void setCloudSyncDisabled(PluginCall call) {
        boolean disabled = call.getBoolean("disabled", false);
        boolean saved = getContext()
            .getSharedPreferences(CLOUD_SESSION_PREFS, 0)
            .edit()
            .putBoolean(CLOUD_SYNC_DISABLED, disabled)
            .commit();
        if (!saved) {
            call.reject("Could not save the cloud sync preference on this device.");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void getAuthState(PluginCall call) {
        try {
            ensureClient();
            call.resolve(createAuthState());
        } catch (Exception error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod
    public void startBotVerification(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;
        String botUsername = call.getData().getString("botUsername", "").trim().replaceFirst("^@", "");
        String challenge = call.getData().getString("challenge", "").trim();
        if (!botUsername.matches("[A-Za-z0-9_]{5,}") || !challenge.matches("[A-Za-z0-9_-]{20,64}")) {
            call.reject("Telegram verification bot details are invalid.");
            return;
        }
        activeClient.send(new TdApi.SearchPublicChat(botUsername), result -> {
            if (!(result instanceof TdApi.Chat) || !(((TdApi.Chat) result).type instanceof TdApi.ChatTypePrivate)) {
                call.reject("Could not open the Telegram verification bot.");
                return;
            }
            TdApi.Chat botChat = (TdApi.Chat) result;
            long botUserId = ((TdApi.ChatTypePrivate) botChat.type).userId;
            activeClient.send(new TdApi.SendBotStartMessage(botUserId, botChat.id, challenge), sendResult -> {
                if (sendResult instanceof TdApi.Error) {
                    call.reject("Could not contact the verification bot: " + ((TdApi.Error) sendResult).message);
                    return;
                }
                call.resolve();
            });
        });
    }

    @PluginMethod
    public void signDeviceProof(PluginCall call) {
        String challenge = call.getData().getString("challenge", "");
        String uid = call.getData().getString("uid", "");
        if (challenge.isEmpty() || uid.isEmpty()) {
            call.reject("Missing Telegram login challenge.");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (!keyStore.containsAlias(DEVICE_KEY_ALIAS)) {
                KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
                generator.initialize(
                    new KeyGenParameterSpec.Builder(DEVICE_KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                        .setDigests(KeyProperties.DIGEST_SHA256)
                        .build()
                );
                generator.generateKeyPair();
            }
            KeyStore.PrivateKeyEntry entry = (KeyStore.PrivateKeyEntry) keyStore.getEntry(DEVICE_KEY_ALIAS, null);
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(entry.getPrivateKey());
            signer.update(deviceProofMessage(challenge, uid).getBytes(StandardCharsets.UTF_8));
            JSObject result = new JSObject();
            result.put("publicKey", Base64.encodeToString(entry.getCertificate().getPublicKey().getEncoded(), Base64.NO_WRAP));
            result.put("signature", Base64.encodeToString(signer.sign(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not sign the device login proof: " + error.getMessage());
        }
    }

    static String deviceProofMessage(String challenge, String uid) {
        return "amzy-native-login:" + challenge + ":" + uid;
    }

    @PluginMethod
    public void startLogin(PluginCall call) {
        try {
            ensureClient();
            call.resolve(createAuthState());
        } catch (Exception error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod
    public void setPhoneNumber(PluginCall call) {
        String phoneNumber = call.getData().getString("phoneNumber", "").trim();
        if (phoneNumber.isEmpty()) {
            call.reject("Enter your phone number with its country code.");
            return;
        }
        sendRequest(
            call,
            new TdApi.SetAuthenticationPhoneNumber(
                phoneNumber,
                new TdApi.PhoneNumberAuthenticationSettings(false, false, false, false, false, null, new String[0])
            )
        );
    }

    @PluginMethod
    public void checkCode(PluginCall call) {
        String code = call.getData().getString("code", "").trim();
        if (code.isEmpty()) {
            call.reject("Enter the login code sent by Telegram.");
            return;
        }
        sendRequest(call, new TdApi.CheckAuthenticationCode(code));
    }

    @PluginMethod
    public void checkPassword(PluginCall call) {
        String password = call.getData().getString("password", "");
        if (password.isEmpty()) {
            call.reject("Enter your Telegram two-step verification password.");
            return;
        }
        sendRequest(call, new TdApi.CheckAuthenticationPassword(password));
    }

    @PluginMethod
    public void logOut(PluginCall call) {
        playableVideoFileIds.clear();
        Client activeClient = client;
        if (activeClient == null || clientClosed) {
            privateVideoStreams.clear();
            currentUser = null;
            authStep = STEP_LOGGED_OUT;
            lastError = null;
            publishAuthState();
            call.resolve();
            return;
        }
        sendRequest(call, new TdApi.LogOut());
    }

    @PluginMethod
    public void inspectInviteLink(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;
        String inviteLink = call.getData().getString("inviteLink", "").trim();
        if (!isTelegramInviteLink(inviteLink)) {
            call.reject("Paste a Telegram private group/channel invite link such as https://t.me/+inviteCode.");
            return;
        }
        activeClient.send(new TdApi.CheckChatInviteLink(inviteLink), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("Telegram group/channel invite link could not be checked: " + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.ChatInviteLinkInfo)) {
                call.reject("Telegram returned an unexpected invite-link response.");
                return;
            }
            TdApi.ChatInviteLinkInfo invite = (TdApi.ChatInviteLinkInfo) result;
            JSObject info = new JSObject();
            info.put("joined", invite.chatId != 0);
            info.put("chatId", invite.chatId == 0 ? "" : Long.toString(invite.chatId));
            info.put("title", invite.title == null ? "Private Telegram group/channel" : invite.title);
            info.put("createsJoinRequest", invite.createsJoinRequest);
            info.put("isPublic", invite.isPublic);
            call.resolve(info);
        });
    }

    @PluginMethod
    public void joinInviteLink(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;
        String inviteLink = call.getData().getString("inviteLink", "").trim();
        if (!isTelegramInviteLink(inviteLink)) {
            call.reject("Paste a valid Telegram private group/channel invite link.");
            return;
        }
        activeClient.send(new TdApi.JoinChatByInviteLink(inviteLink), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("Could not join this Telegram group/channel: " + ((TdApi.Error) result).message);
                return;
            }
            if (result instanceof TdApi.ChatJoinResultSuccess) {
                long chatId = ((TdApi.ChatJoinResultSuccess) result).chatId;
                activeClient.send(new TdApi.GetChat(chatId), chatResult -> {
                    if (chatResult instanceof TdApi.Error) {
                        call.reject("Joined the group/channel, but could not load its details: " + ((TdApi.Error) chatResult).message);
                    } else if (chatResult instanceof TdApi.Chat) {
                        call.resolve(createChatReference((TdApi.Chat) chatResult));
                    } else {
                        call.reject("Telegram joined the group/channel but returned unexpected chat details.");
                    }
                });
                return;
            }
            if (result instanceof TdApi.ChatJoinResultRequestSent) {
                JSObject response = new JSObject();
                response.put("requestPending", true);
                call.resolve(response);
                return;
            }
            if (result instanceof TdApi.ChatJoinResultGuardBotApprovalRequired) {
                call.reject("This channel requires Telegram bot approval before joining.");
                return;
            }
            if (result instanceof TdApi.ChatJoinResultDeclined) {
                call.reject("Telegram declined the request to join this channel.");
                return;
            }
            call.reject("Telegram returned an unexpected join response.");
        });
    }

    @PluginMethod
    public void getJoinedChannelVideos(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;
        String rawChatId = call.getData().getString("chatId", "").trim();
        final long chatId;
        try {
            chatId = Long.parseLong(rawChatId);
        } catch (NumberFormatException error) {
            call.reject("The Telegram channel reference is invalid.");
            return;
        }
        activeClient.send(new TdApi.GetChat(chatId), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("This Telegram account cannot access the channel: " + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.Chat)) {
                call.reject("Telegram returned unexpected channel details.");
                return;
            }
            TdApi.Chat chat = (TdApi.Chat) result;
            if (chat.hasProtectedContent) {
                call.reject("This group/channel does not allow its videos to be saved or played in other apps.");
                return;
            }
            String rawFromMessageId = call.getData().getString("fromMessageId", "").trim();
            long fromMessageId = 0;
            if (!rawFromMessageId.isEmpty()) {
                try {
                    fromMessageId = Long.parseLong(rawFromMessageId);
                } catch (NumberFormatException error) {
                    call.reject("The Telegram history cursor is invalid.");
                    return;
                }
            }
            requestChannelHistory(call, activeClient, chat, fromMessageId, null);
        });
    }

    @PluginMethod
    public void getPublicChannelVideos(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;
        String username = call.getString("username", "").trim().replaceFirst("^@", "");
        if (!username.matches("[A-Za-z0-9_]{5,}")) {
            call.reject("Enter a valid public Telegram group/channel username or link.");
            return;
        }
        activeClient.send(new TdApi.SearchPublicChat(username), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("Could not open this public Telegram group/channel: " + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.Chat)) {
                call.reject("Telegram returned unexpected public group/channel details.");
                return;
            }
            TdApi.Chat chat = (TdApi.Chat) result;
            if (!(chat.type instanceof TdApi.ChatTypeSupergroup)
                && !(chat.type instanceof TdApi.ChatTypeBasicGroup)) {
                call.reject("This Telegram link is not a public group or channel.");
                return;
            }
            if (chat.hasProtectedContent) {
                call.reject("This group/channel does not allow its videos to be saved or played in other apps.");
                return;
            }
            String rawFromMessageId = call.getString("fromMessageId", "").trim();
            long fromMessageId = 0;
            if (!rawFromMessageId.isEmpty()) {
                try {
                    fromMessageId = Long.parseLong(rawFromMessageId);
                } catch (NumberFormatException error) {
                    call.reject("The Telegram history cursor is invalid.");
                    return;
                }
            }
            requestChannelHistory(call, activeClient, chat, fromMessageId, username);
        });
    }

    private void requestChannelHistory(
            PluginCall call,
            Client activeClient,
            TdApi.Chat chat,
            long fromMessageId,
            String username
    ) {
        checkSupergroupRestriction(activeClient, chat, (restricted, error) -> {
            if (error != null) {
                call.reject(error);
                return;
            }
            if (restricted) {
                JSObject feed = createChatReference(chat);
                feed.put("blockedBySensitiveContent", true);
                feed.put("items", new JSArray());
                if (username != null) {
                    feed.put("username", username);
                    feed.put("isPublic", true);
                }
                call.resolve(feed);
                return;
            }
            loadChannelHistory(call, activeClient, chat, fromMessageId, username);
        });
    }

    private void loadChannelHistory(
            PluginCall call,
            Client activeClient,
            TdApi.Chat chat,
            long fromMessageId,
            String username
    ) {
        activeClient.send(new TdApi.OpenChat(chat.id), openResult ->
        activeClient.send(new TdApi.GetChatHistory(chat.id, fromMessageId, 0, 100, false), historyResult -> {
            activeClient.send(new TdApi.CloseChat(chat.id), closeResult -> { });
            if (historyResult instanceof TdApi.Error) {
                call.reject("Could not load videos from this group/channel: " + ((TdApi.Error) historyResult).message);
                return;
            }
            if (!(historyResult instanceof TdApi.Messages)) {
                call.reject("Telegram returned unexpected group/channel messages.");
                return;
            }
            TdApi.Message[] messages = ((TdApi.Messages) historyResult).messages;
            JSObject feed = createVideoFeed(chat, messages);
            if (username != null) {
                feed.put("username", username);
                feed.put("isPublic", true);
            }
            addHistoryCursor(feed, messages, fromMessageId);
            call.resolve(feed);
        }));
    }

    private void checkSupergroupRestriction(
            Client activeClient,
            TdApi.Chat chat,
            RestrictionCheckCallback callback
    ) {
        if (!(chat.type instanceof TdApi.ChatTypeSupergroup)) {
            callback.onResult(false, null);
            return;
        }

        long supergroupId = ((TdApi.ChatTypeSupergroup) chat.type).supergroupId;
        activeClient.send(new TdApi.GetSupergroup(supergroupId), result -> {
            if (result instanceof TdApi.Error) {
                callback.onResult(false, "Could not verify Telegram channel restrictions: "
                    + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.Supergroup)) {
                callback.onResult(false, "Telegram returned unexpected channel restriction details.");
                return;
            }

            TdApi.Supergroup supergroup = (TdApi.Supergroup) result;
            callback.onResult(hasSensitiveContent(supergroup.restrictionInfo), null);
        });
    }

    private void checkSensitiveChatById(
            Client activeClient,
            long chatId,
            RestrictionCheckCallback callback
    ) {
        activeClient.send(new TdApi.GetChat(chatId), result -> {
            if (result instanceof TdApi.Error) {
                callback.onResult(false, "Could not verify Telegram channel restrictions: "
                    + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.Chat)) {
                callback.onResult(false, "Telegram returned unexpected channel details.");
                return;
            }

            TdApi.Chat chat = (TdApi.Chat) result;
            if (chat.hasProtectedContent) {
                callback.onResult(false, "This Telegram channel does not allow content to be played in AMZY.");
                return;
            }
            checkSupergroupRestriction(activeClient, chat, callback);
        });
    }

    private boolean hasSensitiveContent(TdApi.RestrictionInfo restrictionInfo) {
        return restrictionInfo != null && restrictionInfo.hasSensitiveContent;
    }

    private void addHistoryCursor(JSObject feed, TdApi.Message[] messages, long fromMessageId) {
        long oldestMessageId = 0;
        if (messages != null) {
            for (TdApi.Message message : messages) {
                if (message != null && (oldestMessageId == 0 || message.id < oldestMessageId)) {
                    oldestMessageId = message.id;
                }
            }
        }
        if (oldestMessageId > 0 && oldestMessageId != fromMessageId) {
            feed.put("nextFromMessageId", Long.toString(oldestMessageId));
        }
    }

    @PluginMethod
    public void downloadChannelVideo(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;
        int fileId = call.getInt("fileId", 0);
        String rawChatId = call.getString("chatId", "").trim();
        String rawMessageId = call.getString("messageId", "").trim();
        if (rawChatId.isEmpty() != rawMessageId.isEmpty()) {
            call.reject("The Telegram chat and message references must be provided together.");
            return;
        }
        if (fileId <= 0 && rawChatId.isEmpty()) {
            call.reject("The Telegram video file reference is invalid.");
            return;
        }
        if (!rawChatId.isEmpty()) {
            final long chatId;
            final long messageId;
            try {
                chatId = Long.parseLong(rawChatId);
                messageId = Long.parseLong(rawMessageId);
            } catch (NumberFormatException error) {
                call.reject("The Telegram message reference is invalid.");
                return;
            }
            if (chatId == 0 || messageId <= 0) {
                call.reject("The Telegram message reference is invalid.");
                return;
            }
            activeClient.send(new TdApi.GetMessage(chatId, messageId), result -> {
                if (result instanceof TdApi.Error) {
                    call.reject("Could not refresh Telegram thumbnail reference: "
                        + ((TdApi.Error) result).message);
                    return;
                }
                if (!(result instanceof TdApi.Message)) {
                    call.reject("Telegram returned an unexpected video message.");
                    return;
                }
                TdApi.Message message = (TdApi.Message) result;
                if (hasSensitiveContent(message.restrictionInfo)) {
                    call.reject("Telegram marks this post as sensitive. AMZY blocked it.");
                    return;
                }
                if (!(message.content instanceof TdApi.MessageVideo)) {
                    call.reject("This Telegram post no longer contains a video.");
                    return;
                }
                TdApi.Video video = ((TdApi.MessageVideo) message.content).video;
                if (video == null || video.thumbnail == null || video.thumbnail.file == null
                    || video.thumbnail.file.id <= 0) {
                    call.reject("Telegram does not provide a thumbnail for this video.");
                    return;
                }
                downloadTelegramFile(video.thumbnail.file.id, activeClient, call);
            });
            return;
        }
        downloadTelegramFile(fileId, activeClient, call);
    }

    private void downloadTelegramFile(int fileId, Client activeClient, PluginCall call) {
        activeClient.send(new TdApi.DownloadFile(fileId, 32, 0, 0, true), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("Could not download this Telegram video: " + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.File)) {
                call.reject("Telegram returned an unexpected video download response.");
                return;
            }
            pollChannelVideoDownload(fileId, activeClient, call, System.currentTimeMillis());
        });
    }

    private void pollChannelVideoDownload(int fileId, Client activeClient, PluginCall call, long startedAt) {
        activeClient.send(new TdApi.GetFile(fileId), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("Could not check Telegram video download: " + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.File)) {
                call.reject("Telegram returned an unexpected video download status.");
                return;
            }

            TdApi.File file = (TdApi.File) result;
            if (file.local != null && file.local.isDownloadingCompleted
                && file.local.path != null && !file.local.path.isEmpty()) {
                JSObject response = new JSObject();
                response.put("path", file.local.path);
                call.resolve(response);
                return;
            }
            if (System.currentTimeMillis() - startedAt >= 120_000) {
                call.reject("Telegram thumbnail download timed out.");
                return;
            }
            playerHandler.postDelayed(
                () -> pollChannelVideoDownload(fileId, activeClient, call, startedAt),
                500
            );
        });
    }

    @PluginMethod
    public void saveChannelVideo(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;
        int fileId = call.getInt("fileId", 0);
        String itemId = call.getString("itemId", "").trim();
        String rawChatId = call.getString("chatId", "").trim();
        String rawMessageId = call.getString("messageId", "").trim();
        if (fileId <= 0) {
            call.reject("The Telegram video file reference is invalid.");
            return;
        }
        if (rawChatId.isEmpty() != rawMessageId.isEmpty()) {
            call.reject("The Telegram chat and message references must be provided together.");
            return;
        }
        String title = call.getString("title", "Telegram video");
        String mimeType = call.getString("mimeType", "video/mp4");
        if (!rawChatId.isEmpty()) {
            final long chatId;
            final long messageId;
            try {
                chatId = Long.parseLong(rawChatId);
                messageId = Long.parseLong(rawMessageId);
            } catch (NumberFormatException error) {
                call.reject("The Telegram message reference is invalid.");
                return;
            }
            if (chatId == 0 || messageId <= 0) {
                call.reject("The Telegram message reference is invalid.");
                return;
            }
            emitDownloadProgress(fileId, itemId, 0, 0, "downloading", null);

                activeClient.send(new TdApi.GetChat(chatId), chatResult -> {
                    if (chatResult instanceof TdApi.Error) {
                        String message = "Could not access the Telegram channel: "
                            + ((TdApi.Error) chatResult).message;
                        emitDownloadProgress(fileId, itemId, 0, 0, "failed", message);
                        call.reject(message);
                        return;
                    }
                    if (!(chatResult instanceof TdApi.Chat)) {
                        String message = "Telegram returned unexpected channel details.";
                        emitDownloadProgress(fileId, itemId, 0, 0, "failed", message);
                        call.reject(message);
                        return;
                    }
                    TdApi.Chat chat = (TdApi.Chat) chatResult;
                    if (chat.hasProtectedContent) {
                        String error = "This Telegram channel does not allow videos to be saved.";
                        emitDownloadProgress(fileId, itemId, 0, 0, "failed", error);
                        call.reject(error);
                        return;
                    }
                    checkSupergroupRestriction(activeClient, chat, (restricted, restrictionError) -> {
                        if (restrictionError != null || restricted) {
                            String error = restrictionError != null
                                ? restrictionError
                                : "Telegram marks this channel as sensitive. AMZY blocked it.";
                            emitDownloadProgress(fileId, itemId, 0, 0, "failed", error);
                            call.reject(error);
                            return;
                        }
                        findTelegramVideoForSave(
                            chatId,
                            messageId,
                            0,
                            0,
                            fileId,
                            itemId,
                            title,
                            mimeType,
                            activeClient,
                            call
                        );
                    });
                });
                return;
            }
            startSaveChannelVideoDownload(fileId, itemId, title, mimeType, activeClient, call);
    }

    private void findTelegramVideoForSave(
            long chatId,
            long targetMessageId,
            long fromMessageId,
            int pagesLoaded,
            int fallbackFileId,
            String itemId,
            String title,
            String mimeType,
            Client activeClient,
            PluginCall call
    ) {
            if (pagesLoaded >= 1000) {
                String error = "Could not locate this video in the Telegram channel history.";
                emitDownloadProgress(fallbackFileId, itemId, 0, 0, "failed", error);
                call.reject(error);
                return;
            }

            activeClient.send(new TdApi.GetChatHistory(chatId, fromMessageId, 0, 100, false), result -> {
                if (result instanceof TdApi.Error) {
                    String error = "Could not refresh the Telegram video reference: " + ((TdApi.Error) result).message;
                    emitDownloadProgress(fallbackFileId, itemId, 0, 0, "failed", error);
                    call.reject(error);
                    return;
                }
                if (!(result instanceof TdApi.Messages)) {
                    String error = "Telegram returned unexpected channel messages.";
                    emitDownloadProgress(fallbackFileId, itemId, 0, 0, "failed", error);
                    call.reject(error);
                    return;
                }

                TdApi.Message[] messages = ((TdApi.Messages) result).messages;
                long oldestMessageId = 0;
                for (TdApi.Message message : messages) {
                    if (message == null) continue;
                    if (oldestMessageId == 0 || message.id < oldestMessageId) oldestMessageId = message.id;
                    if (message.id != targetMessageId) continue;
                    if (hasSensitiveContent(message.restrictionInfo)) {
                        String error = "Telegram marks this post as sensitive. AMZY blocked it.";
                        emitDownloadProgress(fallbackFileId, itemId, 0, 0, "failed", error);
                        call.reject(error);
                        return;
                    }
                    if (!(message.content instanceof TdApi.MessageVideo)) {
                        String error = "This Telegram post no longer contains an available video.";
                        emitDownloadProgress(fallbackFileId, itemId, 0, 0, "failed", error);
                        call.reject(error);
                        return;
                    }
                    TdApi.Video video = ((TdApi.MessageVideo) message.content).video;
                    if (!message.canBeSaved || video == null || video.video == null || video.video.id <= 0) {
                        String error = "Telegram does not allow this video to be saved.";
                        emitDownloadProgress(fallbackFileId, itemId, 0, 0, "failed", error);
                        call.reject(error);
                        return;
                    }
                    int currentFileId = video.video.id;
                    playableVideoFileIds.add(currentFileId);
                    startSaveChannelVideoDownload(currentFileId, itemId, title, mimeType, activeClient, call);
                    return;
                }

                if (messages.length == 0 || oldestMessageId == 0 || oldestMessageId <= targetMessageId
                    || oldestMessageId == fromMessageId) {
                    String error = "This Telegram post is no longer available in the channel history.";
                    emitDownloadProgress(fallbackFileId, itemId, 0, 0, "failed", error);
                    call.reject(error);
                    return;
                }
                findTelegramVideoForSave(
                    chatId,
                    targetMessageId,
                    oldestMessageId,
                    pagesLoaded + 1,
                    fallbackFileId,
                    itemId,
                    title,
                    mimeType,
                    activeClient,
                    call
                );
            });
    }

    private void startSaveChannelVideoDownload(
        int fileId,
        String itemId,
        String title,
        String mimeType,
        Client activeClient,
        PluginCall call
    ) {
        VideoDownloadTask task = new VideoDownloadTask(itemId, title, mimeType, call);
        VideoDownloadTask existingTask = videoDownloadTasks.putIfAbsent(fileId, task);
        if (existingTask != null) {
            String message = "This video is already being downloaded.";
            emitDownloadProgress(fileId, itemId, 0, 0, "failed", message);
            call.reject(message);
            return;
        }

        activeClient.send(new TdApi.DownloadFile(fileId, 32, 0, 0, true), result -> {
            if (videoDownloadTasks.get(fileId) != task) return;
            if (result instanceof TdApi.Error) {
                String message = "Could not download this Telegram video: " + ((TdApi.Error) result).message;
                failVideoDownload(fileId, task, message);
                return;
            }
            if (!(result instanceof TdApi.File)) {
                String message = "Telegram returned an unexpected video download response.";
                failVideoDownload(fileId, task, message);
                return;
            }
            TdApi.File file = (TdApi.File) result;
            if (file.local == null || !file.local.isDownloadingCompleted
                || file.local.path == null || file.local.path.isEmpty()) {
                failVideoDownload(fileId, task, "Telegram stopped before the full video was downloaded.");
                return;
            }
            try {
                JSObject response = saveDownloadedVideo(file.local.path, task.title, task.mimeType);
                response.put("fileId", fileId);
                videoDownloadTasks.remove(fileId, task);
                emitDownloadProgress(fileId, task.itemId, file.size, file.size, "completed", null);
                task.call.resolve(response);
            } catch (IOException error) {
                failVideoDownload(fileId, task, "Could not save Telegram video to device storage: " + error.getMessage());
            }
        });
    }

    private void failVideoDownload(int fileId, VideoDownloadTask task, String message) {
        if (!videoDownloadTasks.remove(fileId, task)) return;
        emitDownloadProgress(fileId, task.itemId, 0, 0, "failed", message);
        task.call.reject(message);
    }

    @PluginMethod
    public void downloadRemoteVideo(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        String itemId = call.getString("itemId", "").trim();
        String title = call.getString("title", "AMZY video");
        String mimeType = call.getString("mimeType", "video/mp4");
        Uri source = Uri.parse(rawUrl);
        if (!"https".equalsIgnoreCase(source.getScheme()) || source.getHost() == null) {
            call.reject("Only secure HTTPS video URLs can be downloaded.");
            return;
        }
        if (itemId.isEmpty()) {
            call.reject("The video reference is missing.");
            return;
        }

        String safeTitle = title.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (safeTitle.isEmpty()) safeTitle = "AMZY video";
        if (safeTitle.length() > 120) safeTitle = safeTitle.substring(0, 120).trim();
        String normalizedMimeType = mimeType.toLowerCase(Locale.ROOT).startsWith("video/")
            ? mimeType
            : "video/mp4";
        String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(normalizedMimeType);
        if (extension == null || extension.isEmpty()) extension = "mp4";
        String displayName = safeTitle + "." + extension;

        DownloadManager manager = (DownloadManager) getContext().getSystemService(android.content.Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android's download service is unavailable.");
            return;
        }
        try {
            DownloadManager.Request request = new DownloadManager.Request(source)
                .setTitle(safeTitle)
                .setDescription("Downloading with AMZY")
                .setMimeType(normalizedMimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "AMZY/" + displayName);
            long downloadId = manager.enqueue(request);
            pollRemoteVideoDownload(manager, downloadId, itemId, displayName, call);
        } catch (IllegalArgumentException | SecurityException error) {
            call.reject("Could not start the video download: " + error.getMessage());
        }
    }

    private void pollRemoteVideoDownload(
        DownloadManager manager,
        long downloadId,
        String itemId,
        String displayName,
        PluginCall call
    ) {
        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId));
        if (cursor == null) {
            emitRemoteDownloadProgress(itemId, 0, 0, "failed", "Android could not read download status.");
            call.reject("Android could not read download status.");
            return;
        }

        try (Cursor statusCursor = cursor) {
            if (!statusCursor.moveToFirst()) {
                emitRemoteDownloadProgress(itemId, 0, 0, "failed", "The download task could not be found.");
                call.reject("The download task could not be found.");
                return;
            }

            long downloaded = statusCursor.getLong(statusCursor.getColumnIndexOrThrow(
                DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR
            ));
            long total = statusCursor.getLong(statusCursor.getColumnIndexOrThrow(
                DownloadManager.COLUMN_TOTAL_SIZE_BYTES
            ));
            int status = statusCursor.getInt(statusCursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));

            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                Uri savedUri = manager.getUriForDownloadedFile(downloadId);
                if (savedUri == null) {
                    emitRemoteDownloadProgress(itemId, downloaded, total, "failed", "The downloaded file could not be opened.");
                    call.reject("The downloaded file could not be opened.");
                    return;
                }
                emitRemoteDownloadProgress(itemId, downloaded, total, "completed", null);
                JSObject response = new JSObject();
                response.put("location", "Downloads/AMZY/" + displayName);
                response.put("playbackUrl", savedUri.toString());
                call.resolve(response);
                return;
            }
            if (status == DownloadManager.STATUS_FAILED) {
                int reason = statusCursor.getInt(statusCursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                String message = "Android download failed (reason " + reason + ").";
                emitRemoteDownloadProgress(itemId, downloaded, total, "failed", message);
                call.reject(message);
                return;
            }

            emitRemoteDownloadProgress(itemId, downloaded, total, "downloading", null);
            playerHandler.postDelayed(
                () -> pollRemoteVideoDownload(manager, downloadId, itemId, displayName, call),
                500
            );
        } catch (IllegalArgumentException error) {
            String message = "Could not check download progress: " + error.getMessage();
            emitRemoteDownloadProgress(itemId, 0, 0, "failed", message);
            call.reject(message);
        }
    }

    private void emitRemoteDownloadProgress(
        String itemId,
        long downloaded,
        long total,
        String status,
        String error
    ) {
        JSObject event = new JSObject();
        event.put("fileId", 0);
        event.put("itemId", itemId);
        event.put("downloadedBytes", downloaded);
        event.put("totalBytes", total);
        event.put("progress", total > 0 ? Math.min(100, downloaded * 100 / total) : 0);
        event.put("status", status);
        if (error != null) event.put("error", error);
        playerHandler.post(() -> notifyListeners("downloadProgress", event));
    }

    private void emitDownloadProgress(
        int fileId,
        String itemId,
        long downloaded,
        long total,
        String status,
        String error
    ) {
        JSObject event = new JSObject();
        event.put("fileId", fileId);
        if (itemId != null && !itemId.isEmpty()) event.put("itemId", itemId);
        event.put("downloadedBytes", downloaded);
        event.put("totalBytes", total);
        event.put("progress", total > 0 ? Math.min(100, downloaded * 100 / total) : 0);
        event.put("status", status);
        if (error != null) event.put("error", error);
        playerHandler.post(() -> notifyListeners("downloadProgress", event));
    }

    private void emitDownloadProgress(int fileId, long downloaded, long total, String status, String error) {
        JSObject event = new JSObject();
        event.put("fileId", fileId);
        event.put("downloadedBytes", downloaded);
        event.put("totalBytes", total);
        event.put("progress", total > 0 ? Math.min(100, downloaded * 100 / total) : 0);
        event.put("status", status);
        if (error != null) event.put("error", error);
        playerHandler.post(() -> notifyListeners("downloadProgress", event));
    }

    private JSObject saveDownloadedVideo(String sourcePath, String title, String mimeType) throws IOException {
        String safeTitle = title == null ? "" : title.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (safeTitle.isEmpty()) safeTitle = "Telegram video";
        if (safeTitle.length() > 120) safeTitle = safeTitle.substring(0, 120).trim();
        String normalizedMimeType = mimeType == null || !mimeType.toLowerCase(Locale.ROOT).startsWith("video/")
            ? "video/mp4"
            : mimeType;
        String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(normalizedMimeType);
        if (extension == null || extension.isEmpty()) extension = "mp4";
        String displayName = safeTitle + "." + extension;
        String location;
        String playbackUrl;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, normalizedMimeType);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AMZY");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri destination = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (destination == null) throw new IOException("Android could not create a Downloads file.");
            try {
                copyVideoFile(sourcePath, resolver.openOutputStream(destination));
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(destination, completed, null, null);
            } catch (IOException error) {
                resolver.delete(destination, null, null);
                throw error;
            }
            location = "Downloads/AMZY/" + displayName;
            playbackUrl = destination.toString();
        } else {
            File downloadsDirectory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadsDirectory == null) downloadsDirectory = getContext().getFilesDir();
            if (!downloadsDirectory.exists() && !downloadsDirectory.mkdirs()) {
                throw new IOException("Could not create the app Downloads folder.");
            }
            File destination = new File(downloadsDirectory, displayName);
            try (InputStream input = new FileInputStream(sourcePath);
                 OutputStream output = new FileOutputStream(destination)) {
                copyVideoFile(input, output);
            }
            location = destination.getAbsolutePath();
            playbackUrl = Uri.fromFile(destination).toString();
        }

        JSObject response = new JSObject();
        response.put("location", location);
        response.put("playbackUrl", playbackUrl);
        return response;
    }

    private void copyVideoFile(String sourcePath, OutputStream output) throws IOException {
        if (output == null) throw new IOException("Android could not open the Downloads file.");
        try (InputStream input = new FileInputStream(sourcePath)) {
            copyVideoFile(input, output);
        }
    }

    private void copyVideoFile(InputStream input, OutputStream output) throws IOException {
        try (InputStream source = input; OutputStream destination = output) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = source.read(buffer)) != -1) destination.write(buffer, 0, count);
            destination.flush();
        }
    }

    @PluginMethod
    public void openChannelVideoStream(PluginCall call) {
        if (requireReadyClient(call) == null) return;
        int fileId = call.getInt("fileId", 0);
        if (fileId <= 0) {
            call.reject("The Telegram video file reference is invalid.");
            return;
        }
        Client activeClient = client;
        activeClient.send(new TdApi.GetFile(fileId), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("Could not open this Telegram video: " + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.File)) {
                call.reject("Telegram returned an unexpected video file response.");
                return;
            }
            TdApi.File file = (TdApi.File) result;
            long size = file.size;
            if (size <= 0) {
                call.reject("Telegram did not provide a valid video size for streaming.");
                return;
            }
            byte[] tokenBytes = new byte[24];
            new SecureRandom().nextBytes(tokenBytes);
            String token = Base64.encodeToString(tokenBytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            privateVideoStreams.put(token, new PrivateVideoStream(fileId, size));
            JSObject response = new JSObject();
            response.put("token", token);
            response.put("size", size);
            call.resolve(response);
        });
    }

    @PluginMethod
    public void readChannelVideoRange(PluginCall call) {
        if (requireReadyClient(call) == null) return;
        String token = call.getString("token", "").trim();
        PrivateVideoStream stream = privateVideoStreams.get(token);
        if (stream == null) {
            call.reject("This Telegram video stream is no longer available.");
            return;
        }
        Long requestedOffset = call.getLong("offset", -1L);
        long offset = requestedOffset == null ? -1L : requestedOffset;
        int length = call.getInt("length", 0);
        if (offset < 0 || offset >= stream.size || length <= 0 || length > 1024 * 1024) {
            call.reject("The requested Telegram video range is invalid.");
            return;
        }
        int requestedLength = (int) Math.min(length, stream.size - offset);
        Client activeClient = client;
        activeClient.send(
            new TdApi.DownloadFile(stream.fileId, 32, offset, requestedLength, true),
            result -> {
                if (result instanceof TdApi.Error) {
                    call.reject("Could not stream this Telegram video: " + ((TdApi.Error) result).message);
                    return;
                }
                if (!(result instanceof TdApi.File)) {
                    call.reject("Telegram returned an unexpected video range response.");
                    return;
                }
                TdApi.File file = (TdApi.File) result;
                if (file.local == null || file.local.path == null || file.local.path.isEmpty()) {
                    call.reject("Telegram did not provide the requested video data.");
                    return;
                }
                long availableStart = file.local.isDownloadingCompleted ? 0 : file.local.downloadOffset;
                long availableEnd = file.local.isDownloadingCompleted
                    ? stream.size
                    : availableStart + file.local.downloadedPrefixSize;
                long requestedEnd = offset + requestedLength;
                long actualEnd = Math.min(requestedEnd, availableEnd);
                if (offset < availableStart || actualEnd <= offset) {
                    call.reject("Telegram has not downloaded the requested video segment.");
                    return;
                }
                int actualLength = (int) (actualEnd - offset);
                byte[] bytes = new byte[actualLength];
                try (java.io.RandomAccessFile input = new java.io.RandomAccessFile(file.local.path, "r")) {
                    input.seek(offset);
                    input.readFully(bytes);
                } catch (IOException error) {
                    call.reject("Could not read the Telegram video segment: " + error.getMessage());
                    return;
                }
                JSObject response = new JSObject();
                response.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(response);
            }
        );
    }

    @PluginMethod
    public void closeChannelVideoStream(PluginCall call) {
        String token = call.getString("token", "").trim();
        privateVideoStreams.remove(token);
        call.resolve();
    }

    @PluginMethod
    public void prepareTelegramVideo(PluginCall call) {
        Client activeClient = requireReadyClient(call);
        if (activeClient == null) return;

        Integer requestedFileId = call.getInt("fileId");
        String requestedTitle = call.getString("title", "Telegram video");
        Double requestedStartPositionSeconds = call.getDouble("startPositionSeconds", 0.0);
        Boolean requestedAutoPlay = call.getBoolean("autoPlay", true);
        if (requestedStartPositionSeconds == null || !Double.isFinite(requestedStartPositionSeconds)
            || requestedStartPositionSeconds < 0) {
            call.reject("The saved video position is invalid.");
            return;
        }
        final long startPositionMs = (long) Math.min(
            requestedStartPositionSeconds * 1000,
            Long.MAX_VALUE
        );
        String rawChatId = call.getString("chatId", "").trim();
        String rawMessageId = call.getString("messageId", "").trim();
        if (rawChatId.isEmpty() != rawMessageId.isEmpty()) {
            call.reject("The Telegram chat and message references must be provided together.");
            return;
        }
        if (!rawChatId.isEmpty()) {
            final long chatId;
            final long messageId;
            try {
                chatId = Long.parseLong(rawChatId);
                messageId = Long.parseLong(rawMessageId);
            } catch (NumberFormatException error) {
                call.reject("The Telegram message reference is invalid.");
                return;
            }
            if (chatId == 0 || messageId <= 0) {
                call.reject("The Telegram message reference is invalid.");
                return;
            }

            activeClient.send(new TdApi.GetMessage(chatId, messageId), result -> {
                if (result instanceof TdApi.Error) {
                    call.reject("Could not refresh this Telegram video reference: "
                        + ((TdApi.Error) result).message);
                    return;
                }
                if (!(result instanceof TdApi.Message)) {
                    call.reject("Telegram returned an unexpected video message.");
                    return;
                }
                TdApi.Message message = (TdApi.Message) result;
                if (hasSensitiveContent(message.restrictionInfo)) {
                    call.reject("Telegram marks this post as sensitive. AMZY blocked it.");
                    return;
                }
                if (!message.canBeSaved || !(message.content instanceof TdApi.MessageVideo)) {
                    call.reject("This Telegram post is protected or no longer contains a playable video.");
                    return;
                }
                TdApi.Video video = ((TdApi.MessageVideo) message.content).video;
                if (video == null || video.video == null || video.video.id <= 0) {
                    call.reject("Telegram did not provide a playable video file for this post.");
                    return;
                }
                int currentFileId = video.video.id;
                checkSensitiveChatById(activeClient, chatId, (restricted, restrictionError) -> {
                    if (restrictionError != null || restricted) {
                        call.reject(restrictionError != null
                            ? restrictionError
                            : "Telegram marks this channel as sensitive. AMZY blocked it.");
                        return;
                    }
                    playableVideoFileIds.add(currentFileId);
                    prepareTelegramVideoFile(
                        call,
                        activeClient,
                        currentFileId,
                        requestedTitle,
                        startPositionMs,
                        requestedAutoPlay
                    );
                });
            });
            return;
        }

        if (requestedFileId == null || requestedFileId <= 0) {
            call.reject("Telegram video file ID is invalid.");
            return;
        }
        if (!playableVideoFileIds.contains(requestedFileId)) {
            call.reject("This Telegram video is not available for playback or is protected.");
            return;
        }
        prepareTelegramVideoFile(call, activeClient, requestedFileId, requestedTitle, startPositionMs, requestedAutoPlay);
    }

    @PluginMethod
    public void prepareLocalVideo(PluginCall call) {
        String path = call.getString("path", "").trim();
        String requestedTitle = call.getString("title", "Local video");
        Double requestedStartPositionSeconds = call.getDouble("startPositionSeconds", 0.0);
        Boolean requestedAutoPlay = call.getBoolean("autoPlay", true);
        if (path.isEmpty()) {
            call.reject("The local video path is missing.");
            return;
        }
        if (requestedStartPositionSeconds == null || !Double.isFinite(requestedStartPositionSeconds)
            || requestedStartPositionSeconds < 0) {
            call.reject("The saved video position is invalid.");
            return;
        }

        try {
            File importDirectory = new File(getContext().getFilesDir(), "local-videos").getCanonicalFile();
            File videoFile = new File(path).getCanonicalFile();
            if (!videoFile.getPath().startsWith(importDirectory.getPath() + File.separator)
                || !videoFile.isFile() || videoFile.length() <= 0) {
                call.reject("The local video is no longer available.");
                return;
            }
            MediaItem mediaItem = new MediaItem.Builder()
                .setUri(Uri.fromFile(videoFile))
                .build();
            startNativeVideoPlayback(
                call,
                mediaItem,
                new DefaultMediaSourceFactory(getContext()),
                0,
                videoFile.length(),
                requestedTitle,
                (long) Math.min(requestedStartPositionSeconds * 1000, Long.MAX_VALUE),
                requestedAutoPlay
            );
        } catch (IOException error) {
            call.reject("Could not access the selected local video.", error);
        }
    }

    private void prepareTelegramVideoFile(
        PluginCall call,
        Client activeClient,
        int requestedFileId,
        String requestedTitle,
        long startPositionMs,
        boolean autoPlay
    ) {
        activeClient.send(new TdApi.GetFile(requestedFileId), result -> {
            if (result instanceof TdApi.Error) {
                call.reject("Could not open this Telegram video: " + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.File)) {
                call.reject("Telegram returned an unexpected video file response.");
                return;
            }

            TdApi.File file = (TdApi.File) result;
            long fileSize = file.size > 0 ? file.size : file.expectedSize;
            if (fileSize <= 0) {
                call.reject("Telegram did not provide a valid video size for live streaming.");
                return;
            }

            Runnable startPlayback = () -> {
                TelegramRangeDataSource.Factory dataSourceFactory = new TelegramRangeDataSource.Factory(
                    this::getReadyClientForPlayback,
                    bytesRead -> onTelegramVideoBytesRead(requestedFileId, bytesRead),
                    requestedFileId,
                    fileSize
                );
                startNativeVideoPlayback(
                    call,
                    new MediaItem.Builder().setUri("telegram://video/" + requestedFileId).build(),
                    new DefaultMediaSourceFactory(dataSourceFactory),
                    requestedFileId,
                    fileSize,
                    requestedTitle,
                    startPositionMs,
                    autoPlay
                );
            };
            if (file.local != null && file.local.isDownloadingActive) {
                activeClient.send(new TdApi.CancelDownloadFile(requestedFileId, false), cancelResult -> {
                    if (cancelResult instanceof TdApi.Error) {
                        call.reject("Could not stop the existing Telegram download before streaming: "
                            + ((TdApi.Error) cancelResult).message);
                        return;
                    }
                    startPlayback.run();
                });
            } else {
                startPlayback.run();
            }
        });
    }

    private void startNativeVideoPlayback(
        PluginCall call,
        MediaItem mediaItem,
        MediaSource.Factory mediaSourceFactory,
        int fileId,
        long fileSize,
        String requestedTitle,
        long startPositionMs,
        boolean autoPlay
    ) {
        getActivity().runOnUiThread(() -> {
            try {
                releaseNativePlayer();
                attachNativePlayerView();
                DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(getContext())
                    .setEnableDecoderFallback(true)
                    .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);
                DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(15_000, 60_000, 2_500, 5_000)
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .build();
                exoPlayer = new ExoPlayer.Builder(getContext(), renderersFactory)
                    .setLoadControl(loadControl)
                    .setMediaSourceFactory(mediaSourceFactory)
                    .build();
                exoPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                        .build(),
                    true
                );
                exoPlayer.setHandleAudioBecomingNoisy(true);
                playbackSubtitlesEnabled = false;
                exoPlayer.setTrackSelectionParameters(
                    exoPlayer.getTrackSelectionParameters()
                        .buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                        .build()
                );
                exoPlayer.setVolume(1f);
                exoPlayer.addListener(new Player.Listener() {
                    @Override
                    public void onPlaybackStateChanged(int playbackState) {
                        playerIsLoading = playbackState == Player.STATE_BUFFERING;
                        playerEnded = playbackState == Player.STATE_ENDED;
                        if (playerEnded) {
                            ((MainActivity) getActivity()).setVideoPlaybackActive(false);
                        }
                        renderNativePlaybackUi();
                        emitVideoPlayerState(playerError);
                    }

                    @Override
                    public void onIsPlayingChanged(boolean isPlaying) {
                        ((MainActivity) getActivity()).setVideoPlaybackActive(isPlaying);
                        renderNativePlaybackUi();
                        emitVideoPlayerState(playerError);
                    }

                    @Override
                    public void onTracksChanged(Tracks tracks) {
                        renderNativePlaybackUi();
                    }

                    @Override
                    public void onPlayerError(androidx.media3.common.PlaybackException error) {
                        String mediaType = fileId > 0 ? "Telegram" : "local";
                        android.util.Log.e("TelegramAuth", mediaType + " video playback failed", error);
                        ((MainActivity) getActivity()).setVideoPlaybackActive(false);
                        playerIsLoading = false;
                        playerError = "Android player could not play this " + mediaType + " video: "
                            + describePlaybackError(error);
                        playerStatusMessage = fileId > 0
                            ? "Live stream failed. You can download the complete video to play it."
                            : null;
                        if (nativePlaybackDownloadFallbackButton != null) {
                            nativePlaybackDownloadFallbackButton.setEnabled(true);
                            nativePlaybackDownloadFallbackButton.setText("Download full video to play");
                            nativePlaybackDownloadFallbackButton.setVisibility(
                                fileId > 0 && playableVideoFileIds.contains(fileId) ? View.VISIBLE : View.GONE
                            );
                        }
                        streamErrorSent = true;
                        renderNativePlaybackUi();
                        emitVideoPlayerState(playerError);
                    }
                });
                exoPlayer.setMediaItem(mediaItem);
                activeVideoFileId = fileId;
                activeVideoFileSize = fileSize;
                activeVideoTitle = requestedTitle == null || requestedTitle.trim().isEmpty()
                    ? (fileId > 0 ? "Telegram video" : "Local video")
                    : requestedTitle.trim();
                playerIsLoading = true;
                playerEnded = false;
                playerError = null;
                playerStatusMessage = null;
                fallbackDownloadActive = false;
                if (nativePlaybackDownloadFallbackButton != null) {
                    nativePlaybackDownloadFallbackButton.setText("Download full video to play");
                    nativePlaybackDownloadFallbackButton.setEnabled(true);
                    nativePlaybackDownloadFallbackButton.setVisibility(View.GONE);
                }
                streamErrorSent = false;
                streamBytesSent = 0;
                nativePlayerView.setVisibility(View.VISIBLE);
                nativePlayerView.setPlayer(exoPlayer);
                nativePlayerWebView.setVisibility(View.GONE);
                exoPlayer.prepare();
                if (startPositionMs > 0) exoPlayer.seekTo(startPositionMs);
                if (autoPlay) exoPlayer.play();
                ((MainActivity) getActivity()).setVideoPlaybackActive(autoPlay);
                ((MainActivity) getActivity()).setPictureInPicturePlaybackActive(autoPlay, activeVideoTitle);
                renderNativePlaybackUi();
                playerHandler.removeCallbacks(playerStateUpdater);
                playerHandler.post(playerStateUpdater);
                JSObject response = new JSObject();
                if (fileId > 0) response.put("fileId", fileId);
                call.resolve(response);
            } catch (Exception error) {
                releaseNativePlayer();
                String source = fileId > 0 ? "Telegram live" : "local";
                call.reject("Could not prepare Android " + source + " playback: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void controlTelegramVideo(PluginCall call) {
        String action = call.getString("action", "");
        Float value = call.getFloat("value");
        getActivity().runOnUiThread(() -> {
            ExoPlayer player = exoPlayer;
            if (player == null) {
                call.reject("No Telegram video is currently open.");
                return;
            }
            switch (action) {
                case "play":
                    player.play();
                    ((MainActivity) getActivity()).setVideoPlaybackActive(true);
                    break;
                case "pause":
                    player.pause();
                    ((MainActivity) getActivity()).setVideoPlaybackActive(false);
                    break;
                case "seek":
                    if (value == null || value < 0) {
                        call.reject("Video seek position is invalid.");
                        return;
                    }
                    if (!player.isCurrentWindowSeekable()) {
                        showSeekUnavailableMessage();
                        break;
                    }
                    player.seekTo((long) (value * 1000));
                    break;
                case "volume":
                    if (value == null || value < 0 || value > 1) {
                        call.reject("Video volume is invalid.");
                        return;
                    }
                    player.setVolume(value);
                    break;
                case "speed":
                    if (value == null || value <= 0) {
                        call.reject("Video playback speed is invalid.");
                        return;
                    }
                    player.setPlaybackParameters(new PlaybackParameters(value));
                    break;
                default:
                    call.reject("Unsupported native video command.");
                    return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setPictureInPicturePlaybackActive(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        String title = call.getString("title", "AMZY");
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("Picture-in-picture is only available in the Android app.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            boolean supported = ((MainActivity) getActivity()).setPictureInPicturePlaybackActive(enabled, title);
            if (supported) {
                call.resolve();
            } else {
                call.reject("Picture-in-picture requires Android 8.0 or newer.");
            }
        });
    }

    @PluginMethod
    public void setVideoPlaybackActive(PluginCall call) {
        boolean active = call.getBoolean("active", false);
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("Keeping the screen awake is only available in the Android app.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).setVideoPlaybackActive(active);
            call.resolve();
        });
    }

    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("Picture-in-picture is only available in the Android app.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            boolean entered = ((MainActivity) getActivity()).enterPictureInPicturePlayback();
            if (entered) {
                call.resolve();
            } else {
                call.reject("Start playing a video before opening picture-in-picture.");
            }
        });
    }

    public void onPictureInPictureModeChanged(boolean inPictureInPictureMode) {
        getActivity().runOnUiThread(() -> {
            this.inPictureInPictureMode = inPictureInPictureMode;
            if (nativePlaybackOverlay != null) {
                nativePlaybackOverlay.setVisibility(inPictureInPictureMode ? View.GONE : View.VISIBLE);
            }
            renderNativePlaybackUi();
        });
    }

    @PluginMethod
    public void stopTelegramVideo(PluginCall call) {
        Integer requestedFileId = call.getInt("fileId");
        getActivity().runOnUiThread(() -> {
            if (requestedFileId == null || activeVideoFileId == requestedFileId) {
                JSObject state = new JSObject();
                state.put("closed", true);
                notifyListeners("videoPlayerState", state);
                releaseNativePlayer();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setScreenOrientationLock(PluginCall call) {
        boolean locked = call.getBoolean("locked", false);
        getActivity().runOnUiThread(() -> {
            setPlaybackOrientationLocked(locked);
            call.resolve();
        });
    }

    private void setPlaybackOrientationLocked(boolean locked) {
        if (locked == playbackOrientationLocked) return;
        if (locked) {
            previousRequestedOrientation = getActivity().getRequestedOrientation();
            getActivity().setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LOCKED);
            playbackOrientationLocked = true;
        } else {
            getActivity().setRequestedOrientation(previousRequestedOrientation);
            playbackOrientationLocked = false;
        }
        if (nativePlaybackOrientationButton != null) {
            if (nativePlaybackOrientationIcon != null) {
                nativePlaybackOrientationIcon.setLocked(playbackOrientationLocked);
            }
            nativePlaybackOrientationButton.setContentDescription(
                playbackOrientationLocked ? "Unlock screen rotation" : "Lock screen rotation"
            );
        }
    }

    private Client getReadyClientForPlayback() throws IOException {
        Client activeClient = client;
        if (activeClient == null || clientClosed || !STEP_READY.equals(authStep)) {
            throw new IOException("Log in to Telegram again to continue streaming.");
        }
        return activeClient;
    }

    private void attachNativePlayerView() {
        if (nativePlaybackLayer != null) return;
        nativePlayerWebView = getBridge().getWebView();
        ViewParent parent = nativePlayerWebView.getParent();
        if (!(parent instanceof ViewGroup)) {
            throw new IllegalStateException("Could not attach the native video surface.");
        }
        nativePlaybackLayer = new FrameLayout(getContext());
        nativePlaybackLayer.setBackgroundColor(Color.BLACK);
        nativePlayerView = new PlayerView(getContext());
        nativePlayerView.setUseController(false);
        nativePlayerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        nativePlayerView.setVisibility(View.GONE);
        nativePlaybackLayer.addView(
            nativePlayerView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        nativePlaybackLoadingLogo = new ImageView(getContext());
        nativePlaybackLoadingLogo.setImageResource(com.chakrabortycompliance.amzy.R.drawable.amzy_logo);
        nativePlaybackLoadingLogo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        nativePlaybackLoadingLogo.setVisibility(View.GONE);
        nativePlaybackLayer.addView(
            nativePlaybackLoadingLogo,
            new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER)
        );
        createNativePlaybackControls();
        ViewGroup viewGroup = (ViewGroup) parent;
        viewGroup.addView(
            nativePlaybackLayer,
            new CoordinatorLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        enterImmersivePlayback();
    }

    private void createNativePlaybackControls() {
        int white = Color.WHITE;
        int mutedWhite = Color.rgb(205, 205, 205);
        int playerAccent = Color.rgb(255, 136, 0);
        int horizontalPadding = dp(20);
        int verticalPadding = dp(16);

        LinearLayout root = new LinearLayout(getContext());
        nativePlaybackOverlay = root;
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(horizontalPadding, verticalPadding, horizontalPadding, verticalPadding);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            view.setPadding(
                horizontalPadding + cutout.left,
                verticalPadding + cutout.top,
                horizontalPadding + cutout.right,
                verticalPadding + cutout.bottom
            );
            return insets;
        });
        root.setBackgroundColor(Color.TRANSPARENT);
        root.setOnClickListener(view -> setPlaybackControlsVisible(!playbackControlsVisible));
        root.setOnTouchListener(this::handlePlaybackTouch);
        nativePlaybackLayer.addView(root, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        LinearLayout topBar = new LinearLayout(getContext());
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        root.addView(topBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        nativePlaybackControls = topBar;

        Button closeButton = createPlaybackButton("‹", white);
        closeButton.setTextSize(32);
        topBar.addView(closeButton, new LinearLayout.LayoutParams(dp(48), dp(48)));
        closeButton.setOnClickListener(view -> {
            JSObject state = new JSObject();
            state.put("closed", true);
            notifyListeners("videoPlayerState", state);
            releaseNativePlayer();
        });

        LinearLayout titleColumn = new LinearLayout(getContext());
        titleColumn.setOrientation(LinearLayout.VERTICAL);
        titleColumn.setPadding(dp(8), 0, dp(8), 0);
        topBar.addView(titleColumn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        TextView playerLabel = createPlaybackText("ANDROID PLAYER", playerAccent, 11, true);
        titleColumn.addView(playerLabel);
        nativePlaybackTitle = createPlaybackText("", white, 16, true);
        titleColumn.addView(nativePlaybackTitle);
        nativePlaybackSubtitle = createPlaybackText("", mutedWhite, 12, false);
        titleColumn.addView(nativePlaybackSubtitle);

        FrameLayout centerStatus = new FrameLayout(getContext());
        LinearLayout.LayoutParams centerParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1
        );
        root.addView(centerStatus, centerParams);
        LinearLayout statusColumn = new LinearLayout(getContext());
        statusColumn.setGravity(Gravity.CENTER);
        statusColumn.setOrientation(LinearLayout.VERTICAL);
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        centerStatus.addView(statusColumn, statusParams);
        nativePlaybackSpinner = new ProgressBar(getContext());
        nativePlaybackSpinner.setIndeterminateTintList(ColorStateList.valueOf(playerAccent));
        statusColumn.addView(nativePlaybackSpinner, new LinearLayout.LayoutParams(dp(48), dp(48)));
        nativePlaybackStatus = createPlaybackText("Connecting to Telegram...", white, 14, true);
        LinearLayout.LayoutParams statusTextParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusTextParams.topMargin = dp(12);
        statusColumn.addView(nativePlaybackStatus, statusTextParams);
        nativePlaybackDownloadFallbackButton = createPlaybackButton("Download full video to play", white);
        nativePlaybackDownloadFallbackButton.setTextSize(14);
        nativePlaybackDownloadFallbackButton.setVisibility(View.GONE);
        statusColumn.addView(nativePlaybackDownloadFallbackButton, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(48)
        ));
        nativePlaybackDownloadFallbackButton.setOnClickListener(view -> startFullDownloadPlayback());
        nativePlaybackGestureFeedback = createPlaybackText("", white, 16, true);
        nativePlaybackGestureFeedback.setGravity(Gravity.CENTER);
        nativePlaybackGestureFeedback.setPadding(dp(18), dp(10), dp(18), dp(10));
        nativePlaybackGestureFeedback.setBackgroundColor(0xB3000000);
        nativePlaybackGestureFeedback.setVisibility(View.GONE);
        FrameLayout.LayoutParams gestureFeedbackParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        centerStatus.addView(nativePlaybackGestureFeedback, gestureFeedbackParams);

        LinearLayout bottomBar = new LinearLayout(getContext());
        bottomBar.setOrientation(LinearLayout.VERTICAL);
        bottomBar.setPadding(dp(12), dp(8), dp(12), dp(10));
        bottomBar.setBackgroundColor(0x99000000);
        root.addView(bottomBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        nativePlaybackBottomBar = bottomBar;

        nativePlaybackSeekBar = new SeekBar(getContext());
        nativePlaybackSeekBar.setMax(1000);
        nativePlaybackSeekBar.setProgressTintList(ColorStateList.valueOf(playerAccent));
        nativePlaybackSeekBar.setThumbTintList(ColorStateList.valueOf(playerAccent));
        bottomBar.addView(nativePlaybackSeekBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        nativePlaybackSeekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (fromUser && exoPlayer != null && exoPlayer.getDuration() > 0
                    && nativePlaybackTime != null) {
                    long targetPosition = exoPlayer.getDuration() * progress / 1000L;
                    nativePlaybackTime.setText(
                        formatTime(targetPosition) + " / " + formatTime(exoPlayer.getDuration())
                    );
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {}

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
                if (exoPlayer != null && exoPlayer.getDuration() > 0
                    && exoPlayer.isCurrentWindowSeekable()) {
                    exoPlayer.seekTo(exoPlayer.getDuration() * seekBar.getProgress() / 1000L);
                }
            }
        });

        LinearLayout controls = new LinearLayout(getContext());
        controls.setGravity(Gravity.CENTER_VERTICAL);
        bottomBar.addView(controls, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        Button playButton = createPlaybackButton("Ⅱ", white);
        nativePlaybackPlayButton = playButton;
        controls.addView(playButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        playButton.setOnClickListener(view -> toggleNativePlayback());
        Button rewindButton = createPlaybackButton("−10", white);
        rewindButton.setTextSize(14);
        controls.addView(rewindButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        rewindButton.setOnClickListener(view -> seekNativeBy(-10_000));
        Button forwardButton = createPlaybackButton("+10", white);
        forwardButton.setTextSize(14);
        controls.addView(forwardButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        forwardButton.setOnClickListener(view -> seekNativeBy(10_000));
        nativePlaybackVolumeButton = createPlaybackButton("VOL", white);
        nativePlaybackVolumeButton.setTextSize(12);
        controls.addView(nativePlaybackVolumeButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        nativePlaybackVolumeButton.setOnClickListener(view -> toggleNativeMute());
        nativePlaybackSubtitleButton = createPlaybackButton("CC OFF", white);
        nativePlaybackSubtitleButton.setTextSize(10);
        controls.addView(nativePlaybackSubtitleButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        nativePlaybackSubtitleButton.setOnClickListener(view -> togglePlaybackSubtitles());
        nativePlaybackAudioButton = createPlaybackButton("⋮", white);
        nativePlaybackAudioButton.setContentDescription("Audio language");
        nativePlaybackAudioButton.setTextSize(24);
        controls.addView(nativePlaybackAudioButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        nativePlaybackAudioButton.setOnClickListener(this::showAudioTrackMenu);
        nativePlaybackOrientationButton = createPlaybackButton("", white);
        nativePlaybackOrientationButton.setContentDescription("Lock screen rotation");
        nativePlaybackOrientationIcon = new RotationLockDrawable(
            getContext().getResources().getDisplayMetrics().density,
            playbackOrientationLocked
        );
        nativePlaybackOrientationIcon.setBounds(
            0,
            0,
            nativePlaybackOrientationIcon.getIntrinsicWidth(),
            nativePlaybackOrientationIcon.getIntrinsicHeight()
        );
        nativePlaybackOrientationButton.setCompoundDrawables(
            nativePlaybackOrientationIcon,
            null,
            null,
            null
        );
        controls.addView(nativePlaybackOrientationButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        nativePlaybackOrientationButton.setOnClickListener(view ->
            setPlaybackOrientationLocked(!playbackOrientationLocked)
        );
        nativePlaybackZoomButton = createPlaybackButton("ZOOM", white);
        nativePlaybackZoomButton.setTextSize(11);
        nativePlaybackZoomButton.setContentDescription("Zoom video to fill the screen");
        controls.addView(nativePlaybackZoomButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        nativePlaybackZoomButton.setOnClickListener(view -> togglePlaybackZoom());
        nativePlaybackTime = createPlaybackText("00:00 / 00:00", white, 12, false);
        nativePlaybackTime.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        bottomBar.addView(nativePlaybackTime, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ));
    }

    private void togglePlaybackZoom() {
        if (nativePlayerView == null || nativePlaybackZoomButton == null) return;
        playbackZoomEnabled = !playbackZoomEnabled;
        nativePlayerView.setResizeMode(
            playbackZoomEnabled
                ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                : AspectRatioFrameLayout.RESIZE_MODE_FIT
        );
        nativePlaybackZoomButton.setText(playbackZoomEnabled ? "FIT" : "ZOOM");
        nativePlaybackZoomButton.setContentDescription(
            playbackZoomEnabled ? "Fit the whole video on screen" : "Zoom video to fill the screen"
        );
    }

    private void setPlaybackControlsVisible(boolean visible) {
        playbackControlsVisible = visible;
        if (nativePlaybackControls != null) {
            nativePlaybackControls.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
        if (nativePlaybackBottomBar != null) {
            nativePlaybackBottomBar.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    private boolean handlePlaybackTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                gestureTracking = true;
                gestureAdjusting = false;
                gestureStartX = event.getX();
                gestureStartY = event.getY();
                gestureAdjustmentSide = gestureStartX < view.getWidth() / 2f ? 1 : 2;
                gestureStartValue = gestureAdjustmentSide == 1
                    ? playbackBrightness
                    : (exoPlayer == null ? 0f : exoPlayer.getVolume());
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!gestureTracking) return false;
                float deltaY = gestureStartY - event.getY();
                float deltaX = event.getX() - gestureStartX;
                float threshold = dp(12);
                if (!gestureAdjusting && Math.abs(deltaY) > threshold
                    && Math.abs(deltaY) > Math.abs(deltaX)) {
                    gestureAdjusting = true;
                } else if (!gestureAdjusting && Math.abs(deltaX) > threshold) {
                    gestureTracking = false;
                    return true;
                }
                if (gestureAdjusting) {
                    float change = deltaY / Math.max(1, view.getHeight());
                    float adjustedValue = Math.max(0f, Math.min(1f, gestureStartValue + change));
                    if (gestureAdjustmentSide == 1) {
                        playbackBrightness = Math.max(0.01f, adjustedValue);
                        setPlaybackBrightness(playbackBrightness);
                        showPlaybackGestureFeedback(
                            "Brightness " + Math.round(playbackBrightness * 100) + "%"
                        );
                    } else if (exoPlayer != null) {
                        exoPlayer.setVolume(adjustedValue);
                        renderNativePlaybackUi();
                        showPlaybackGestureFeedback("Volume " + Math.round(adjustedValue * 100) + "%");
                    }
                }
                return true;
            case MotionEvent.ACTION_UP:
                boolean adjustedDuringGesture = gestureAdjusting;
                if (gestureTracking && !gestureAdjusting) {
                    long tapTime = event.getEventTime();
                    int tapSide = gestureAdjustmentSide;
                    if (tapTime - lastPlaybackTapTime <= 300 && tapSide == lastPlaybackTapSide) {
                        seekNativeBy(tapSide == 1 ? -10_000 : 10_000);
                        showPlaybackGestureFeedback(tapSide == 1 ? "−10 seconds" : "+10 seconds");
                        lastPlaybackTapTime = 0;
                    } else {
                        view.performClick();
                        lastPlaybackTapTime = tapTime;
                        lastPlaybackTapSide = tapSide;
                    }
                }
                gestureTracking = false;
                gestureAdjusting = false;
                if (adjustedDuringGesture) {
                    view.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
                gestureTracking = false;
                gestureAdjusting = false;
                return true;
            default:
                return gestureTracking;
        }
    }

    private void showPlaybackGestureFeedback(String message) {
        if (nativePlaybackGestureFeedback == null) return;
        playerHandler.removeCallbacks(hidePlaybackGestureFeedback);
        nativePlaybackGestureFeedback.setText(message);
        nativePlaybackGestureFeedback.setVisibility(View.VISIBLE);
        playerHandler.postDelayed(hidePlaybackGestureFeedback, 900);
    }

    private final Runnable hidePlaybackGestureFeedback = () -> {
        if (nativePlaybackGestureFeedback != null) {
            nativePlaybackGestureFeedback.setVisibility(View.GONE);
        }
    };

    private void setPlaybackBrightness(float brightness) {
        Window window = getActivity().getWindow();
        if (window == null) return;
        android.view.WindowManager.LayoutParams attributes = window.getAttributes();
        attributes.screenBrightness = brightness;
        window.setAttributes(attributes);
    }

    private void enterImmersivePlayback() {
        Window window = getActivity().getWindow();
        if (window == null || immersivePlaybackActive) return;

        previousWindowBrightness = window.getAttributes().screenBrightness;
        if (previousWindowBrightness >= 0f) {
            playbackBrightness = previousWindowBrightness;
        } else {
            int systemBrightness = Settings.System.getInt(
                getContext().getContentResolver(),
                Settings.System.SCREEN_BRIGHTNESS,
                128
            );
            playbackBrightness = Math.max(0.01f, Math.min(1f, systemBrightness / 255f));
        }
        playbackBrightnessCaptured = true;
        View decorView = window.getDecorView();
        previousSystemUiVisibility = decorView.getSystemUiVisibility();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsets insets = decorView.getRootWindowInsets();
            if (insets != null) {
                previousStatusBarVisible = insets.isVisible(WindowInsets.Type.statusBars());
                previousNavigationBarVisible = insets.isVisible(WindowInsets.Type.navigationBars());
            }
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                previousSystemBarsBehavior = controller.getSystemBarsBehavior();
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
        immersivePlaybackActive = true;
    }

    private void exitImmersivePlayback() {
        Window window = getActivity().getWindow();
        if (window != null && immersivePlaybackActive) {
            View decorView = window.getDecorView();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsBehavior(previousSystemBarsBehavior);
                    if (previousStatusBarVisible) {
                        controller.show(WindowInsets.Type.statusBars());
                    } else {
                        controller.hide(WindowInsets.Type.statusBars());
                    }
                    if (previousNavigationBarVisible) {
                        controller.show(WindowInsets.Type.navigationBars());
                    } else {
                        controller.hide(WindowInsets.Type.navigationBars());
                    }
                }
            }
            decorView.setSystemUiVisibility(previousSystemUiVisibility);
        }
        immersivePlaybackActive = false;
        if (window != null && playbackBrightnessCaptured) {
            android.view.WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.screenBrightness = previousWindowBrightness;
            window.setAttributes(attributes);
        }
        playbackBrightnessCaptured = false;
    }

    private Button createPlaybackButton(String label, int color) {
        Button button = new Button(getContext());
        button.setText(label);
        button.setTextColor(color);
        button.setTextSize(18);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(0, 0, 0, 0);
        button.setBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
        return button;
    }

    private TextView createPlaybackText(String text, int color, int sizeSp, boolean bold) {
        TextView label = new TextView(getContext());
        label.setText(text);
        label.setTextColor(color);
        label.setTextSize(sizeSp);
        if (bold) label.setTypeface(null, android.graphics.Typeface.BOLD);
        label.setMaxLines(2);
        label.setEllipsize(android.text.TextUtils.TruncateAt.END);
        return label;
    }

    private static final class RotationLockDrawable extends Drawable {
        private final float density;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private boolean locked;

        RotationLockDrawable(float density, boolean locked) {
            this.density = density;
            this.locked = locked;
            paint.setColor(Color.WHITE);
            paint.setAlpha(255);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
        }

        void setLocked(boolean locked) {
            this.locked = locked;
            invalidateSelf();
        }

        @Override
        public void draw(Canvas canvas) {
            android.graphics.Rect bounds = getBounds();
            if (bounds.isEmpty()) return;
            int save = canvas.save();
            canvas.translate(bounds.left, bounds.top);
            canvas.scale(bounds.width() / 24f, bounds.height() / 24f);
            paint.setStrokeWidth(locked ? 3f : 2.2f);
            Path shackle = new Path();
            shackle.moveTo(7, 11);
            shackle.lineTo(7, 8);
            shackle.cubicTo(7, 1.5f, 17, 1.5f, 17, 8);
            if (locked) {
                shackle.lineTo(17, 11);
            } else {
                shackle.lineTo(19, 7);
            }
            canvas.drawPath(shackle, paint);
            RectF body = new RectF(5, 10, 19, 22);
            canvas.drawRoundRect(body, 2, 2, paint);
            paint.setStyle(Paint.Style.FILL);
            canvas.drawCircle(12, 15, 1.2f, paint);
            canvas.drawRoundRect(new RectF(11.3f, 15, 12.7f, 18.5f), 0.7f, 0.7f, paint);
            paint.setStyle(Paint.Style.STROKE);
            canvas.restoreToCount(save);
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(android.graphics.ColorFilter colorFilter) {
            paint.setColorFilter(colorFilter);
        }

        @Override
        public int getOpacity() {
            return android.graphics.PixelFormat.TRANSLUCENT;
        }

        @Override
        public int getIntrinsicWidth() {
            return Math.round(24 * density);
        }

        @Override
        public int getIntrinsicHeight() {
            return Math.round(24 * density);
        }
    }

    private void toggleNativePlayback() {
        if (exoPlayer == null) return;
        if (exoPlayer.getPlayWhenReady()) {
            exoPlayer.pause();
        } else {
            exoPlayer.play();
        }
        renderNativePlaybackUi();
    }

    private void startFullDownloadPlayback() {
        final int fileId = activeVideoFileId;
        final Client activeClient = client;
        if (fileId <= 0 || activeClient == null || !playableVideoFileIds.contains(fileId)) return;

        fallbackDownloadActive = true;
        playerError = null;
        playerStatusMessage = "Downloading full video before playback...";
        playerIsLoading = true;
        if (nativePlaybackDownloadFallbackButton != null) {
            nativePlaybackDownloadFallbackButton.setEnabled(false);
            nativePlaybackDownloadFallbackButton.setText("Preparing download...");
        }
        renderNativePlaybackUi();
        emitVideoPlayerState(null);
        activeClient.send(new TdApi.DownloadFile(fileId, 32, 0, 0, false), result -> {
            if (result instanceof TdApi.Error) {
                failFullDownloadPlayback(fileId, "Could not start the full video download: "
                    + ((TdApi.Error) result).message);
                return;
            }
            pollFullDownload(fileId, activeClient);
        });
    }

    private void pollFullDownload(int fileId, Client activeClient) {
        if (!fallbackDownloadActive || activeVideoFileId != fileId) return;
        activeClient.send(new TdApi.GetFile(fileId), result -> {
            if (result instanceof TdApi.Error) {
                failFullDownloadPlayback(fileId, "Could not download the full video: "
                    + ((TdApi.Error) result).message);
                return;
            }
            if (!(result instanceof TdApi.File)) {
                failFullDownloadPlayback(fileId, "Telegram returned an unexpected download status.");
                return;
            }
            TdApi.File file = (TdApi.File) result;
            if (file.local != null && file.local.isDownloadingCompleted
                && file.local.path != null && !file.local.path.isEmpty()) {
                playerHandler.post(() -> playDownloadedVideo(fileId, file.local.path));
                return;
            }

            long totalSize = file.size > 0 ? file.size : activeVideoFileSize;
            long downloaded = file.local == null ? 0 : file.local.downloadedSize;
            playerHandler.post(() -> {
                if (!fallbackDownloadActive || activeVideoFileId != fileId) return;
                playerStatusMessage = totalSize > 0
                    ? "Downloading full video: " + Math.min(100, downloaded * 100 / totalSize) + "%"
                    : "Downloading full video...";
                renderNativePlaybackUi();
                playerHandler.postDelayed(() -> pollFullDownload(fileId, activeClient), 1000);
            });
        });
    }

    private void playDownloadedVideo(int fileId, String path) {
        if (!fallbackDownloadActive || activeVideoFileId != fileId || exoPlayer == null) return;
        fallbackDownloadActive = false;
        playerStatusMessage = "Full download complete. Playing from device.";
        playerError = null;
        playerIsLoading = true;
        if (nativePlaybackDownloadFallbackButton != null) {
            nativePlaybackDownloadFallbackButton.setVisibility(View.GONE);
        }
        MediaItem downloadedItem = new MediaItem.Builder()
            .setUri(Uri.fromFile(new File(path)))
            .build();
        exoPlayer.setMediaItem(downloadedItem);
        exoPlayer.prepare();
        exoPlayer.play();
        renderNativePlaybackUi();
        emitVideoPlayerState(null);
    }

    private void failFullDownloadPlayback(int fileId, String message) {
        playerHandler.post(() -> {
            if (activeVideoFileId != fileId) return;
            fallbackDownloadActive = false;
            playerIsLoading = false;
            playerError = message;
            playerStatusMessage = "Download failed. Check your connection and try again.";
            if (nativePlaybackDownloadFallbackButton != null) {
                nativePlaybackDownloadFallbackButton.setEnabled(true);
                nativePlaybackDownloadFallbackButton.setText("Retry full download");
                nativePlaybackDownloadFallbackButton.setVisibility(View.VISIBLE);
            }
            renderNativePlaybackUi();
            emitVideoPlayerState(playerError);
        });
    }

    private void seekNativeBy(long offsetMs) {
        if (exoPlayer == null) return;
        if (!exoPlayer.isCurrentWindowSeekable()) {
            showSeekUnavailableMessage();
            return;
        }
        long nextPosition = Math.max(0, exoPlayer.getCurrentPosition() + offsetMs);
        long duration = exoPlayer.getDuration();
        if (duration > 0) nextPosition = Math.min(duration, nextPosition);
        exoPlayer.seekTo(nextPosition);
    }

    private void showSeekUnavailableMessage() {
        android.widget.Toast.makeText(
            getContext(),
            "Seeking is unavailable for this video while streaming.",
            android.widget.Toast.LENGTH_LONG
        ).show();
    }

    private void toggleNativeMute() {
        if (exoPlayer == null) return;
        if (exoPlayer.getVolume() == 0) {
            exoPlayer.setVolume(1f);
        } else {
            exoPlayer.setVolume(0f);
        }
        renderNativePlaybackUi();
    }

    private void togglePlaybackSubtitles() {
        if (exoPlayer == null) return;
        playbackSubtitlesEnabled = !playbackSubtitlesEnabled;
        exoPlayer.setTrackSelectionParameters(
            exoPlayer.getTrackSelectionParameters()
                .buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !playbackSubtitlesEnabled)
                .build()
        );
        renderNativePlaybackUi();
    }

    private void showAudioTrackMenu(View anchor) {
        ExoPlayer player = exoPlayer;
        if (player == null) return;

        PopupMenu menu = new PopupMenu(getContext(), anchor);
        android.view.MenuItem automaticItem = menu.getMenu().add("Auto (recommended)");
        automaticItem.setCheckable(true);
        boolean hasAudioOverride = false;
        for (TrackSelectionOverride override : player.getTrackSelectionParameters().overrides.values()) {
            if (override.getType() == C.TRACK_TYPE_AUDIO) {
                hasAudioOverride = true;
                break;
            }
        }
        automaticItem.setChecked(!hasAudioOverride);
        automaticItem.setOnMenuItemClickListener(item -> {
            ExoPlayer activePlayer = exoPlayer;
            if (activePlayer == null) return false;
            activePlayer.setTrackSelectionParameters(
                activePlayer.getTrackSelectionParameters()
                    .buildUpon()
                    .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                    .build()
            );
            return true;
        });

        int totalAudioTracks = 0;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() == C.TRACK_TYPE_AUDIO) {
                totalAudioTracks += group.length;
            }
        }
        boolean hasAudioTracks = false;
        int trackNumber = 0;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO) continue;
            for (int trackIndex = 0; trackIndex < group.length; trackIndex++) {
                hasAudioTracks = true;
                trackNumber++;
                androidx.media3.common.Format format = group.getTrackFormat(trackIndex);
                boolean supported = group.isTrackSupported(trackIndex);
                String label = audioTrackLabel(format, trackIndex, group.length);
                if (totalAudioTracks > 1) label += " (Track " + trackNumber + ")";
                if (!supported) label += " - Not supported on this device";
                android.view.MenuItem item = menu.getMenu().add(label);
                item.setCheckable(true);
                item.setChecked(group.isTrackSelected(trackIndex));
                item.setEnabled(supported);
                Tracks.Group selectedGroup = group;
                int selectedTrackIndex = trackIndex;
                item.setOnMenuItemClickListener(selectedItem -> {
                    ExoPlayer activePlayer = exoPlayer;
                    if (activePlayer == null) return false;
                    activePlayer.setTrackSelectionParameters(
                        activePlayer.getTrackSelectionParameters()
                            .buildUpon()
                            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                            .addOverride(new TrackSelectionOverride(
                                selectedGroup.getMediaTrackGroup(),
                                selectedTrackIndex
                            ))
                            .build()
                    );
                    return true;
                });
            }
        }

        if (!hasAudioTracks) {
            android.view.MenuItem unavailableItem = menu.getMenu().add("No audio tracks available");
            unavailableItem.setEnabled(false);
        }
        menu.show();
    }

    private String audioTrackLabel(androidx.media3.common.Format format, int trackIndex, int trackCount) {
        String language = format.language;
        String label;
        if (language == null || language.trim().isEmpty() || "und".equals(language)) {
            label = "Unknown language";
        } else {
            Locale languageLocale = Locale.forLanguageTag(language);
            String displayLanguage = languageLocale.getDisplayLanguage(Locale.getDefault());
            label = displayLanguage.isEmpty() ? language : displayLanguage;
        }
        if (format.label != null && !format.label.trim().isEmpty()
            && !format.label.equalsIgnoreCase(label)) {
            label += " - " + format.label.trim();
        } else if (trackCount > 1) {
            label += " - Track " + (trackIndex + 1);
        }
        if (format.channelCount > 0) {
            label += format.channelCount == 1 ? " (Mono)" : " (" + format.channelCount + " ch)";
        }
        return label;
    }

    private void renderNativePlaybackUi() {
        if (nativePlaybackTitle == null) return;
        nativePlaybackTitle.setText(activeVideoTitle);
        nativePlaybackSubtitle.setText("Video size: " + formatFileSize(activeVideoFileSize));
        boolean loading = playerIsLoading && playerError == null;
        nativePlaybackSpinner.setVisibility(loading ? View.VISIBLE : View.GONE);
        if (nativePlaybackLoadingLogo != null) {
            nativePlaybackLoadingLogo.setVisibility(loading && inPictureInPictureMode ? View.VISIBLE : View.GONE);
        }
        nativePlaybackStatus.setVisibility(loading || playerError != null || playerStatusMessage != null
            ? View.VISIBLE
            : View.GONE);
        nativePlaybackStatus.setText(playerError == null
            ? (playerStatusMessage == null
                ? (activeVideoFileId > 0
                    ? "Streamed to Android player: " + formatFileSize(streamBytesSent)
                    : "Playing local video")
                : playerStatusMessage)
            : playerError);
        if (nativePlaybackPlayButton != null && exoPlayer != null) {
            nativePlaybackPlayButton.setText(exoPlayer.getPlayWhenReady() ? "Ⅱ" : "▶");
        }
        if (nativePlaybackVolumeButton != null && exoPlayer != null) {
            nativePlaybackVolumeButton.setText(exoPlayer.getVolume() == 0 ? "MUTE" : "VOL");
        }
        if (nativePlaybackSubtitleButton != null) {
            nativePlaybackSubtitleButton.setText(playbackSubtitlesEnabled ? "CC ON" : "CC OFF");
        }
        if (nativePlaybackAudioButton != null && exoPlayer != null) {
            boolean hasAudioTrack = false;
            for (Tracks.Group group : exoPlayer.getCurrentTracks().getGroups()) {
                if (group.getType() == C.TRACK_TYPE_AUDIO) {
                    hasAudioTrack = group.length > 0;
                }
                if (hasAudioTrack) break;
            }
            nativePlaybackAudioButton.setEnabled(hasAudioTrack);
            nativePlaybackAudioButton.setAlpha(hasAudioTrack ? 1f : 0.5f);
        }
        if (nativePlaybackSeekBar != null && exoPlayer != null) {
            long length = exoPlayer.getDuration();
            long current = exoPlayer.getCurrentPosition();
            boolean canSeek = length > 0 && exoPlayer.isCurrentWindowSeekable();
            nativePlaybackSeekBar.setEnabled(canSeek);
            if (canSeek && !nativePlaybackSeekBar.isPressed()) {
                nativePlaybackSeekBar.setProgress((int) Math.min(1000, current * 1000 / length));
            }
            if (nativePlaybackTime != null) {
                nativePlaybackTime.setText(formatTime(current) + " / " + formatTime(length));
            }
        }
    }

    private String formatFileSize(long bytes) {
        if (bytes <= 0) return "Unknown size";
        String[] units = {"B", "KB", "MB", "GB", "TB"};
        int unit = Math.min((int) (Math.log(bytes) / Math.log(1024)), units.length - 1);
        return String.format(Locale.ROOT, unit < 2 ? "%.0f %s" : "%.1f %s", bytes / Math.pow(1024, unit), units[unit]);
    }

    private String formatTime(long timeMs) {
        if (timeMs < 0) return "00:00";
        long totalSeconds = timeMs / 1000;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;
        return hours > 0
            ? String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds)
            : String.format(Locale.ROOT, "%02d:%02d", minutes, seconds);
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    private void emitVideoPlayerState(String error) {
        ExoPlayer player = exoPlayer;
        if (player == null) return;
        renderNativePlaybackUi();

        JSObject state = new JSObject();
        long currentTime = player.getCurrentPosition();
        long duration = player.getDuration();
        state.put("currentTime", currentTime < 0 ? 0 : currentTime / 1000.0);
        state.put("duration", duration < 0 ? 0 : duration / 1000.0);
        state.put("isPlaying", player.isPlaying());
        state.put("isLoading", playerIsLoading);
        state.put("ended", playerEnded);
        if (error != null) state.put("error", error);
        notifyListeners("videoPlayerState", state);
    }

    private void releaseNativePlayer() {
        playerHandler.removeCallbacks(playerStateUpdater);
        playerHandler.removeCallbacks(hidePlaybackGestureFeedback);
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).setPictureInPicturePlaybackActive(false, "AMZY");
            ((MainActivity) getActivity()).setVideoPlaybackActive(false);
        }
        setPlaybackOrientationLocked(false);
        if (fallbackDownloadActive && activeVideoFileId > 0) {
            Client activeClient = client;
            if (activeClient != null && !clientClosed) {
                activeClient.send(new TdApi.CancelDownloadFile(activeVideoFileId, false), result -> {
                    if (result instanceof TdApi.Error) {
                        android.util.Log.w("TelegramAuth", "Could not cancel fallback video download: "
                            + ((TdApi.Error) result).message);
                    }
                });
            }
        }
        if (exoPlayer != null) {
            if (nativePlayerView != null) nativePlayerView.setPlayer(null);
            exoPlayer.release();
            exoPlayer = null;
        }
        if (nativePlaybackLayer != null) {
            ViewParent parent = nativePlaybackLayer.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(nativePlaybackLayer);
            nativePlaybackLayer = null;
            nativePlayerView = null;
            nativePlaybackControls = null;
            nativePlaybackBottomBar = null;
            nativePlaybackOverlay = null;
            nativePlaybackLoadingLogo = null;
            nativePlaybackTitle = null;
            nativePlaybackSubtitle = null;
            nativePlaybackStatus = null;
            nativePlaybackDownloadFallbackButton = null;
            nativePlaybackTime = null;
            nativePlaybackSpinner = null;
            nativePlaybackSeekBar = null;
            nativePlaybackPlayButton = null;
            nativePlaybackVolumeButton = null;
            nativePlaybackSubtitleButton = null;
            nativePlaybackAudioButton = null;
            nativePlaybackOrientationButton = null;
            nativePlaybackZoomButton = null;
            nativePlaybackGestureFeedback = null;
        }
        exitImmersivePlayback();
        playbackControlsVisible = true;
        playbackSubtitlesEnabled = false;
        playbackZoomEnabled = false;
        if (nativePlayerWebView != null) {
            nativePlayerWebView.setVisibility(View.VISIBLE);
            nativePlayerWebView.setBackgroundColor(Color.BLACK);
            nativePlayerWebView.setLayerType(View.LAYER_TYPE_NONE, null);
        }
        activeVideoFileId = 0;
        activeVideoFileSize = 0;
        activeVideoTitle = "Telegram video";
        playerIsLoading = true;
        playerEnded = false;
        playerError = null;
        streamErrorSent = false;
        streamBytesSent = 0;
        pendingStreamBytes.set(0);
        pendingStreamFileId = 0;
    }

    private void onTelegramVideoBytesRead(int fileId, long bytesRead) {
        if (activeVideoFileId != fileId || bytesRead <= 0) return;
        pendingStreamFileId = fileId;
        pendingStreamBytes.addAndGet(bytesRead);
        if (!streamUiUpdatePending.compareAndSet(false, true)) return;
        playerHandler.postDelayed(() -> {
            streamUiUpdatePending.set(false);
            long bytesReadSinceUpdate = pendingStreamBytes.getAndSet(0);
            if (activeVideoFileId != pendingStreamFileId || bytesReadSinceUpdate <= 0) return;
            streamBytesSent += bytesReadSinceUpdate;
            renderNativePlaybackUi();
        }, 250);
    }

    private String describePlaybackError(Throwable error) {
        StringBuilder message = new StringBuilder();
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            String detail = cause.getMessage();
            if (detail != null && !detail.trim().isEmpty()) {
                if (message.length() > 0) message.append(" — ");
                message.append(detail.trim());
            }
        }
        return message.length() == 0 ? error.getClass().getSimpleName() : message.toString();
    }

    @Override
    public void load() {
        super.load();
        activePlugin = this;
    }

    @PluginMethod
    public void importLocalVideo(PluginCall call) {
        String uriValue = call.getString("uri");
        Uri uri = uriValue == null ? null : Uri.parse(uriValue);
        if (uri == null || (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme()))) {
            call.reject("This local video could not be opened.");
            return;
        }

        importLocalVideoUri(call, uri);
    }

    @PluginMethod
    public void pickLocalVideo(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "localVideoPickerResult");
    }

    @ActivityCallback
    private void localVideoPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent resultIntent = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || resultIntent == null) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        Uri uri = resultIntent.getData();
        if (uri == null) {
            call.reject("The selected video could not be opened.");
            return;
        }
        importLocalVideoUri(call, uri);
    }

    private void importLocalVideoUri(PluginCall call, Uri uri) {
        new Thread(() -> {
            File copiedVideo = null;
            try {
                ContentResolver resolver = getContext().getContentResolver();
                String title = getLocalVideoTitle(resolver, uri);
                String mimeType = resolver.getType(uri);
                if (mimeType == null || !mimeType.toLowerCase(Locale.ROOT).startsWith("video/")) {
                    String extension = MimeTypeMap.getFileExtensionFromUrl(title);
                    mimeType = extension == null
                        ? null
                        : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(Locale.ROOT));
                }
                if (mimeType == null || !mimeType.toLowerCase(Locale.ROOT).startsWith("video/")) {
                    call.reject("The selected file is not a supported video.");
                    return;
                }

                String extension = MimeTypeMap.getFileExtensionFromUrl(title);
                if (extension == null || extension.isEmpty()) {
                    extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
                }
                if (extension == null || !extension.matches("[A-Za-z0-9]{1,10}")) extension = "mp4";

                File importDirectory = new File(getContext().getFilesDir(), "local-videos");
                if (!importDirectory.exists() && !importDirectory.mkdirs()) {
                    throw new IOException("Could not prepare temporary video storage.");
                }
                copiedVideo = File.createTempFile("amzy-video-", "." + extension, importDirectory);
                try (InputStream input = resolver.openInputStream(uri);
                     OutputStream output = new FileOutputStream(copiedVideo)) {
                    if (input == null) throw new IOException("Could not read the selected video.");
                    byte[] buffer = new byte[32 * 1024];
                    int bytesRead;
                    while ((bytesRead = input.read(buffer)) != -1) {
                        output.write(buffer, 0, bytesRead);
                    }
                }

                JSObject result = new JSObject();
                result.put("path", copiedVideo.getAbsolutePath());
                result.put("title", title);
                result.put("mimeType", mimeType);
                result.put("sourceUri", uri.toString());
                call.resolve(result);
            } catch (Exception error) {
                if (copiedVideo != null && copiedVideo.exists() && !copiedVideo.delete()) {
                    error.addSuppressed(new IOException("Could not remove the incomplete video copy."));
                }
                call.reject("Could not open the selected video.", error);
            }
        }, "amzy-import-local-video").start();
    }

    @PluginMethod
    public void getLocalVideoThumbnail(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("A local video path is required.");
            return;
        }

        new Thread(() -> {
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            Bitmap frame = null;
            Bitmap thumbnail = null;
            try {
                File importDirectory = new File(getContext().getFilesDir(), "local-videos").getCanonicalFile();
                File videoFile = new File(path).getCanonicalFile();
                if (!videoFile.getPath().startsWith(importDirectory.getPath() + File.separator)
                    || !videoFile.isFile()) {
                    call.reject("The local video is outside temporary video storage.");
                    return;
                }

                retriever.setDataSource(videoFile.getAbsolutePath());
                frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                if (frame == null) {
                    frame = retriever.getFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                }
                if (frame == null) {
                    call.reject("Could not create a thumbnail for this local video.");
                    return;
                }

                float scale = Math.min(1.0f, 480.0f / Math.max(frame.getWidth(), frame.getHeight()));
                thumbnail = scale < 1.0f
                    ? Bitmap.createScaledBitmap(
                        frame,
                        Math.max(1, Math.round(frame.getWidth() * scale)),
                        Math.max(1, Math.round(frame.getHeight() * scale)),
                        true
                    )
                    : frame;
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (!thumbnail.compress(Bitmap.CompressFormat.JPEG, 75, output)) {
                    throw new IOException("Could not encode the local video thumbnail.");
                }

                JSObject result = new JSObject();
                result.put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not create a thumbnail for this local video.", error);
            } finally {
                if (thumbnail != null && thumbnail != frame) thumbnail.recycle();
                if (frame != null) frame.recycle();
                try {
                    retriever.release();
                } catch (Exception error) {
                    android.util.Log.w("TelegramAuthPlugin", "Could not release local video thumbnail retriever.", error);
                }
            }
        }, "amzy-local-video-thumbnail").start();
    }

    @PluginMethod
    public void deleteLocalVideo(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("A local video path is required.");
            return;
        }
        try {
            File importDirectory = new File(getContext().getFilesDir(), "local-videos").getCanonicalFile();
            File videoFile = new File(path).getCanonicalFile();
            if (!videoFile.getPath().startsWith(importDirectory.getPath() + File.separator)) {
                call.reject("The local video is outside temporary video storage.");
                return;
            }
            if (videoFile.exists() && !videoFile.delete()) {
                call.reject("Could not remove the temporary video copy.");
                return;
            }
            call.resolve();
        } catch (IOException error) {
            call.reject("Could not remove the temporary video copy.", error);
        }
    }

    private String getLocalVideoTitle(ContentResolver resolver, Uri uri) throws Exception {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameColumn >= 0) {
                    String name = cursor.getString(nameColumn);
                    if (name != null && !name.trim().isEmpty()) return name;
                }
            }
        }
        String lastPathSegment = uri.getLastPathSegment();
        return lastPathSegment == null || lastPathSegment.trim().isEmpty() ? "Local video" : lastPathSegment;
    }

    @Override
    protected void handleOnDestroy() {
        releaseNativePlayer();
        if (activePlugin == this) activePlugin = null;
        super.handleOnDestroy();
    }

    private Client requireReadyClient(PluginCall call) {
        Client activeClient = client;
        if (activeClient == null || clientClosed || !STEP_READY.equals(authStep)) {
            call.reject("Log in to Telegram on this device before connecting a private group/channel.");
            return null;
        }
        return activeClient;
    }

    private boolean isTelegramInviteLink(String link) {
        return link.matches("(?i)^(?:https?://)?(?:www\\.)?(?:t\\.me|telegram\\.me)/(?:\\+[A-Za-z0-9_-]+|joinchat/[A-Za-z0-9_-]+)(?:\\?.*)?$");
    }

    private JSObject createChatReference(TdApi.Chat chat) {
        JSObject reference = new JSObject();
        reference.put("chatId", Long.toString(chat.id));
        boolean isChannel = chat.type instanceof TdApi.ChatTypeSupergroup
            && ((TdApi.ChatTypeSupergroup) chat.type).isChannel;
        String chatKind = isChannel ? "channel" : "group";
        reference.put("title", chat.title == null ? "Private Telegram " + chatKind : chat.title);
        reference.put("chatKind", chatKind);
        reference.put("isPublic", false);
        return reference;
    }

    private JSObject createVideoFeed(TdApi.Chat chat, TdApi.Message[] messages) {
        JSObject feed = createChatReference(chat);
        JSArray videos = new JSArray();
        if (messages != null) {
            for (TdApi.Message message : messages) {
                if (message != null && message.restrictionInfo != null
                    && message.restrictionInfo.hasSensitiveContent) {
                    feed.put("blockedBySensitiveContent", true);
                    feed.put("items", videos);
                    return feed;
                }
            }
        }
        if (messages != null) {
            for (TdApi.Message message : messages) {
                if (message == null || !message.canBeSaved || !(message.content instanceof TdApi.MessageVideo)) continue;
                TdApi.Video video = ((TdApi.MessageVideo) message.content).video;
                if (video == null || video.video == null || video.video.id <= 0) continue;

                String caption = ((TdApi.MessageVideo) message.content).caption == null
                    ? ""
                    : ((TdApi.MessageVideo) message.content).caption.text;
                JSObject item = new JSObject();
                item.put("id", Long.toString(message.id));
                item.put("fileId", video.video.id);
                item.put("fileSize", video.video.size > 0 ? video.video.size : video.video.expectedSize);
                item.put("mimeType", video.mimeType == null ? "video/mp4" : video.mimeType);
                item.put("supportsStreaming", video.supportsStreaming);
                item.put(
                    "thumbnailFileId",
                    video.thumbnail == null || video.thumbnail.file == null ? 0 : video.thumbnail.file.id
                );
                if (video.minithumbnail != null && video.minithumbnail.data != null && video.minithumbnail.data.length > 0) {
                    item.put("thumbnailData", Base64.encodeToString(video.minithumbnail.data, Base64.NO_WRAP));
                }
                item.put("title", caption.trim().isEmpty()
                    ? (video.fileName == null || video.fileName.trim().isEmpty() ? "Telegram video" : video.fileName)
                    : firstLine(caption));
                item.put("caption", caption);
                item.put("duration", formatDuration(video.duration));
                item.put("date", formatDate(message.date));
                item.put("canBeSaved", true);
                playableVideoFileIds.add(video.video.id);
                videos.put(item);
            }
        }
        feed.put("items", videos);
        return feed;
    }

    private String firstLine(String value) {
        String line = value.trim().split("\\R", 2)[0].trim();
        return line.length() > 60 ? line.substring(0, 57) + "..." : line;
    }

    private String formatDuration(int seconds) {
        return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
    }

    private String formatDate(int timestamp) {
        if (timestamp <= 0) return "";
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new java.util.Date(timestamp * 1000L));
    }

    private void ensureClient() throws Exception {
        synchronized (TelegramAuthPlugin.class) {
            activePlugin = this;
            if (client != null && !clientClosed) return;

            int apiId;
            try {
                apiId = Integer.parseInt(BuildConfig.TELEGRAM_API_ID);
            } catch (NumberFormatException error) {
                throw new IllegalStateException("Set telegram.apiId and telegram.apiHash in android/local.properties.");
            }
            String apiHash = BuildConfig.TELEGRAM_API_HASH.trim();
            if (apiId <= 0 || apiHash.isEmpty()) {
                throw new IllegalStateException("Set telegram.apiId and telegram.apiHash in android/local.properties.");
            }

            lastError = null;
            authStep = STEP_INITIALIZING;
            clientClosed = false;
            tdlibParametersSubmitted.set(false);
            client = Client.create(
                TelegramAuthPlugin::dispatchUpdate,
                TelegramAuthPlugin::dispatchError,
                TelegramAuthPlugin::dispatchError
            );
            try {
                Client.execute(new TdApi.SetLogVerbosityLevel(1));
            } catch (Client.ExecutionException error) {
                client = null;
                clientClosed = true;
                throw new IllegalStateException("Could not initialize Telegram TDLib.", error);
            }
        }
    }

    private static void dispatchUpdate(TdApi.Object update) {
        TelegramAuthPlugin plugin = activePlugin;
        if (plugin != null) plugin.handleUpdate(update);
    }

    private static void dispatchError(Throwable error) {
        TelegramAuthPlugin plugin = activePlugin;
        if (plugin != null) plugin.reportError(error);
    }

    private void handleUpdate(TdApi.Object update) {
        if (update instanceof TdApi.UpdateAuthorizationState) {
            handleAuthorizationState(((TdApi.UpdateAuthorizationState) update).authorizationState);
        } else if (update instanceof TdApi.UpdateUser) {
            TdApi.User user = ((TdApi.UpdateUser) update).user;
            TdApi.User activeUser = currentUser;
            if (activeUser != null && activeUser.id == user.id) {
                currentUser = user;
                publishAuthState();
            }
        } else if (update instanceof TdApi.UpdateFile) {
            TdApi.File file = ((TdApi.UpdateFile) update).file;
            if (file == null) return;
            VideoDownloadTask task = videoDownloadTasks.get(file.id);
            if (task == null || file.local == null) return;
            emitDownloadProgress(
                file.id,
                task.itemId,
                file.local.downloadedSize,
                file.size,
                "downloading",
                null
            );
        }
    }

    private void handleAuthorizationState(TdApi.AuthorizationState state) {
        if (state instanceof TdApi.AuthorizationStateWaitTdlibParameters) {
            if (!tdlibParametersSubmitted.compareAndSet(false, true)) return;
            try {
                int apiId = Integer.parseInt(BuildConfig.TELEGRAM_API_ID);
                String apiHash = BuildConfig.TELEGRAM_API_HASH.trim();
                File storageRoot = new File(getContext().getNoBackupFilesDir(), "telegram");
                File databaseDirectory = new File(storageRoot, "database");
                File filesDirectory = new File(storageRoot, "files");
                if ((!databaseDirectory.isDirectory() && !databaseDirectory.mkdirs())
                    || (!filesDirectory.isDirectory() && !filesDirectory.mkdirs())) {
                    throw new IOException("Could not create private Telegram storage.");
                }
                byte[] encryptionKey = getDatabaseEncryptionKey(storageRoot);
                String versionName = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0).versionName;
                Client activeClient = client;
                if (activeClient == null || clientClosed) {
                    tdlibParametersSubmitted.set(false);
                    return;
                }
                activeClient.send(new TdApi.SetTdlibParameters(
                    false,
                    databaseDirectory.getAbsolutePath(),
                    filesDirectory.getAbsolutePath(),
                    encryptionKey,
                    true,
                    true,
                    true,
                    false,
                    apiId,
                    apiHash,
                    Locale.getDefault().getLanguage(),
                    Build.MODEL,
                    Build.VERSION.RELEASE,
                    versionName == null ? "1.0" : versionName
                ), this::handleTdlibParametersResult);
            } catch (Exception error) {
                tdlibParametersSubmitted.set(false);
                authStep = STEP_LOGGED_OUT;
                reportError("Could not configure Telegram login: " + error.getMessage());
            }
            return;
        }

        if (state instanceof TdApi.AuthorizationStateWaitPhoneNumber) {
            authStep = STEP_PHONE;
            lastError = null;
        } else if (state instanceof TdApi.AuthorizationStateWaitCode) {
            authStep = STEP_CODE;
            lastError = null;
        } else if (state instanceof TdApi.AuthorizationStateWaitPassword) {
            authStep = STEP_PASSWORD;
            lastError = null;
        } else if (state instanceof TdApi.AuthorizationStateReady) {
            authStep = STEP_READY;
            lastError = null;
            client.send(new TdApi.GetMe(), result -> {
                if (result instanceof TdApi.User) {
                    currentUser = (TdApi.User) result;
                    publishAuthState();
                } else if (result instanceof TdApi.Error) {
                    reportError(((TdApi.Error) result).message);
                }
            });
        } else if (state instanceof TdApi.AuthorizationStateClosed) {
            privateVideoStreams.clear();
            playableVideoFileIds.clear();
            tdlibParametersSubmitted.set(false);
            clientClosed = true;
            client = null;
            currentUser = null;
            authStep = STEP_LOGGED_OUT;
            lastError = null;
        }
        publishAuthState();
    }

    private void sendRequest(PluginCall call, TdApi.Function<?> request) {
        Client activeClient = client;
        if (activeClient == null || clientClosed) {
            call.reject("Telegram is not ready. Start the login again.");
            return;
        }
        activeClient.send(request, result -> {
            if (result instanceof TdApi.Error) {
                call.reject(((TdApi.Error) result).message);
            } else {
                call.resolve();
            }
        });
    }

    private void handleTdlibParametersResult(TdApi.Object result) {
        if (result instanceof TdApi.Error && STEP_INITIALIZING.equals(authStep)) {
            reportError(((TdApi.Error) result).message);
        }
    }

    private void reportError(Throwable error) {
        reportError(error.getMessage());
    }

    private void reportError(String message) {
        if (message != null && message.toLowerCase(Locale.ROOT).contains("can't lock file")) {
            message = "Telegram storage is already open in another AMZY session. "
                + "Fully close AMZY on this device and reopen it. Your Telegram data is safe.";
        }
        lastError = message == null || message.trim().isEmpty()
            ? "Telegram login could not be completed."
            : message;
        publishAuthState();
    }

    private byte[] getDatabaseEncryptionKey(File storageRoot) throws IOException {
        File keyFile = new File(storageRoot, "database-key");
        if (keyFile.isFile()) {
            byte[] encodedKey = new byte[(int) keyFile.length()];
            try (java.io.FileInputStream input = new java.io.FileInputStream(keyFile)) {
                int offset = 0;
                while (offset < encodedKey.length) {
                    int bytesRead = input.read(encodedKey, offset, encodedKey.length - offset);
                    if (bytesRead < 0) {
                        throw new IOException("Could not read the Telegram database key.");
                    }
                    offset += bytesRead;
                }
            }
            return Base64.decode(new String(encodedKey, StandardCharsets.UTF_8), Base64.NO_WRAP);
        }

        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        byte[] encodedKey = Base64.encode(key, Base64.NO_WRAP);
        try (FileOutputStream output = new FileOutputStream(keyFile)) {
            output.write(encodedKey);
        }
        return key;
    }

    private JSObject createAuthState() {
        JSObject state = new JSObject();
        state.put("step", authStep);
        state.put("user", currentUser == null ? null : createUser(currentUser));
        state.put("error", lastError);
        return state;
    }

    private JSObject createUser(TdApi.User user) {
        JSObject result = new JSObject();
        String displayName = (user.firstName + " " + user.lastName).trim();
        result.put("uid", "telegram:" + user.id);
        result.put("displayName", displayName.isEmpty() ? "Telegram user" : displayName);
        result.put("photoURL", null);
        result.put(
            "username",
            user.usernames != null && user.usernames.activeUsernames.length > 0
                ? user.usernames.activeUsernames[0]
                : null
        );
        result.put("phoneNumber", user.phoneNumber.isEmpty() ? null : user.phoneNumber);
        return result;
    }

    private void publishAuthState() {
        notifyListeners("authStateChanged", createAuthState());
    }
}
