package com.aaradhya.upbeat;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.LruCache;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Generates Obsidian Dark & Crimson Rose album/playlist cover artwork
 * and serves cached high-res thumbnails for Android Auto views.
 */
public class UpBeatArtProvider extends ContentProvider {

    public static final String AUTHORITY = "com.aaradhya.upbeat.art";
    private static final String CACHE_FOLDER = "aa_art_v76";
    private static final LruCache<String, File> sDiskCacheIndex = new LruCache<>(160);

    public static Uri buildCardUri(String cardId, String tagTop, String ribbonText, String ribbonHex, String heroVid) {
        return buildCardUri(cardId, tagTop, ribbonText, ribbonHex, heroVid, null);
    }

    public static Uri buildCardUri(String cardId, String tagTop, String ribbonText, String ribbonHex, String heroVid, String thumbUrl) {
        Uri.Builder builder = new Uri.Builder()
            .scheme("content")
            .authority(AUTHORITY)
            .appendPath("card")
            .appendPath(cardId != null ? cardId : "default")
            .appendQueryParameter("top", tagTop != null ? tagTop : "")
            .appendQueryParameter("ribbon", ribbonText != null ? ribbonText : "")
            .appendQueryParameter("color", ribbonHex != null ? ribbonHex : "#F43F5E")
            .appendQueryParameter("vid", heroVid != null ? heroVid : "");
        if (thumbUrl != null && !thumbUrl.trim().isEmpty()) {
            builder.appendQueryParameter("u", thumbUrl.trim());
        }
        return builder.build();
    }

    public static Uri buildYtThumbUri(String videoId, String titleHint) {
        return buildYtThumbUri(videoId, titleHint, null);
    }

    public static Uri buildYtThumbUri(String videoId, String titleHint, String thumbUrl) {
        Uri.Builder builder = new Uri.Builder()
            .scheme("content")
            .authority(AUTHORITY)
            .appendPath("thumb")
            .appendPath(videoId != null && !videoId.isEmpty() ? videoId : "default")
            .appendQueryParameter("t", titleHint != null ? titleHint : "");
        if (thumbUrl != null && !thumbUrl.trim().isEmpty()) {
            builder.appendQueryParameter("u", thumbUrl.trim());
        }
        return builder.build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Nullable
    @Override
    public ParcelFileDescriptor openFile(@NonNull Uri uri, @NonNull String mode) throws FileNotFoundException {
        if (getContext() == null) {
            throw new FileNotFoundException("No context");
        }
        try {
            File cacheDir = new File(getContext().getCacheDir(), CACHE_FOLDER);
            if (!cacheDir.exists()) {
                cacheDir.mkdirs();
            }

            String key = uri.toString();
            String safeHash = Integer.toHexString(key.hashCode());
            File cachedFile = sDiskCacheIndex.get(key);
            if (cachedFile != null && cachedFile.exists() && cachedFile.length() > 512) {
                return ParcelFileDescriptor.open(cachedFile, ParcelFileDescriptor.MODE_READ_ONLY);
            }

            String type = uri.getPathSegments().size() > 0 ? uri.getPathSegments().get(0) : "thumb";
            String id = uri.getPathSegments().size() > 1 ? uri.getPathSegments().get(1) : "default";
            String cleanId = id.replaceAll("[^a-zA-Z0-9_-]", "_");
            File targetFile = new File(cacheDir, type + "_" + cleanId + "_" + safeHash + ".png");

            if (targetFile.exists() && targetFile.length() > 512) {
                sDiskCacheIndex.put(key, targetFile);
                return ParcelFileDescriptor.open(targetFile, ParcelFileDescriptor.MODE_READ_ONLY);
            }

            Bitmap bmp;
            String thumbUrl = uri.getQueryParameter("u");
            if ("card".equals(type)) {
                String topTag = uri.getQueryParameter("top");
                String ribbon = uri.getQueryParameter("ribbon");
                String colorHex = uri.getQueryParameter("color");
                String heroVid = uri.getQueryParameter("vid");
                bmp = renderPlaylistCoverCard(id, topTag, ribbon, colorHex, heroVid, thumbUrl);
            } else {
                String titleHint = uri.getQueryParameter("t");
                bmp = renderSongThumbnail(id, titleHint, thumbUrl);
            }

            if (bmp == null) {
                throw new FileNotFoundException("Failed to render artwork");
            }

            try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                bmp.compress(Bitmap.CompressFormat.PNG, 100, fos);
                fos.flush();
            }
            bmp.recycle();

            sDiskCacheIndex.put(key, targetFile);
            return ParcelFileDescriptor.open(targetFile, ParcelFileDescriptor.MODE_READ_ONLY);
        } catch (Exception e) {
            throw new FileNotFoundException("Art error: " + e.getMessage());
        }
    }

