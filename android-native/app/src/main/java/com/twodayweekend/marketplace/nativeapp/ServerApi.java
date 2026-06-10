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
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.util.Arrays;
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
        String currentUrl = absoluteUrl;
        String currentMethod = method;
        JSONObject currentBody = body;
        for (int redirects = 0; redirects <= 4; redirects++) {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(currentUrl);
                if ("http".equalsIgnoreCase(url.getProtocol())) {
                    RawHttpResponse response = rawHttp(currentMethod, url, currentBody);
                    if (isRedirect(response.status)) {
                        if (response.location == null || response.location.trim().isEmpty()) {
                            return new ApiResult(false, response.status, new JSONObject(), "服务器重定向但缺少 Location");
                        }
                        currentUrl = new URL(url, response.location).toString();
                        if (response.status == HttpURLConnection.HTTP_SEE_OTHER) {
                            currentMethod = "GET";
                            currentBody = null;
                        }
                        continue;
                    }
                    String text = response.body.length == 0
                            ? ""
                            : new String(response.body, StandardCharsets.UTF_8);
                    JSONObject data = text.isEmpty() ? new JSONObject() : new JSONObject(text);
                    return new ApiResult(response.status >= 200 && response.status < 300,
                            response.status,
                            data,
                            statusMessage(response.status, data));
                }
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(12000);
                connection.setRequestMethod(currentMethod);
                prepareConnection(connection);
                if (currentBody != null) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    byte[] payload = currentBody.toString().getBytes(StandardCharsets.UTF_8);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(payload);
                    }
                }
                int status = connection.getResponseCode();
                if (isRedirect(status)) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) {
                        return new ApiResult(false, status, new JSONObject(), "服务器重定向但缺少 Location");
                    }
                    currentUrl = new URL(url, location).toString();
                    if (status == HttpURLConnection.HTTP_SEE_OTHER) {
                        currentMethod = "GET";
                        currentBody = null;
                    }
                    continue;
                }
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
        return new ApiResult(false, 0, new JSONObject(), "服务器重定向次数过多");
    }

    private static boolean isRedirect(int status) {
        return status == HttpURLConnection.HTTP_MOVED_PERM
                || status == HttpURLConnection.HTTP_MOVED_TEMP
                || status == HttpURLConnection.HTTP_SEE_OTHER
                || status == 307
                || status == 308;
    }

    byte[] download(String absoluteUrl) throws IOException {
        String currentUrl = absoluteUrl;
        for (int redirects = 0; redirects <= 4; redirects++) {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(currentUrl);
                if ("http".equalsIgnoreCase(url.getProtocol())) {
                    RawHttpResponse response = rawHttp("GET", url, null);
                    if (isRedirect(response.status)) {
                        if (response.location == null || response.location.trim().isEmpty()) {
                            throw new IOException("Redirect missing Location");
                        }
                        currentUrl = new URL(url, response.location).toString();
                        continue;
                    }
                    if (response.status < 200 || response.status >= 300) {
                        throw new IOException("HTTP " + response.status);
                    }
                    return response.body;
                }
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(30000);
                prepareConnection(connection);
                int status = connection.getResponseCode();
                if (isRedirect(status)) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) {
                        throw new IOException("Redirect missing Location");
                    }
                    currentUrl = new URL(url, location).toString();
                    continue;
                }
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
        throw new IOException("Too many redirects");
    }

    private static void prepareConnection(HttpURLConnection connection) {
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Connection", "close");
        connection.setRequestProperty("User-Agent", "curl/8.12.1");
    }

    private static RawHttpResponse rawHttp(String method, URL url, JSONObject body) throws IOException {
        int port = url.getPort() > 0 ? url.getPort() : 80;
        String host = url.getHost();
        String connectHost = host;
        if (connectHost.startsWith("[") && connectHost.endsWith("]")) {
            connectHost = connectHost.substring(1, connectHost.length() - 1);
        }
        String hostHeader = host.startsWith("[") ? host : (host.contains(":") ? "[" + host + "]" : host);
        if (url.getPort() > 0 && url.getPort() != 80) hostHeader += ":" + url.getPort();
        String path = url.getFile();
        if (path == null || path.isEmpty()) path = "/";
        byte[] payload = body == null ? new byte[0] : body.toString().getBytes(StandardCharsets.UTF_8);

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(connectHost, port), 6000);
            socket.setSoTimeout(30000);
            OutputStream output = socket.getOutputStream();
            StringBuilder request = new StringBuilder();
            request.append(method).append(' ').append(path).append(" HTTP/1.1\r\n");
            request.append("Host: ").append(hostHeader).append("\r\n");
            request.append("Accept: application/json\r\n");
            request.append("Accept-Encoding: identity\r\n");
            request.append("Connection: close\r\n");
            request.append("User-Agent: curl/8.12.1\r\n");
            if (payload.length > 0) {
                request.append("Content-Type: application/json; charset=utf-8\r\n");
                request.append("Content-Length: ").append(payload.length).append("\r\n");
            }
            request.append("\r\n");
            output.write(request.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (payload.length > 0) output.write(payload);
            output.flush();

            byte[] raw = readAllBytes(socket.getInputStream());
            int headerEnd = findHeaderEnd(raw);
            if (headerEnd < 0) throw new IOException("Invalid HTTP response");
            String headerText = new String(raw, 0, headerEnd, StandardCharsets.ISO_8859_1);
            String[] lines = headerText.split("\r\n");
            if (lines.length == 0 || !lines[0].startsWith("HTTP/")) {
                throw new IOException("Invalid HTTP status");
            }
            String[] parts = lines[0].split(" ", 3);
            if (parts.length < 2) throw new IOException("Invalid HTTP status");
            int status = Integer.parseInt(parts[1]);
            String location = headerValue(lines, "Location");
            byte[] responseBody = Arrays.copyOfRange(raw, headerEnd + 4, raw.length);
            String transferEncoding = headerValue(lines, "Transfer-Encoding");
            if (transferEncoding != null && transferEncoding.toLowerCase().contains("chunked")) {
                responseBody = decodeChunked(responseBody);
            }
            return new RawHttpResponse(status, location, responseBody);
        } catch (NumberFormatException error) {
            throw new IOException("Invalid HTTP status", error);
        }
    }

    private static byte[] readAllBytes(InputStream input) throws IOException {
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private static int findHeaderEnd(byte[] data) {
        for (int i = 0; i <= data.length - 4; i++) {
            if (data[i] == '\r' && data[i + 1] == '\n' && data[i + 2] == '\r' && data[i + 3] == '\n') {
                return i;
            }
        }
        return -1;
    }

    private static String headerValue(String[] lines, String name) {
        String prefix = name.toLowerCase() + ":";
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i];
            if (line.toLowerCase().startsWith(prefix)) {
                return line.substring(line.indexOf(':') + 1).trim();
            }
        }
        return null;
    }

    private static byte[] decodeChunked(byte[] data) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int index = 0;
        while (index < data.length) {
            int lineEnd = findLineEnd(data, index);
            if (lineEnd < 0) throw new IOException("Invalid chunked response");
            String sizeText = new String(data, index, lineEnd - index, StandardCharsets.ISO_8859_1).trim();
            int semi = sizeText.indexOf(';');
            if (semi >= 0) sizeText = sizeText.substring(0, semi).trim();
            int size = Integer.parseInt(sizeText, 16);
            index = lineEnd + 2;
            if (size == 0) break;
            if (index + size > data.length) throw new IOException("Invalid chunk size");
            output.write(data, index, size);
            index += size + 2;
        }
        return output.toByteArray();
    }

    private static int findLineEnd(byte[] data, int start) {
        for (int i = start; i < data.length - 1; i++) {
            if (data[i] == '\r' && data[i + 1] == '\n') return i;
        }
        return -1;
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

    private static final class RawHttpResponse {
        final int status;
        final String location;
        final byte[] body;

        RawHttpResponse(int status, String location, byte[] body) {
            this.status = status;
            this.location = location;
            this.body = body;
        }
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
