package com.twodayweekend.marketplace.nativeapp;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ServerApi {
    static final String ROOT_URL =
            "http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/";
    static final String API_BASE = ROOT_URL + "api";

    ApiResult get(String path) {
        return request("GET", path, null);
    }

    ApiResult getRoot(String path) {
        return requestAbsolute("GET", ROOT_URL + path, null);
    }

    ApiResult post(String path, JSONObject body) {
        return request("POST", path, body);
    }

    ApiResult put(String path, JSONObject body) {
        return request("PUT", path, body);
    }

    ApiResult issueChallenge(JSONObject body) {
        return post("/action-challenges", body);
    }

    ApiResult delete(String path) {
        return request("DELETE", path, null);
    }

    ApiResult request(String method, String path, JSONObject body) {
        return requestAbsolute(method, API_BASE + path, body);
    }

    ApiResult requestAbsolute(String method, String absoluteUrl, JSONObject body) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(absoluteUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(12000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String text = stream == null ? "" : readText(stream);
            JSONObject data = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            return new ApiResult(status >= 200 && status < 300, status, data, statusMessage(status, data));
        } catch (IOException | JSONException error) {
            return new ApiResult(false, 0, new JSONObject(), "服务器不可达：" + error.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    byte[] download(String absoluteUrl) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(absoluteUrl).openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(30000);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("HTTP " + status);
            }
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                return output.toByteArray();
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static String readText(InputStream stream) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    static JSONArray productsFromMarketplace(JSONObject payload) {
        JSONArray products = payload.optJSONArray("products");
        return products == null ? new JSONArray() : products;
    }

    private static String statusMessage(int status, JSONObject data) {
        if (status >= 200 && status < 300) return "服务器已确认";
        String error = data.optString("error", "");
        return error.isEmpty() ? "服务器拒绝：HTTP " + status : "服务器拒绝：" + error;
    }

    static final class ApiResult {
        final boolean confirmed;
        final int status;
        final JSONObject data;
        final String message;

        ApiResult(boolean confirmed, int status, JSONObject data, String message) {
            this.confirmed = confirmed;
            this.status = status;
            this.data = data;
            this.message = message;
        }
    }
}
