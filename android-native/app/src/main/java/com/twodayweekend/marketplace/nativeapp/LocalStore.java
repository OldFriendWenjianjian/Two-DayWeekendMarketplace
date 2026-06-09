package com.twodayweekend.marketplace.nativeapp;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class LocalStore extends SQLiteOpenHelper {
    private static final String DB_NAME = "tdwm_native.db";
    private static final int VERSION = 1;

    LocalStore(Context context) {
        super(context, DB_NAME, null, VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
                "CREATE TABLE pending_actions (" +
                        "local_id TEXT PRIMARY KEY," +
                        "action_type TEXT NOT NULL," +
                        "method TEXT NOT NULL," +
                        "endpoint TEXT NOT NULL," +
                        "request_json TEXT NOT NULL," +
                        "credential_json TEXT NOT NULL," +
                        "state TEXT NOT NULL," +
                        "created_at TEXT NOT NULL," +
                        "updated_at TEXT NOT NULL," +
                        "last_message TEXT NOT NULL DEFAULT ''," +
                        "server_response TEXT NOT NULL DEFAULT '')");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS pending_actions");
        onCreate(db);
    }

    void enqueue(String localId, String actionType, String method, String endpoint,
                 JSONObject request, JSONObject credential, String message) {
        String now = TimeUtil.nowIso();
        getWritableDatabase().execSQL(
                "INSERT OR REPLACE INTO pending_actions " +
                        "(local_id, action_type, method, endpoint, request_json, credential_json, state, created_at, updated_at, last_message) " +
                        "VALUES (?, ?, ?, ?, ?, ?, 'pending_sync', ?, ?, ?)",
                new Object[]{localId, actionType, method, endpoint, request.toString(), credential.toString(), now, now, message});
    }

    void recordRejected(String localId, String actionType, String method, String endpoint,
                        JSONObject request, JSONObject credential, String message) {
        String now = TimeUtil.nowIso();
        getWritableDatabase().execSQL(
                "INSERT OR REPLACE INTO pending_actions " +
                        "(local_id, action_type, method, endpoint, request_json, credential_json, state, created_at, updated_at, last_message) " +
                        "VALUES (?, ?, ?, ?, ?, ?, 'credential_rejected', ?, ?, ?)",
                new Object[]{localId, actionType, method, endpoint, request.toString(), credential.toString(), now, now, message});
    }

    List<PendingAction> pendingActions() {
        List<PendingAction> actions = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT local_id, action_type, method, endpoint, request_json, credential_json, state, last_message " +
                        "FROM pending_actions WHERE state != 'server_confirmed' ORDER BY created_at ASC",
                null)) {
            while (cursor.moveToNext()) {
                actions.add(new PendingAction(
                        cursor.getString(0),
                        cursor.getString(1),
                        cursor.getString(2),
                        cursor.getString(3),
                        cursor.getString(4),
                        cursor.getString(5),
                        cursor.getString(6),
                        cursor.getString(7)));
            }
        }
        return actions;
    }

    List<PendingAction> retryablePendingActions() {
        List<PendingAction> actions = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT local_id, action_type, method, endpoint, request_json, credential_json, state, last_message " +
                        "FROM pending_actions WHERE state = 'pending_sync' ORDER BY created_at ASC",
                null)) {
            while (cursor.moveToNext()) {
                actions.add(new PendingAction(
                        cursor.getString(0),
                        cursor.getString(1),
                        cursor.getString(2),
                        cursor.getString(3),
                        cursor.getString(4),
                        cursor.getString(5),
                        cursor.getString(6),
                        cursor.getString(7)));
            }
        }
        return actions;
    }

    int pendingCount() {
        return countState("pending_sync");
    }

    int rejectedCount() {
        return countState("credential_rejected");
    }

    private int countState(String state) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT COUNT(*) FROM pending_actions WHERE state = ?",
                new String[]{state})) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    void markConfirmed(String localId, JSONObject response) {
        getWritableDatabase().execSQL(
                "UPDATE pending_actions SET state = 'server_confirmed', updated_at = ?, last_message = '服务器已确认', server_response = ? WHERE local_id = ?",
                new Object[]{TimeUtil.nowIso(), response.toString(), localId});
    }

    void markRejected(String localId, String message) {
        getWritableDatabase().execSQL(
                "UPDATE pending_actions SET state = 'credential_rejected', updated_at = ?, last_message = ? WHERE local_id = ?",
                new Object[]{TimeUtil.nowIso(), message, localId});
    }

    void markPending(String localId, String message) {
        getWritableDatabase().execSQL(
                "UPDATE pending_actions SET state = 'pending_sync', updated_at = ?, last_message = ? WHERE local_id = ?",
                new Object[]{TimeUtil.nowIso(), message, localId});
    }

    static final class PendingAction {
        final String localId;
        final String actionType;
        final String method;
        final String endpoint;
        final String requestJson;
        final String credentialJson;
        final String state;
        final String lastMessage;

        PendingAction(String localId, String actionType, String method, String endpoint,
                      String requestJson, String credentialJson, String state, String lastMessage) {
            this.localId = localId;
            this.actionType = actionType;
            this.method = method;
            this.endpoint = endpoint;
            this.requestJson = requestJson;
            this.credentialJson = credentialJson;
            this.state = state;
            this.lastMessage = lastMessage;
        }
    }
}