    private Bitmap renderPlaylistCoverCard(String cardId, String topTag, String ribbon, String colorHex, String heroVid, String thumbUrl) {
        int size = 400;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);

        int accentColor = Color.parseColor("#F43F5E");
        try {
            if (colorHex != null && !colorHex.isEmpty()) {
                accentColor = Color.parseColor(colorHex);
            }
        } catch (Exception ignored) {}

        // Obsidian Dark base canvas (#0A0A0B -> #121216 -> #1B1B24)
        Paint basePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        basePaint.setShader(new LinearGradient(
            0, 0, size, size,
            new int[]{Color.parseColor("#0A0A0B"), Color.parseColor("#121216"), Color.parseColor("#1B1B24")},
            new float[]{0f, 0.55f, 1f},
            Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0, 0, size, size, basePaint);

        // Hero cover art if available
        Bitmap hero = downloadBestArtwork(thumbUrl, heroVid, size);
        if (hero != null) {
            canvas.drawBitmap(hero, 0, 0, null);
            hero.recycle();
        } else {
            drawObsidianFallbackGraphic(canvas, size, accentColor, cardId);
        }

        // Top subtle dark vignette for pill legibility
        Paint topScrim = new Paint(Paint.ANTI_ALIAS_FLAG);
        topScrim.setShader(new LinearGradient(
            0, 0, 0, size * 0.34f,
            new int[]{Color.argb(175, 10, 10, 11), Color.argb(0, 10, 10, 11)},
            null,
            Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0, 0, size, size * 0.34f, topScrim);

        // Bottom UpBeat obsidian glass gradient
        Paint bottomScrim = new Paint(Paint.ANTI_ALIAS_FLAG);
        bottomScrim.setShader(new LinearGradient(
            0, size * 0.40f, 0, size,
            new int[]{Color.argb(0, 10, 10, 11), Color.argb(205, 10, 10, 11), Color.argb(242, 10, 10, 11)},
            new float[]{0f, 0.58f, 1f},
            Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0, size * 0.40f, size, size, bottomScrim);

        // Subtle frosted hairline border
        Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(2.5f);
        borderPaint.setColor(Color.argb(46, 255, 255, 255));
        canvas.drawRoundRect(new RectF(2f, 2f, size - 2f, size - 2f), 26f, 26f, borderPaint);

        // Subtle accent bar at top edge
        Paint topBarPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        topBarPaint.setColor(accentColor);
        canvas.drawRect(0, 0, size, 5f, topBarPaint);

        // Top-left frosted badge (e.g., "Made For You", "Chart", "Saved Mix")
        if (topTag != null && !topTag.trim().isEmpty()) {
            String badge = topTag.trim().toUpperCase();
            Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setColor(Color.parseColor("#F4F4F5"));
            textPaint.setTextSize(20f);
            textPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));

            float padX = 18f;
            float textW = textPaint.measureText(badge);
            float pillW = Math.min(size - 40f, textW + padX * 2f);
            float pillH = 40f;
            RectF pillRect = new RectF(20f, 22f, 20f + pillW, 22f + pillH);

            Paint pillBg = new Paint(Paint.ANTI_ALIAS_FLAG);
            pillBg.setColor(Color.argb(210, 18, 18, 22));
            canvas.drawRoundRect(pillRect, 20f, 20f, pillBg);

            Paint pillStroke = new Paint(Paint.ANTI_ALIAS_FLAG);
            pillStroke.setStyle(Paint.Style.STROKE);
            pillStroke.setStrokeWidth(1.5f);
            pillStroke.setColor(Color.argb(72, 255, 255, 255));
            canvas.drawRoundRect(pillRect, 20f, 20f, pillStroke);

            float textY = pillRect.centerY() - ((textPaint.descent() + textPaint.ascent()) / 2f);
            canvas.drawText(badge, pillRect.left + padX, textY, textPaint);
        }

        // Bottom-left Crimson Rose / Category ribbon pill
        if (ribbon != null && !ribbon.trim().isEmpty()) {
            String label = ribbon.trim();
            Paint labelPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            labelPaint.setTextSize(24f);
            labelPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            labelPaint.setColor(isColorBright(accentColor) ? Color.parseColor("#0A0A0B") : Color.WHITE);

            float padX = 20f;
            float textW = labelPaint.measureText(label);
            float pillW = Math.min(size - 40f, textW + padX * 2f);
            float pillH = 46f;
            RectF ribbonRect = new RectF(20f, size - 22f - pillH, 20f + pillW, size - 22f);

            Paint ribbonBg = new Paint(Paint.ANTI_ALIAS_FLAG);
            ribbonBg.setColor(accentColor);
            canvas.drawRoundRect(ribbonRect, 23f, 23f, ribbonBg);

            float textY = ribbonRect.centerY() - ((labelPaint.descent() + labelPaint.ascent()) / 2f);
            canvas.drawText(label, ribbonRect.left + padX, textY, labelPaint);
        }

        return out;
    }

