package com.twodayweekend.marketplace;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String DEFAULT_REMOTE_URL =
            "http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/";
    private static final String LOCAL_FALLBACK_URL = "file:///android_asset/www/index.html";
    private static final String EXTRA_START_URL = "start_url";

    private static final int REQUEST_CAMERA_CAPTURE_PERMISSION = 1001;
    private static final int REQUEST_FILE_CHOOSER = 1002;
    private static final int REQUEST_WEBRTC_PERMISSIONS = 1003;

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraCaptureUri;
    private PermissionRequest pendingWebPermissionRequest;
    private Intent pendingFileChooserIntent;
    private boolean localFallbackLoaded;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebViewDebugging();
        setContentView(createContentView());
        configureWebView();

        if (savedInstanceState == null) {
            webView.loadUrl(resolveStartUrl());
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) {
                parent.removeView(webView);
            }
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILE_CHOOSER) {
            return;
        }

        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            results = parseFileChooserResult(data);
        }

        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
        cameraCaptureUri = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_WEBRTC_PERMISSIONS && pendingWebPermissionRequest != null) {
            if (allPermissionsGranted(grantResults)) {
                pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
            } else {
                pendingWebPermissionRequest.deny();
            }
            pendingWebPermissionRequest = null;
            return;
        }

        if (requestCode == REQUEST_CAMERA_CAPTURE_PERMISSION && filePathCallback != null) {
            Intent chooser = pendingFileChooserIntent;
            pendingFileChooserIntent = null;
            if (allPermissionsGranted(grantResults) && chooser != null) {
                Intent cameraIntent = createCameraIntent();
                chooser.putExtra(
                        Intent.EXTRA_INITIAL_INTENTS,
                        cameraIntent == null ? new Intent[0] : new Intent[]{cameraIntent});
                openFileChooser(chooser);
            } else if (chooser != null) {
                openFileChooser(chooser);
            } else {
                filePathCallback.onReceiveValue(null);
                filePathCallback = null;
            }
        }
    }

    private View createContentView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dpToPx(3));
        progressBar.setLayoutParams(progressParams);
        root.addView(progressBar);

        return root;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(isNetworkAvailable() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new MarketplaceWebViewClient());
        webView.setWebChromeClient(new MarketplaceWebChromeClient());
    }

    private void configureWebViewDebugging() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }

    private String resolveStartUrl() {
        Uri dataUri = getIntent().getData();
        if (isSupportedUrl(dataUri)) {
            return dataUri.toString();
        }

        String extraUrl = getIntent().getStringExtra(EXTRA_START_URL);
        if (extraUrl != null && isSupportedUrl(Uri.parse(extraUrl))) {
            return extraUrl;
        }

        return DEFAULT_REMOTE_URL;
    }

    private boolean isSupportedUrl(Uri uri) {
        if (uri == null || uri.getScheme() == null) {
            return false;
        }
        String scheme = uri.getScheme().toLowerCase(Locale.US);
        return "http".equals(scheme) || "https".equals(scheme) || "file".equals(scheme);
    }

    private boolean hasWebRtcRuntimePermissions(PermissionRequest request) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }

        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void requestWebRtcRuntimePermissions(PermissionRequest request) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            request.grant(request.getResources());
            return;
        }

        List<String> missing = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.CAMERA);
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.RECORD_AUDIO);
            }
        }

        if (missing.isEmpty()) {
            request.grant(request.getResources());
            return;
        }

        pendingWebPermissionRequest = request;
        requestPermissions(missing.toArray(new String[0]), REQUEST_WEBRTC_PERMISSIONS);
    }

    private boolean allPermissionsGranted(int[] grantResults) {
        if (grantResults.length == 0) {
            return false;
        }
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private Uri[] parseFileChooserResult(Intent data) {
        if ((data == null || data.getData() == null) && cameraCaptureUri != null) {
            return new Uri[]{cameraCaptureUri};
        }

        if (data == null) {
            return null;
        }

        ClipData clipData = data.getClipData();
        if (clipData != null) {
            Uri[] uris = new Uri[clipData.getItemCount()];
            for (int i = 0; i < clipData.getItemCount(); i++) {
                uris[i] = clipData.getItemAt(i).getUri();
            }
            return uris;
        }

        Uri uri = data.getData();
        return uri == null ? null : new Uri[]{uri};
    }

    private Intent createCameraIntent() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return null;
        }

        Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (cameraIntent.resolveActivity(getPackageManager()) == null) {
            return null;
        }

        try {
            File imageFile = createImageFile();
            cameraCaptureUri = FileProvider.getUriForFile(
                    this,
                    BuildConfig.APPLICATION_ID + ".fileprovider",
                    imageFile);
            cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraCaptureUri);
            cameraIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return cameraIntent;
        } catch (IOException exception) {
            cameraCaptureUri = null;
            return null;
        }
    }

    private File createImageFile() throws IOException {
        String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        File storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        return File.createTempFile("marketplace_" + timestamp + "_", ".jpg", storageDir);
    }

    private void openFileChooser(Intent chooserIntent) {
        try {
            startActivityForResult(chooserIntent, REQUEST_FILE_CHOOSER);
        } catch (ActivityNotFoundException exception) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
                filePathCallback = null;
            }
            Toast.makeText(this, R.string.no_file_picker, Toast.LENGTH_SHORT).show();
        }
    }

    private boolean shouldRequestCameraForFileChooser(WebChromeClient.FileChooserParams params) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && params.isCaptureEnabled()
                && acceptsImage(params)
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED;
    }

    private boolean acceptsImage(WebChromeClient.FileChooserParams params) {
        String[] acceptTypes = params.getAcceptTypes();
        if (acceptTypes == null || acceptTypes.length == 0) {
            return true;
        }
        for (String type : acceptTypes) {
            if (type == null || type.isEmpty() || type.startsWith("image/")) {
                return true;
            }
        }
        return false;
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) {
            return false;
        }
        NetworkInfo info = manager.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private void loadLocalFallback() {
        if (localFallbackLoaded) {
            return;
        }
        localFallbackLoaded = true;
        webView.loadUrl(LOCAL_FALLBACK_URL);
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private class MarketplaceWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isSupportedUrl(uri)) {
                return false;
            }

            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException ignored) {
                return true;
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && request.isForMainFrame()) {
                loadLocalFallback();
            }
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            super.onReceivedError(view, errorCode, description, failingUrl);
            loadLocalFallback();
        }
    }

    private class MarketplaceWebChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> callback,
                FileChooserParams fileChooserParams) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;

            Intent contentIntent = fileChooserParams.createIntent();
            contentIntent.addCategory(Intent.CATEGORY_OPENABLE);

            Intent cameraIntent = createCameraIntent();
            Intent[] initialIntents = cameraIntent == null ? new Intent[0] : new Intent[]{cameraIntent};
            Intent chooser = new Intent(Intent.ACTION_CHOOSER);
            chooser.putExtra(Intent.EXTRA_INTENT, contentIntent);
            chooser.putExtra(Intent.EXTRA_TITLE, getString(R.string.file_chooser_title));
            if (shouldRequestCameraForFileChooser(fileChooserParams)) {
                pendingFileChooserIntent = chooser;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA_CAPTURE_PERMISSION);
                return true;
            }
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, initialIntents);
            openFileChooser(chooser);
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (hasWebRtcRuntimePermissions(request)) {
                    request.grant(request.getResources());
                } else {
                    requestWebRtcRuntimePermissions(request);
                }
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingWebPermissionRequest == request) {
                pendingWebPermissionRequest = null;
            }
        }
    }
}
