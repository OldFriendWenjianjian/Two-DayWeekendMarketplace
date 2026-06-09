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
import android.graphics.Color;
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

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private ServerApi api;
    private CredentialManager credentials;
    private LocalStore store;
    private LinearLayout content;
    private TextView status;
    private TextView actor;
    private JSONArray latestProducts = new JSONArray();
    private String serverHealthText = "尚未检测";
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
                        postStatus("拍照完成，图片已加入上架草稿");
                    } catch (Exception error) {
                        pendingPhotoUri = null;
                        pendingPhotoDataUri = "";
                        postStatus("图片读取失败：" + error.getMessage());
                    }
                });
            } else {
                pendingPhotoUri = null;
                pendingPhotoPath = "";
                pendingPhotoDataUri = "";
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
        root.setBackgroundColor(Color.rgb(248, 251, 249));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(16), dp(14), dp(16), dp(10));
        header.setBackgroundColor(Color.WHITE);
        TextView title = text("双休超市", 22, true);
        TextView subtitle = text("关键动作必须区分：服务器确认 / 待同步 / 本地演示", 13, false);
        status = text("正在初始化", 13, false);
        actor = text("actor: ...", 12, false);
        header.addView(title);
        header.addView(subtitle);
        header.addView(status);
        header.addView(actor);
        root.addView(header);

        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setPadding(dp(8), dp(8), dp(8), dp(8));
        nav.setBackgroundColor(Color.WHITE);
        addNav(nav, "首页", this::showHome);
        addNav(nav, "上架", this::showListing);
        addNav(nav, "直播", this::showLive);
        addNav(nav, "队列", this::showQueue);
        addNav(nav, "更新", this::showUpdate);
        root.addView(nav);

        ScrollView scroll = new ScrollView(this);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(12), dp(12), dp(12), dp(32));
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1));
        return root;
    }

    private void addNav(LinearLayout nav, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        nav.addView(button, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    }

    private void showHome() {
        clear();
        card("理念", "只上架双休不加班公司的产品。原生版会把关键动作签名后提交，服务器未确认时只显示待同步，不伪装成功。");
        card("服务器 IPv6 连通", serverHealthText + "\n" + ServerApi.ROOT_URL);
        Button health = button("检测服务器 IPv6 连通");
        health.setOnClickListener(view -> checkServerHealth());
        content.addView(health);
        Button refresh = button("刷新服务器商品");
        refresh.setOnClickListener(view -> refreshMarketplace());
        content.addView(refresh);
        renderProducts();
    }

    private void renderProducts() {
        addSection("服务器商品");
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
            LinearLayout row = card(title, detail);
            Button order = button("联系下单");
            order.setOnClickListener(view -> submitOrder(id));
            Button report = button("签名举报");
            report.setOnClickListener(view -> submitReport(id, sellerId));
            row.addView(order);
            row.addView(report);
        }
    }

    private void showListing() {
        clear();
        addSection("原生上架商品");
        EditText sellerId = input("商户 ID，例如 artisan-lab");
        EditText title = input("商品标题");
        EditText price = input("价格，单位元");
        EditText contact = input("联系方式");
        EditText description = input("商品详情");
        content.addView(sellerId);
        content.addView(title);
        content.addView(price);
        content.addView(contact);
        content.addView(description);

        Button camera = button("拍照上传商品图片");
        camera.setOnClickListener(view -> requestPhoto());
        content.addView(camera);

        TextView photoStatus = text("图片状态：" + (pendingPhotoDataUri.isEmpty() ? "未拍照" : "已拍照，提交时会上传为 data:image/jpeg"), 13, false);
        content.addView(photoStatus);

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
        clear();
        addSection("原生直播入口");
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
        Button stop = button("结束当前商户直播登记");
        stop.setOnClickListener(view -> endLiveSession(sellerId.getText().toString().trim()));
        content.addView(stop);
    }

    private String liveSellerDraft = "";
    private String liveTitleDraft = "";

    private void showQueue() {
        clear();
        addSection("队列与拒绝记录");
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
        clear();
        addSection("下载更新");
        card("更新原则", "更新包必须来自服务器下载信息 API，并校验 SHA256 后才交给系统安装器。安装未知来源权限只在安装时申请。");
        Button check = button("检查 APK 更新");
        check.setOnClickListener(view -> checkUpdate());
        content.addView(check);
        Button notify = button("开启同步通知");
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
                status.setText(result.confirmed ? "服务器已确认 · 商品 " + latestProducts.length() : "服务器商品读取失败：" + result.message);
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
                    : "未连通，手机当前网络无法访问服务器 IPv6：" + result.message;
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

    private void addSection(String label) {
        TextView view = text(label, 18, true);
        view.setPadding(0, dp(12), 0, dp(8));
        content.addView(view);
    }

    private LinearLayout card(String title, String body) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        card.setBackgroundColor(Color.WHITE);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(10));
        content.addView(card, params);
        card.addView(text(title, 16, true));
        TextView bodyView = text(body, 13, false);
        bodyView.setPadding(0, dp(6), 0, 0);
        card.addView(bodyView);
        return card;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(Color.rgb(23, 51, 48));
        view.setGravity(Gravity.START);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        view.setLineSpacing(0, 1.08f);
        return view;
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(false);
        input.setMinLines(1);
        input.setTextSize(14);
        return input;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        return button;
    }

    private boolean granted(int[] results) {
        if (results.length == 0) return false;
        for (int result : results) if (result != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(String value) {
        Toast.makeText(this, value, Toast.LENGTH_SHORT).show();
    }

    private static String enc(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }
}