    private Bitmap renderSongThumbnail(String videoId, String titleHint, String thumbUrl) {
        int size = 320;
        Bitmap downloaded = downloadBestArtwork(thumbUrl, videoId, size);
        if (downloaded != null) {
            return downloaded;
        }

        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        drawObsidianFallbackGraphic(canvas, size, Color.parseColor("#F43F5E"), titleHint);
        return out;
    }

    private void drawObsidianFallbackGraphic(Canvas canvas, int size, int accentColor, String labelHint) {
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setShader(new LinearGradient(
            0, 0, size, size,
            new int[]{Color.parseColor("#0A0A0B"), Color.parseColor("#16161D"), Color.parseColor("#101015")},
            new float[]{0f, 0.55f, 1f},
            Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0, 0, size, size, bg);

        Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        ringPaint.setStyle(Paint.Style.STROKE);
        ringPaint.setStrokeWidth(2.5f);
        ringPaint.setColor(Color.argb(65, Color.red(accentColor), Color.green(accentColor), Color.blue(accentColor)));
        canvas.drawCircle(size / 2f, size / 2f, size * 0.40f, ringPaint);
        canvas.drawCircle(size / 2f, size / 2f, size * 0.28f, ringPaint);

        Paint centerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        centerPaint.setColor(accentColor);
        canvas.drawCircle(size / 2f, size / 2f, size * 0.16f, centerPaint);

        String glyph = (labelHint != null && !labelHint.trim().isEmpty())
            ? labelHint.trim().substring(0, 1).toUpperCase()
            : "♫";
        Paint glyphPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        glyphPaint.setColor(isColorBright(accentColor) ? Color.parseColor("#0A0A0B") : Color.WHITE);
        glyphPaint.setTextSize(size * 0.15f);
        glyphPaint.setTextAlign(Paint.Align.CENTER);
        glyphPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        float textY = (size / 2f) - ((glyphPaint.descent() + glyphPaint.ascent()) / 2f);
        canvas.drawText(glyph, size / 2f, textY, glyphPaint);
    }

    private Bitmap downloadBestArtwork(String thumbUrl, String videoId, int targetSize) {
        if (thumbUrl != null && (thumbUrl.startsWith("https://") || thumbUrl.startsWith("http://"))) {
            Bitmap b = downloadCenterSquareThumb(thumbUrl, targetSize);
            if (b != null) return b;
        }
        if (videoId != null && videoId.length() == 11) {
            String[] variants = new String[]{
                "https://i.ytimg.com/vi/" + videoId + "/maxresdefault.jpg",
                "https://i.ytimg.com/vi/" + videoId + "/sddefault.jpg",
                "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg"
            };
            for (String url : variants) {
                Bitmap b = downloadCenterSquareThumb(url, targetSize);
                if (b != null) return b;
            }
        }
        return null;
    }

    private Bitmap downloadCenterSquareThumb(String urlStr, int targetSize) {
        try {
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) UpBeatAuto/7.6");
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(4500);
            conn.connect();
            if (conn.getResponseCode() != 200) {
                return null;
            }
            Bitmap raw;
            try (InputStream is = conn.getInputStream()) {
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                raw = BitmapFactory.decodeStream(is, null, opts);
            }
            if (raw == null || raw.getWidth() < 16 || raw.getHeight() < 16) {
                if (raw != null) raw.recycle();
                return null;
            }
            int w = raw.getWidth();
            int h = raw.getHeight();
            int crop = Math.min(w, h);
            int x = (w - crop) / 2;
            int y = (h - crop) / 2;
            Bitmap square = Bitmap.createBitmap(raw, x, y, crop, crop);
            if (square != raw) {
                raw.recycle();
            }
            Bitmap scaled = Bitmap.createScaledBitmap(square, targetSize, targetSize, true);
            if (scaled != square) {
                square.recycle();
            }
            return scaled;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isColorBright(int color) {
        double r = Color.red(color) / 255.0;
        double g = Color.green(color) / 255.0;
        double b = Color.blue(color) / 255.0;
        double luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        return luminance > 0.65;
    }

    @Nullable
    @Override
    public Cursor query(@NonNull Uri uri, @Nullable String[] projection, @Nullable String selection, @Nullable String[] selectionArgs, @Nullable String sortOrder) {
        return null;
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        return "image/png";
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        return null;
    }

    @Override
    public int delete(@NonNull Uri uri, @Nullable String selection, @Nullable String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(@NonNull Uri uri, @Nullable ContentValues values, @Nullable String selection, @Nullable String[] selectionArgs) {
        return 0;
    }
}
