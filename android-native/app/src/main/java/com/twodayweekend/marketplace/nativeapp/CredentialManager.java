package com.twodayweekend.marketplace.nativeapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

final class CredentialManager {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "tdwm_native_actor_v1";
    private static final String PREFS = "tdwm_native_identity";
    private static final String PREF_ACTOR_KEY = "actor_key";

    private final Context context;

    CredentialManager(Context context) {
        this.context = context.getApplicationContext();
    }

    String actorKey() throws Exception {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = prefs.getString(PREF_ACTOR_KEY, "");
        if (!saved.isEmpty()) return saved;
        PublicKey publicKey = ensureKeyPair();
        String actorKey = "actor_" + sha256Hex(publicKey.getEncoded()).substring(0, 24);
        prefs.edit().putString(PREF_ACTOR_KEY, actorKey).apply();
        return actorKey;
    }

    String publicKeyBase64() throws Exception {
        return Base64.encodeToString(ensureKeyPair().getEncoded(), Base64.NO_WRAP);
    }

    JSONObject actionCredential(
            String actionType,
            String targetSellerId,
            String targetProductId,
            String orderId,
            String stakeId,
            String challengeId,
            String nonce,
            JSONObject requestBody) throws Exception {
        String createdAt = TimeUtil.nowIso();
        String bodyHash = sha256Hex(canonicalJson(requestBody));
        String actorKey = actorKey();

        JSONObject unsigned = new JSONObject();
        unsigned.put("version", 1);
        unsigned.put("algorithm", "ES256");
        unsigned.put("actorKey", actorKey);
        unsigned.put("keyId", KEY_ALIAS);
        unsigned.put("clientActionId", requestBody.optString("clientActionId", ""));
        unsigned.put("actionType", actionType);
        unsigned.put("targetSellerId", targetSellerId == null ? JSONObject.NULL : targetSellerId);
        unsigned.put("targetProductId", targetProductId == null ? JSONObject.NULL : targetProductId);
        unsigned.put("orderId", orderId == null ? JSONObject.NULL : orderId);
        unsigned.put("stakeId", stakeId == null ? JSONObject.NULL : stakeId);
        unsigned.put("bodyHash", bodyHash);
        unsigned.put("challengeId", challengeId);
        unsigned.put("nonce", nonce);
        unsigned.put("createdAt", createdAt);

        String canonical = canonicalJson(unsigned);
        String signature = sign(canonical);
        unsigned.put("signature", signature);
        unsigned.put("publicKey", publicKeyBase64());
        return unsigned;
    }

    private PublicKey ensureKeyPair() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_EC,
                    KEYSTORE);
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false)
                    .build();
            generator.initialize(spec);
            generator.generateKeyPair();
        }
        return keyStore.getCertificate(KEY_ALIAS).getPublicKey();
    }

    private String sign(String canonical) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        PrivateKey privateKey = (PrivateKey) keyStore.getKey(KEY_ALIAS, null);
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(privateKey);
        signature.update(canonical.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP);
    }

    static String canonicalJson(JSONObject object) throws JSONException {
        TreeMap<String, String> values = new TreeMap<>();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            values.put(key, canonicalValue(object.opt(key)));
        }
        StringBuilder builder = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (!first) builder.append(',');
            first = false;
            builder.append(JSONObject.quote(entry.getKey())).append(':').append(entry.getValue());
        }
        return builder.append('}').toString();
    }

    private static String canonicalArray(JSONArray array) throws JSONException {
        StringBuilder builder = new StringBuilder("[");
        for (int i = 0; i < array.length(); i++) {
            if (i > 0) builder.append(',');
            builder.append(canonicalValue(array.opt(i)));
        }
        return builder.append(']').toString();
    }

    private static String canonicalValue(Object value) throws JSONException {
        if (value == null || JSONObject.NULL.equals(value)) return "null";
        if (value instanceof JSONObject) return canonicalJson((JSONObject) value);
        if (value instanceof JSONArray) return canonicalArray((JSONArray) value);
        if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
        return JSONObject.quote(String.valueOf(value));
    }

    static String sha256Hex(String value) throws Exception {
        return sha256Hex(value.getBytes(StandardCharsets.UTF_8));
    }

    static String sha256Hex(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] result = digest.digest(bytes);
        StringBuilder builder = new StringBuilder(result.length * 2);
        for (byte item : result) {
            builder.append(String.format(Locale.US, "%02x", item));
        }
        return builder.toString();
    }

}
