package com.twodayweekend.marketplace.nativeapp;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NativeMainActivity extends Activity {
    private static final int REQ_CAMERA_PHOTO = 100;
    private static final int REQ_LIVE_PERMISSION = 101;
    private static final int REQ_NOTIFY = 102;
    private static final int REQ_INSTALL = 103;
    private static final String CHANNEL_SYNC = "native_sync";
    private static final int COLOR_BACKGROUND = Color.rgb(243, 248, 246);
    private static final int COLOR_SURFACE = Color.WHITE;
    private static final int COLOR_INK = Color.rgb(18, 45, 50);
    private static final int COLOR_MUTED = Color.rgb(91, 111, 118);
    private static final int COLOR_BRAND = Color.rgb(17, 143, 128);
    private static final int COLOR_BRAND_DARK = Color.rgb(13, 81, 80);
    private static final int COLOR_CORAL = Color.rgb(255, 112, 88);
    private static final int COLOR_AMBER = Color.rgb(255, 195, 68);
    private static final int COLOR_BLUE = Color.rgb(38, 99, 178);
    private static final int COLOR_BORDER = Color.rgb(215, 231, 226);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<Button> navButtons = new ArrayList<>();
    private ServerApi api;
    private CredentialManager credentials;
    private LocalStore store;
    private LinearLayout content;
    private TextView status;
    private TextView actor;
    private TextView listingPhotoStatus;
    private ImageView listingPhotoPreview;
    private JSONArray latestProducts = new JSONArray();
    private String serverHealthText = "尚未检测";
    private String activeTab = "home";
    private Uri pendingPhotoUri;
    private String pendingPhotoPath = "";
    private String pendingPhotoDataUri = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        api = new ServerApi();
        credentials = new CredentialManager(this);
        store = new LocalStore(this);
        createNotificationChannel();
        setContentView(buildRoot());
        refreshIdentity();
        showHome();
        checkServerHealth();
        refreshMarketplace();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        store.close();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CAMERA_PHOTO) {
            if (resultCode == RESULT_OK && pendingPhotoUri != null) {
                executor.execute(() -> {
                    try {
                        pendingPhotoDataUri = imageDataUri(pendingPhotoUri);
                        runOnUiThread(() -> {
                            updateListingPhotoPreview();
                            postStatus("拍照完成，图片已加入上架草稿");
                        });
                    } catch (Exception error) {
                        pendingPhotoUri = null;
                        pendingPhotoDataUri = "";
                        runOnUiThread(() -> {
                            updateListingPhotoPreview();
                            postStatus("图片读取失败：" + error.getMessage());
                        });
                    }
                });
            } else {
                pendingPhotoUri = null;
                pendingPhotoPath = "";
                pendingPhotoDataUri = "";
                updateListingPhotoPreview();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA_PHOTO) {
            if (granted(grantResults)) openCameraForListing();
            else toast("未获得摄像头权限，无法拍照上传");
        } else if (requestCode == REQ_LIVE_PERMISSION) {
            if (granted(grantResults)) registerLiveSession();
            else toast("未获得摄像头/麦克风权限，无法开播");
        } else if (requestCode == REQ_NOTIFY) {
            toast(granted(grantResults) ? "后台通知已开启" : "未开启后台通知");
        }
    }

    private View buildRoot() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(COLOR_BACKGROUND);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(18), dp(18), dp(18), dp(14));
        header.setBackground(gradient(COLOR_BRAND_DARK, COLOR_BRAND, 0));
        TextView title = textColor("双休超市", 26, true, Color.WHITE);
        TextView subtitle = textColor("只上架双休不加班公司的产品", 14, true, Color.rgb(222, 255, 249));
        TextView principle = textColor("服务器确认、签名凭证、待同步队列都必须说清楚", 12, false, Color.rgb(203, 239, 235));
        status = chip("正在初始化", Color.argb(34, 255, 255, 255), Color.WHITE);
        actor = chip("actor: ...", Color.argb(26, 255, 255, 255), Color.rgb(223, 250, 247));
        header.addView(title);
        header.addView(subtitle);
        header.addView(principle);
        header.addView(status);
        header.addView(actor);
        root.addView(header);

        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setPadding(dp(10), dp(8), dp(10), dp(8));
        nav.setBackgroundColor(COLOR_SURFACE);
        addNav(nav, "home", "首页", this::showHome);
        addNav(nav, "listing", "上架", this::showListing);
        addNav(nav, "live", "直播", this::showLive);
        addNav(nav, "queue", "队列", this::showQueue);
        addNav(nav, "update", "更新", this::showUpdate);
        root.addView(nav);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(false);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(14), dp(14), dp(14), dp(32));
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1));
        return root;
    }

    private void addNav(LinearLayout nav, String key, String label, Runnable action) {
        Button button = new Button(this);
        button.setTag(key);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(13);
        button.setMinHeight(dp(42));
        button.setPadding(dp(6), 0, dp(6), 0);
        button.setOnClickListener(view -> action.run());
        navButtons.add(button);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(44), 1);
        params.setMargins(dp(3), 0, dp(3), 0);
        nav.addView(button, params);
    }

    private void showHome() {
        activeTab = "home";
        updateNavStyles();
        clear();
        heroPanel();
        statusGrid();
        Button health = outlineButton("检测服务器 IPv6 连通", COLOR_BRAND);
        health.setOnClickListener(view -> checkServerHealth());
        content.addView(health);
        Button refresh = button("刷新服务器商品");
        refresh.setOnClickListener(view -> refreshMarketplace());
        content.addView(refresh);
        renderProducts();
    }

    private void renderProducts() {
        addSection("服务器商品", "只展示服务器返回的真实商品，不用本地假数据冒充。");
        if (latestProducts.length() == 0) {
            card("暂无远端商品", "如果服务器不可达，这里不会展示本地假商品为服务器商品。");
            return;
        }
        for (int i = 0; i < Math.min(12, latestProducts.length()); i++) {
            JSONObject item = latestProducts.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("id", item.optString("productId", ""));
            String sellerId = item.optString("storeId", item.optString("sellerId", ""));
            String title = item.optString("title", "未命名商品");
            String detail = "商户 " + sellerId + "\n价格 " + item.optString("price", "") + "\n" + item.optString("description", "");
            LinearLayout row = productCard(item, title, detail);
            Button order = button("联系下单");
            order.setOnClickListener(view -> submitOrder(id));
            Button report = outlineButton("签名举报", COLOR_CORAL);
            report.setOnClickListener(view -> submitReport(id, sellerId));
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);
            LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(0, dp(44), 1);
            actionParams.setMargins(0, dp(10), dp(6), 0);
            actions.addView(order, actionParams);
            LinearLayout.LayoutParams reportParams = new LinearLayout.LayoutParams(0, dp(44), 1);
            reportParams.setMargins(dp(6), dp(10), 0, 0);
            actions.addView(report, reportParams);
            row.addView(actions);
        }
    }

    private void showListing() {
        activeTab = "listing";
        updateNavStyles();
        clear();
        addSection("上架商品", "拍照、填写详情、签名提交；服务器未确认时进入待同步队列。");
        card("上架原则", "商品信息属于普通商城数据，可补图和编辑；店家 ID、投诉、评价和治理动作才进入信誉账本。");
        EditText sellerId = input("商户 ID，例如 artisan-lab");
        EditText title = input("商品标题");
        EditText price = input("价格，单位元");
        EditText contact = input("联系方式");
        EditText description = input("商品详情");
        description.setMinLines(3);
        content.addView(sellerId);
        content.addView(title);
        content.addView(price);
        content.addView(contact);
        content.addView(description);

        listingPhotoPreview = new ImageView(this);
        listingPhotoPreview.setScaleType(ImageView.ScaleType.CENTER_CROP);
        listingPhotoPreview.setBackground(rounded(COLOR_BACKGROUND, 16, COLOR_BORDER, 1));
        LinearLayout.LayoutParams previewParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(168));
        previewParams.setMargins(0, dp(8), 0, dp(8));
        content.addView(listingPhotoPreview, previewParams);

        listingPhotoStatus = text("图片状态：未拍照", 13, false);
        listingPhotoStatus.setPadding(dp(2), 0, dp(2), dp(8));
        content.addView(listingPhotoStatus);
        updateListingPhotoPreview();

        Button camera = outlineButton("拍照上传商品图片", COLOR_BLUE);
        camera.setOnClickListener(view -> requestPhoto());
        content.addView(camera);

        Button submit = button("签名并提交上架");
        submit.setOnClickListener(view -> submitProduct(
                sellerId.getText().toString(),
                title.getText().toString(),
                price.getText().toString(),
                contact.getText().toString(),
                description.getText().toString()));
        content.addView(submit);
        card("状态说明", "只有服务器返回 2xx 才显示商品已上架。网络失败或服务器未确认时，动作会进入待同步队列。");
    }

    private void showLive() {
        activeTab = "live";
        updateNavStyles();
        clear();
        addSection("直播发现", "商户开播后登记发现信息，观众按商户索引进入直播。");
        card("当前版本策略", "原生版先做开播登记、摄像头/麦克风按需授权、信令发现和状态隔离。真正多人不卡顿直播后续应接入 WebRTC/SFU 原生库。");
        EditText sellerId = input("商户 ID");
        EditText title = input("直播标题");
        content.addView(sellerId);
        content.addView(title);
        Button start = button("申请权限并登记开播");
        start.setOnClickListener(view -> {
            liveSellerDraft = sellerId.getText().toString().trim();
            liveTitleDraft = title.getText().toString().trim();
            requestLivePermission();
        });
        content.addView(start);
        Button stop = outlineButton("结束当前商户直播登记", COLOR_CORAL);
        stop.setOnClickListener(view -> endLiveSession(sellerId.getText().toString().trim()));
        content.addView(stop);
    }

    private String liveSellerDraft = "";
    private String liveTitleDraft = "";

    private void showQueue() {
        activeTab = "queue";
        updateNavStyles();
        clear();
        addSection("队列与拒绝记录", "这里永久保留未确认和被拒绝的关键动作，网络恢复后可以重试。");
        List<LocalStore.PendingAction> actions = store.pendingActions();
        card("队列状态", store.pendingCount() + " 个动作等待服务器确认，"
                + store.rejectedCount() + " 个动作已被拒绝并保留记录。");
        Button sync = button("立即重试同步");
        sync.setOnClickListener(view -> syncPendingActions());
        content.addView(sync);
        for (LocalStore.PendingAction action : actions) {
            card(action.actionType + " · " + action.state, action.endpoint + "\n" + action.lastMessage);
        }
    }

    private void showUpdate() {
        activeTab = "update";
        updateNavStyles();
        clear();
        addSection("下载更新", "先拉取服务器下载信息，再校验 SHA256 和包名。");
        card("更新原则", "更新包必须来自服务器下载信息 API，并校验 SHA256 后才交给系统安装器。安装未知来源权限只在安装时申请。");
        Button check = button("检查 APK 更新");
        check.setOnClickListener(view -> checkUpdate());
        content.addView(check);
        Button notify = outlineButton("开启同步通知", COLOR_BLUE);
        notify.setOnClickListener(view -> requestNotificationPermission());
        content.addView(notify);
    }

    private void refreshIdentity() {
        executor.execute(() -> {
            try {
                String actorKey = credentials.actorKey();
                runOnUiThread(() -> actor.setText("actor: " + actorKey));
            } catch (Exception error) {
                runOnUiThread(() -> actor.setText("actor key 初始化失败：" + error.getMessage()));
            }
        });
    }

    private void refreshMarketplace() {
        status.setText("正在连接服务器...");
        executor.execute(() -> {
            ServerApi.ApiResult result = api.get("/marketplace");
            if (result.confirmed) {
                latestProducts = ServerApi.productsFromMarketplace(result.data);
            } else {
                latestProducts = new JSONArray();
            }
            runOnUiThread(() -> {
                status.setText(result.confirmed ? "服务器已确认 · 商品 " + latestProducts.length() : "服务器商品读取失败：" + shortMessage(result.message));
                showHome();
            });
        });
    }

    private void checkServerHealth() {
        status.setText("正在检测服务器 IPv6...");
        executor.execute(() -> {
            ServerApi.ApiResult result = api.getRoot("health");
            JSONObject ledger = result.data.optJSONObject("ledger");
            String text = result.confirmed
                    ? "已连通，账本事件 " + (ledger == null ? 0 : ledger.optInt("eventCount", 0))
                    : "未连通：" + shortMessage(result.message);
            runOnUiThread(() -> {
                serverHealthText = text;
                status.setText(text);
                showHome();
            });
        });
    }

    private void submitProduct(String sellerId, String title, String priceValue, String contact, String description) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("sellerId", sellerId.trim());
                body.put("title", title.trim());
                body.put("description", description.trim());
                body.put("category", "general");
                body.put("priceCents", Math.max(0, Math.round(Float.parseFloat(priceValue.trim()) * 100)));
                body.put("currency", "CNY");
                body.put("contact", contact.trim());
                JSONArray images = new JSONArray();
                if (!pendingPhotoDataUri.isEmpty()) images.put(pendingPhotoDataUri);
                body.put("images", images);
                sendSignedAction("product_create", "POST", "/products", sellerId.trim(), null, null, null, body);
            } catch (Exception error) {
                postStatus("上架草稿不完整：" + error.getMessage());
            }
        });
    }

    private void submitOrder(String productId) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("productId", productId);
                body.put("buyerKey", credentials.actorKey());
                body.put("buyerContact", "native-buyer-" + credentials.actorKey());
                body.put("buyerMessage", "我想联系购买该商品。");
                sendSignedAction("order_contact", "POST", "/orders", null, productId, null, null, body);
            } catch (Exception error) {
                postStatus("订单动作生成失败：" + error.getMessage());
            }
        });
    }

    private void submitReport(String productId, String sellerId) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("reporterKey", credentials.actorKey());
                body.put("reason", "原生端签名举报：请复核该商品是否符合双休企业规则。");
                sendSignedAction("removal_vote", "POST", "/products/" + enc(productId) + "/reports", sellerId, productId, null, null, body);
            } catch (Exception error) {
                postStatus("举报动作生成失败：" + error.getMessage());
            }
        });
    }

    private void registerLiveSession() {
        executor.execute(() -> {
            try {
                String sellerId = liveSellerDraft.isEmpty() ? credentials.actorKey() : liveSellerDraft;
                JSONObject body = new JSONObject();
                body.put("roomId", "native-room-" + sellerId);
                body.put("endpoint", new JSONObject().put("mode", "native-alpha").put("transport", "p2p-signaling"));
                body.put("candidates", new JSONArray());
                body.put("metadata", new JSONObject()
                        .put("title", liveTitleDraft.isEmpty() ? "双休商户直播" : liveTitleDraft)
                        .put("nativeApp", true)
                        .put("status", "media_engine_pending"));
                sendSignedAction("live_session_start", "PUT", "/live/sessions/" + enc(sellerId), sellerId, null, null, null, body);
            } catch (Exception error) {
                postStatus("直播登记失败：" + error.getMessage());
            }
        });
    }

    private void endLiveSession(String sellerId) {
        executor.execute(() -> {
            String id = sellerId == null || sellerId.trim().isEmpty() ? liveSellerDraft : sellerId.trim();
            ServerApi.ApiResult result = api.delete("/live/sessions/" + enc(id));
            postStatus(result.message);
        });
    }

    private void sendSignedAction(String actionType, String method, String endpoint,
                                  String targetSellerId, String targetProductId,
                                  String orderId, String stakeId, JSONObject body) throws Exception {
        String localId = "local_" + UUID.randomUUID().toString().replace("-", "");
        body.put("clientActionId", localId);
        body.remove("actionCredential");
        JSONObject signatureMeta = signatureMeta(targetSellerId, targetProductId, orderId, stakeId);
        ServerApi.ApiResult result = sendWithFreshChallenge(
                actionType,
                method,
                endpoint,
                targetSellerId,
                targetProductId,
                orderId,
                stakeId,
                body);

        if (result.confirmed) {
            postStatus("服务器已确认：" + actionType);
            notifySync("服务器已确认", actionType + " 已记录");
            refreshMarketplace();
            return;
        }
        if (isPermanentRejection(result)) {
            store.recordRejected(localId, actionType, method, endpoint, body, signatureMeta, result.message);
            postStatus("服务器明确拒绝：" + result.message);
            notifySync("请求被拒绝", actionType + " 未进入待同步");
            return;
        }
        store.enqueue(localId, actionType, method, endpoint, body, signatureMeta,
                "未获得服务器一次性 challenge，已保存未签名草稿：" + result.message);
        postStatus("未获服务器确认，已加入待同步：" + actionType);
        notifySync("动作待同步", actionType + " 等待服务器确认");
    }

    private void syncPendingActions() {
        executor.execute(() -> {
            List<LocalStore.PendingAction> actions = store.retryablePendingActions();
            int confirmed = 0;
            for (LocalStore.PendingAction action : actions) {
                try {
                    JSONObject body = new JSONObject(action.requestJson);
                    JSONObject meta = new JSONObject(action.credentialJson);
                    ServerApi.ApiResult result = sendWithFreshChallenge(
                            action.actionType,
                            action.method,
                            action.endpoint,
                            nullableString(meta, "targetSellerId"),
                            nullableString(meta, "targetProductId"),
                            nullableString(meta, "orderId"),
                            nullableString(meta, "stakeId"),
                            body);
                    if (result.confirmed) {
                        confirmed++;
                        store.markConfirmed(action.localId, result.data);
                    } else if (isPermanentRejection(result)) {
                        store.markRejected(action.localId, result.message);
                    } else {
                        store.markPending(action.localId, result.message);
                    }
                } catch (Exception error) {
                    store.markRejected(action.localId, "本地队列解析失败：" + error.getMessage());
                }
            }
            int finalConfirmed = confirmed;
            runOnUiThread(() -> {
                status.setText("同步完成，服务器确认 " + finalConfirmed + " 个，仍待同步 " + store.pendingCount() + " 个");
                showQueue();
            });
        });
    }

    private ServerApi.ApiResult sendWithFreshChallenge(String actionType, String method, String endpoint,
                                                       String targetSellerId, String targetProductId,
                                                       String orderId, String stakeId,
                                                       JSONObject unsignedBody) throws Exception {
        unsignedBody.remove("actionCredential");
        JSONObject challengeRequest = new JSONObject();
        challengeRequest.put("actorKey", credentials.actorKey());
        challengeRequest.put("actionType", actionType);
        putNullable(challengeRequest, "targetSellerId", targetSellerId);
        putNullable(challengeRequest, "targetProductId", targetProductId);
        putNullable(challengeRequest, "orderId", orderId);
        putNullable(challengeRequest, "stakeId", stakeId);

        ServerApi.ApiResult challenge = api.issueChallenge(challengeRequest);
        if (!challenge.confirmed) return challenge;
        String challengeId = challenge.data.optString("challengeId", "");
        String nonce = challenge.data.optString("nonce", "");
        if (challengeId.isEmpty() || nonce.isEmpty()) {
            return new ServerApi.ApiResult(false, 0, new JSONObject(), "服务器 challenge 响应不完整");
        }

        JSONObject signedBody = new JSONObject(unsignedBody.toString());
        JSONObject credential = credentials.actionCredential(
                actionType,
                targetSellerId,
                targetProductId,
                orderId,
                stakeId,
                challengeId,
                nonce,
                signedBody);
        signedBody.put("actionCredential", credential);
        if ("PUT".equals(method)) return api.put(endpoint, signedBody);
        return api.post(endpoint, signedBody);
    }

    private JSONObject signatureMeta(String targetSellerId, String targetProductId,
                                     String orderId, String stakeId) throws Exception {
        JSONObject meta = new JSONObject();
        putNullable(meta, "targetSellerId", targetSellerId);
        putNullable(meta, "targetProductId", targetProductId);
        putNullable(meta, "orderId", orderId);
        putNullable(meta, "stakeId", stakeId);
        return meta;
    }

    private void putNullable(JSONObject object, String key, String value) throws Exception {
        object.put(key, value == null ? JSONObject.NULL : value);
    }

    private String nullableString(JSONObject object, String key) {
        if (!object.has(key) || object.isNull(key)) return null;
        String value = object.optString(key, "");
        return value.isEmpty() ? null : value;
    }

    private boolean isPermanentRejection(ServerApi.ApiResult result) {
        if (result.status < 400 || result.status >= 500) return false;
        return result.status != 408 && result.status != 409 && result.status != 429;
    }

    private void requestPhoto() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PHOTO);
            return;
        }
        openCameraForListing();
    }

    private void openCameraForListing() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法创建图片目录");
            File file = File.createTempFile("listing_", ".jpg", dir);
            pendingPhotoPath = file.getAbsolutePath();
            pendingPhotoDataUri = "";
            pendingPhotoUri = FileProvider.getUriForFile(this, BuildConfig.APPLICATION_ID + ".fileprovider", file);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingPhotoUri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(intent, REQ_CAMERA_PHOTO);
        } catch (Exception error) {
            toast("无法打开相机：" + error.getMessage());
        }
    }

    private void requestLivePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean cameraMissing = checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED;
            boolean audioMissing = checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED;
            if (cameraMissing || audioMissing) {
                requestPermissions(new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, REQ_LIVE_PERMISSION);
                return;
            }
        }
        registerLiveSession();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
            return;
        }
        toast("后台通知已可用");
    }

    private void checkUpdate() {
        executor.execute(() -> {
            ServerApi.ApiResult result = api.get("/download");
            if (!result.confirmed) {
                postStatus(result.message);
                return;
            }
            JSONObject update = result.data.optJSONObject("update");
            JSONObject source = update == null ? result.data : update;
            int latest = source.optInt("latestVersionCode", result.data.optInt("versionCode", 0));
            String url = source.optString("apkUrl", result.data.optString("absoluteDownloadUrl", ""));
            String sha = source.optString("apkSha256", result.data.optString("sha256", ""));
            String packageName = source.optString("packageName", result.data.optString("packageName", ""));
            if (sha.isEmpty()) {
                postStatus("服务器未提供 APK SHA256，拒绝自动安装");
                return;
            }
            if (packageName.isEmpty()) {
                postStatus("服务器未标明原生版包名，暂不自动安装，避免误装旧 WebView APK");
                return;
            }
            if (!BuildConfig.APPLICATION_ID.equals(packageName)) {
                postStatus("更新包包名不匹配：" + packageName);
                return;
            }
            if (latest <= BuildConfig.VERSION_CODE || url.isEmpty()) {
                postStatus("当前已是最新原生版本或服务器未提供新版 APK");
                return;
            }
            runOnUiThread(() -> new AlertDialog.Builder(this)
                    .setTitle("发现更新")
                    .setMessage("服务器版本 " + latest + "\nSHA256: " + sha)
                    .setPositiveButton("下载校验", (dialog, which) -> downloadUpdate(url, sha))
                    .setNegativeButton("稍后", null)
                    .show());
        });
    }

    private void downloadUpdate(String url, String sha256) {
        executor.execute(() -> {
            try {
                byte[] bytes = api.download(url);
                String actual = CredentialManager.sha256Hex(bytes);
                if (!actual.equalsIgnoreCase(sha256)) {
                    postStatus("更新包 SHA256 校验失败：" + actual.substring(0, 12));
                    return;
                }
                File file = new File(getExternalFilesDir("Download"), "two-day-weekend-native-update.apk");
                try (FileOutputStream output = new FileOutputStream(file, false)) {
                    output.write(bytes);
                }
                if (!isExpectedApkPackage(file)) {
                    postStatus("更新包实际包名不匹配，已拒绝安装");
                    return;
                }
                runOnUiThread(() -> installApk(file));
            } catch (Exception error) {
                postStatus("下载更新失败：" + error.getMessage());
            }
        });
    }

    private boolean isExpectedApkPackage(File file) {
        PackageInfo info = getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
        return info != null && BuildConfig.APPLICATION_ID.equals(info.packageName);
    }

    private void installApk(File file) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            try {
                startActivityForResult(new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())), REQ_INSTALL);
            } catch (ActivityNotFoundException ignored) {
            }
            toast("请允许本应用安装更新包后再次点击更新");
            return;
        }
        Uri uri = FileProvider.getUriForFile(this, BuildConfig.APPLICATION_ID + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
    }

    private String imageDataUri(Uri uri) throws Exception {
        byte[] data;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("无法打开图片");
            data = readAll(input, 850 * 1024);
        }
        return "data:image/jpeg;base64," + android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
    }

    private byte[] readAll(InputStream input, int maxBytes) throws Exception {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > maxBytes) throw new IllegalStateException("图片太大，请重新拍摄或压缩后再上传");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_SYNC,
                    "双休超市同步",
                    NotificationManager.IMPORTANCE_DEFAULT);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void notifySync(String title, String message) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_SYNC)
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentTitle(title)
                .setContentText(message)
                .setAutoCancel(true);
        manager.notify((int) System.currentTimeMillis(), builder.build());
    }

    private void postStatus(String message) {
        runOnUiThread(() -> {
            status.setText(message);
            toast(message);
        });
    }

    private void clear() {
        content.removeAllViews();
    }

    private void updateNavStyles() {
        for (Button button : navButtons) {
            boolean selected = activeTab.equals(String.valueOf(button.getTag()));
            button.setTextColor(selected ? Color.WHITE : COLOR_MUTED);
            button.setTypeface(Typeface.DEFAULT, selected ? Typeface.BOLD : Typeface.NORMAL);
            button.setBackground(rounded(selected ? COLOR_BRAND : Color.TRANSPARENT, 14,
                    selected ? COLOR_BRAND : COLOR_BORDER, selected ? 0 : 1));
        }
    }

    private void heroPanel() {
        LinearLayout panel = surfaceCard();
        panel.setBackground(gradient(COLOR_BRAND_DARK, COLOR_BRAND, 20));
        panel.addView(textColor("双休不加班，也可以有好商品", 21, true, Color.WHITE));
        TextView body = textColor("这里支持按时下班的公司、员工和商户。商品可以自由上架，关键治理动作必须签名、可回溯、可复核。", 13, false, Color.rgb(225, 252, 248));
        body.setPadding(0, dp(8), 0, dp(10));
        panel.addView(body);

        LinearLayout chips = new LinearLayout(this);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        chips.addView(miniChip("服务器确认", COLOR_AMBER, COLOR_INK), new LinearLayout.LayoutParams(0, dp(34), 1));
        LinearLayout.LayoutParams mid = new LinearLayout.LayoutParams(0, dp(34), 1);
        mid.setMargins(dp(8), 0, dp(8), 0);
        chips.addView(miniChip("签名凭证", Color.WHITE, COLOR_BRAND_DARK), mid);
        chips.addView(miniChip("待同步留痕", COLOR_CORAL, Color.WHITE), new LinearLayout.LayoutParams(0, dp(34), 1));
        panel.addView(chips);
    }

    private void statusGrid() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        rowParams.setMargins(0, 0, 0, dp(10));
        content.addView(row, rowParams);

        row.addView(statusTile("IPv6 服务器", serverHealthText, COLOR_BRAND), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout.LayoutParams queueParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        queueParams.setMargins(dp(10), 0, 0, 0);
        row.addView(statusTile("本地队列", store.pendingCount() + " 待同步 / " + store.rejectedCount() + " 拒绝", COLOR_BLUE), queueParams);
    }

    private LinearLayout statusTile(String title, String body, int accent) {
        LinearLayout tile = new LinearLayout(this);
        tile.setOrientation(LinearLayout.VERTICAL);
        tile.setPadding(dp(12), dp(12), dp(12), dp(12));
        tile.setMinimumHeight(dp(112));
        tile.setBackground(rounded(COLOR_SURFACE, 16, COLOR_BORDER, 1));
        TextView dot = textColor("● " + title, 12, true, accent);
        TextView detail = textColor(body, 12, false, COLOR_MUTED);
        detail.setPadding(0, dp(7), 0, 0);
        tile.addView(dot);
        tile.addView(detail);
        return tile;
    }

    private void addSection(String label, String caption) {
        TextView view = text(label, 18, true);
        view.setPadding(dp(2), dp(14), dp(2), dp(2));
        content.addView(view);
        TextView captionView = textColor(caption, 12, false, COLOR_MUTED);
        captionView.setPadding(dp(2), 0, dp(2), dp(8));
        content.addView(captionView);
    }

    private LinearLayout card(String title, String body) {
        LinearLayout card = surfaceCard();
        card.addView(text(title, 16, true));
        TextView bodyView = textColor(body, 13, false, COLOR_MUTED);
        bodyView.setPadding(0, dp(7), 0, 0);
        card.addView(bodyView);
        return card;
    }

    private LinearLayout productCard(JSONObject item, String title, String body) {
        LinearLayout card = surfaceCard();
        String cover = productCover(item);
        if (!cover.isEmpty()) {
            ImageView image = imageBox(dp(150));
            setImageSource(image, cover);
            card.addView(image);
        }
        TextView titleView = text(title, 17, true);
        titleView.setPadding(0, dp(cover.isEmpty() ? 0 : 10), 0, 0);
        card.addView(titleView);
        TextView bodyView = textColor(body, 13, false, COLOR_MUTED);
        bodyView.setPadding(0, dp(6), 0, 0);
        card.addView(bodyView);

        LinearLayout chips = new LinearLayout(this);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        chips.setPadding(0, dp(10), 0, 0);
        chips.addView(miniChip("服务器商品", COLOR_BRAND, Color.WHITE), new LinearLayout.LayoutParams(0, dp(32), 1));
        LinearLayout.LayoutParams sellerParams = new LinearLayout.LayoutParams(0, dp(32), 1);
        sellerParams.setMargins(dp(8), 0, 0, 0);
        chips.addView(miniChip("可签名治理", COLOR_AMBER, COLOR_INK), sellerParams);
        card.addView(chips);
        return card;
    }

    private LinearLayout surfaceCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(15), dp(14), dp(15), dp(14));
        card.setBackground(rounded(COLOR_SURFACE, 18, COLOR_BORDER, 1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(10));
        content.addView(card, params);
        return card;
    }

    private String productCover(JSONObject item) {
        String direct = item.optString("image", "");
        if (isImageSource(direct)) return direct.trim();
        JSONArray images = item.optJSONArray("images");
        if (images == null) return "";
        for (int i = 0; i < images.length(); i++) {
            String value = images.optString(i, "");
            if (isImageSource(value)) return value.trim();
        }
        return "";
    }

    private boolean isImageSource(String value) {
        if (value == null) return false;
        String text = value.trim().toLowerCase(Locale.ROOT);
        return text.startsWith("data:image/") || text.startsWith("http://") || text.startsWith("https://");
    }

    private ImageView imageBox(int height) {
        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setBackground(rounded(COLOR_BACKGROUND, 16, COLOR_BORDER, 1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                height);
        params.setMargins(0, 0, 0, dp(2));
        image.setLayoutParams(params);
        return image;
    }

    private void setImageSource(ImageView image, String source) {
        if (image == null || source == null || source.trim().isEmpty()) return;
        String normalized = source.trim();
        image.setTag(normalized);
        image.setImageDrawable(null);
        if (normalized.toLowerCase(Locale.ROOT).startsWith("data:image/")) {
            Bitmap bitmap = decodeImageSource(normalized);
            if (bitmap != null) image.setImageBitmap(bitmap);
            return;
        }
        executor.execute(() -> {
            try {
                byte[] data = api.download(normalized);
                Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length);
                runOnUiThread(() -> {
                    if (normalized.equals(image.getTag()) && bitmap != null) image.setImageBitmap(bitmap);
                });
            } catch (Exception ignored) {
                runOnUiThread(() -> {
                    if (normalized.equals(image.getTag())) image.setImageDrawable(null);
                });
            }
        });
    }

    private Bitmap decodeImageSource(String source) {
        int comma = source.indexOf(',');
        if (comma < 0) return null;
        try {
            byte[] data = android.util.Base64.decode(source.substring(comma + 1), android.util.Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(data, 0, data.length);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void updateListingPhotoPreview() {
        if (listingPhotoStatus == null || listingPhotoPreview == null) return;
        if (pendingPhotoDataUri.isEmpty()) {
            listingPhotoStatus.setText("图片状态：未拍照。点击下方按钮后才会申请摄像头权限。");
            listingPhotoPreview.setImageDrawable(null);
            listingPhotoPreview.setBackground(rounded(COLOR_BACKGROUND, 16, COLOR_BORDER, 1));
            return;
        }
        listingPhotoStatus.setText("图片状态：已拍照，提交时会随商品一起上传。");
        setImageSource(listingPhotoPreview, pendingPhotoDataUri);
    }

    private TextView text(String value, int sp, boolean bold) {
        return textColor(value, sp, bold, COLOR_INK);
    }

    private TextView textColor(String value, int sp, boolean bold, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setGravity(Gravity.START);
        view.setIncludeFontPadding(true);
        view.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        view.setLineSpacing(0, 1.12f);
        return view;
    }

    private TextView chip(String value, int background, int textColor) {
        TextView view = textColor(value, 12, false, textColor);
        view.setPadding(dp(10), dp(7), dp(10), dp(7));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(9), 0, 0);
        view.setLayoutParams(params);
        view.setBackground(rounded(background, 14, Color.argb(30, 255, 255, 255), 1));
        return view;
    }

    private TextView miniChip(String value, int background, int textColor) {
        TextView view = textColor(value, 12, true, textColor);
        view.setGravity(Gravity.CENTER);
        view.setSingleLine(true);
        view.setPadding(dp(5), 0, dp(5), 0);
        view.setBackground(rounded(background, 17, Color.TRANSPARENT, 0));
        return view;
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(false);
        input.setMinLines(1);
        input.setTextSize(14);
        input.setTextColor(COLOR_INK);
        input.setHintTextColor(Color.rgb(124, 143, 148));
        input.setPadding(dp(12), dp(9), dp(12), dp(9));
        input.setBackground(rounded(COLOR_SURFACE, 14, COLOR_BORDER, 1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(9));
        input.setLayoutParams(params);
        return input;
    }

    private Button button(String label) {
        return styledButton(label, COLOR_BRAND, Color.WHITE, COLOR_BRAND);
    }

    private Button outlineButton(String label, int color) {
        return styledButton(label, COLOR_SURFACE, color, color);
    }

    private Button styledButton(String label, int background, int textColor, int strokeColor) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setTextColor(textColor);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setMinHeight(dp(48));
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setBackground(rounded(background, 14, strokeColor, background == strokeColor ? 0 : 1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48));
        params.setMargins(0, dp(2), 0, dp(10));
        button.setLayoutParams(params);
        return button;
    }

    private GradientDrawable rounded(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(strokeDp), strokeColor);
        return drawable;
    }

    private GradientDrawable gradient(int start, int end, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{start, end});
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private boolean granted(int[] results) {
        if (results.length == 0) return false;
        for (int result : results) if (result != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String shortMessage(String value) {
        if (value == null || value.trim().isEmpty()) return "未知错误";
        String compact = value.replace('\n', ' ').replace('\r', ' ').trim();
        return compact.length() > 72 ? compact.substring(0, 72) + "..." : compact;
    }

    private void toast(String value) {
        Toast.makeText(this, value, Toast.LENGTH_SHORT).show();
    }

    private static String enc(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }
}
