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
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.LruCache;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

/**
 * High-Speed Artwork ContentProvider for Android Auto (com.google.android.projection.gearhead).
 *
 * Solves two critical Android Auto issues:
 * 1. Avoids Binder TransactionTooLargeException (which triggers "Could not load your selection")
 *    by serving bitmaps via content:// URIs instead of embedding Bitmaps in MediaItem bundles.
 * 2. Renders Amazon-Music-style branded square cover cards (with "Fresh / Hot Right Now" ribbons
 *    over real artist/song photography) and caches YouTube song thumbnails on disk + RAM.
 */
public class UpBeatArtProvider extends ContentProvider {

    public static final String AUTHORITY = "com.aaradhya.upbeat.art";

    private static final LruCache<String, File> sDiskCacheIndex = new LruCache<>(120);

    public static Uri buildCardUri(String cardId, String tagTop, String ribbonText, String ribbonHex, String heroVid) {
        return new Uri.Builder()
            .scheme("content")
            .authority(AUTHORITY)
            .appendPath("card")
            .appendPath(cardId != null ? cardId : "default")
            .appendQueryParameter("top", tagTop != null ? tagTop : "")
            .appendQueryParameter("ribbon", ribbonText != null ? ribbonText : "")
            .appendQueryParameter("color", ribbonHex != null ? ribbonHex : "#F59E0B")
            .appendQueryParameter("vid", heroVid != null ? heroVid : "")
            .build();
    }

    public static Uri buildYtThumbUri(String videoId, String titleHint) {
        return new Uri.Builder()
            .scheme("content")
            .authority(AUTHORITY)
            .appendPath("yt")
            .appendPath((videoId != null && !videoId.isEmpty()) ? videoId : "default")
            .appendQueryParameter("t", titleHint != null ? titleHint : "UpBeat")
            .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Nullable
    @Override
    public ParcelFileDescriptor openFile(@NonNull Uri uri, @NonNull String mode) {
        try {
            if (getContext() == null) return null;
            File cacheDir = new File(getContext().getCacheDir(), "aa_art_v53");
            if (!cacheDir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                cacheDir.mkdirs();
            }

            List<String> segs = uri.getPathSegments();
            if (segs == null || segs.isEmpty()) return null;

            String type = segs.get(0);
            String id = segs.size() > 1 ? segs.get(1) : "default";
            String safeKey = (type + "_" + id).replaceAll("[^a-zA-Z0-9_\\-]", "_");
            File outFile = new File(cacheDir, safeKey + ".jpg");

            if (outFile.exists() && outFile.length() > 512) {
                return ParcelFileDescriptor.open(outFile, ParcelFileDescriptor.MODE_READ_ONLY);
            }

            Bitmap bmp;
            if ("card".equals(type)) {
                String topTag = uri.getQueryParameter("top");
                String ribbon = uri.getQueryParameter("ribbon");
                String colorHex = uri.getQueryParameter("color");
                String heroVid = uri.getQueryParameter("vid");
                bmp = renderPlaylistCoverCard(id, topTag, ribbon, colorHex, heroVid);
            } else {
                String titleHint = uri.getQueryParameter("t");
                bmp = renderSongThumbnail(id, titleHint);
            }

            if (bmp != null) {
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    bmp.compress(Bitmap.CompressFormat.JPEG, 88, fos);
                    fos.flush();
                }
                sDiskCacheIndex.put(safeKey, outFile);
                return ParcelFileDescriptor.open(outFile, ParcelFileDescriptor.MODE_READ_ONLY);
            }
        } catch (Exception ignored) {}
        return null;
    }

    /**
     * Renders an Amazon-Music-style 320x320 square playlist cover card:
     * - Background: Downloaded hero track artwork (or vibrant studio gradient if offline)
     * - Top-right: Subtle "UpBeat" pill badge
     * - Bottom: Bold ribbon banner (e.g. black "Fresh" / "Hot Right Now" pill + colored language/genre bar)
     */
    private Bitmap renderPlaylistCoverCard(String cardId, String topTag, String ribbon, String colorHex, String heroVid) {
        int size = 320;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);

        int accentColor;
        try {
            accentColor = Color.parseColor(colorHex != null && !colorHex.isEmpty() ? colorHex : "#F59E0B");
        } catch (Exception e) {
            accentColor = Color.parseColor("#F59E0B");
        }

        // 1. Try fetching hero YouTube thumbnail for authentic artist/song photography
        Bitmap photo = null;
        if (heroVid != null && heroVid.length() == 11) {
            photo = downloadCenterSquareThumb("https://i.ytimg.com/vi/" + heroVid + "/hqdefault.jpg", size);
        }

        if (photo != null) {
            canvas.drawBitmap(photo, 0, 0, null);
            // Subtle vignette so badges pop clearly
            Paint vignette = new Paint(Paint.ANTI_ALIAS_FLAG);
            vignette.setShader(new LinearGradient(
                0, size * 0.45f, 0, size,
                new int[]{Color.TRANSPARENT, Color.argb(180, 8, 8, 14)},
                null, Shader.TileMode.CLAMP
            ));
            canvas.drawRect(0, 0, size, size, vignette);
        } else {
            // Vibrant studio gradient card (like Screenshot 3 "My Recent Plays" / "My Discovery Mix")
            Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
            bg.setShader(new LinearGradient(
                0, 0, size, size,
                new int[]{accentColor, Color.parseColor("#311068"), Color.parseColor("#0B0B14")},
                new float[]{0f, 0.55f, 1f},
                Shader.TileMode.CLAMP
            ));
            canvas.drawRect(0, 0, size, size, bg);

            // Soft glowing orb in center
            Paint orb = new Paint(Paint.ANTI_ALIAS_FLAG);
            orb.setColor(Color.argb(55, 255, 255, 255));
            canvas.drawCircle(size * 0.52f, size * 0.44f, size * 0.32f, orb);
        }

        // 2. Top-right "UpBeat" studio watermark pill
        Paint pillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        pillPaint.setColor(Color.argb(150, 0, 0, 0));
        RectF topPill = new RectF(size - 96, 14, size - 14, 38);
        canvas.drawRoundRect(topPill, 12, 12, pillPaint);

        Paint logoText = new Paint(Paint.ANTI_ALIAS_FLAG);
        logoText.setColor(Color.WHITE);
        logoText.setTextSize(15f);
        logoText.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        logoText.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("UpBeat", topPill.centerX(), topPill.centerY() + 5.5f, logoText);

        // 3. If no photo (e.g. Library cards like "Liked Songs", "Recent Plays"), draw centered title
        if (photo == null && ribbon != null && !ribbon.isEmpty()) {
            Paint centerTitle = new Paint(Paint.ANTI_ALIAS_FLAG);
            centerTitle.setColor(Color.WHITE);
            centerTitle.setTextSize(34f);
            centerTitle.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            centerTitle.setTextAlign(Paint.Align.CENTER);

            if (topTag != null && !topTag.isEmpty()) {
                Paint subPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                subPaint.setColor(Color.parseColor("#38BDF8"));
                subPaint.setTextSize(22f);
                subPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                subPaint.setTextAlign(Paint.Align.CENTER);
                canvas.drawText(topTag, size / 2f, size * 0.40f, subPaint);
            }

            String[] words = ribbon.split(" ");
            if (words.length >= 2) {
                String line1 = words[0];
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i < words.length; i++) {
                    if (i > 1) sb.append(" ");
                    sb.append(words[i]);
                }
                canvas.drawText(line1, size / 2f, size * 0.52f, centerTitle);
                canvas.drawText(sb.toString(), size / 2f, size * 0.64f, centerTitle);
            } else {
                canvas.drawText(ribbon, size / 2f, size * 0.55f, centerTitle);
            }
            return out;
        }

        // 4. Bottom Ribbon Banner (Matches Screenshot 2 & 4: "Fresh / Hindi", "Hot Right Now / Hindi")
        float barTop = size - 64f;
        Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        barPaint.setColor(accentColor);
        canvas.drawRect(0, barTop, size, size, barPaint);

        // Top slanted tag (e.g. "Fresh" or "Hot Right Now")
        if (topTag != null && !topTag.isEmpty()) {
            Paint tagTextPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            tagTextPaint.setColor(Color.WHITE);
            tagTextPaint.setTextSize(20f);
            tagTextPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            float tagWidth = tagTextPaint.measureText(topTag) + 32f;

            Paint tagBg = new Paint(Paint.ANTI_ALIAS_FLAG);
            tagBg.setColor(Color.parseColor("#14141B"));
            Path tagPath = new Path();
            tagPath.moveTo(0, barTop - 32f);
            tagPath.lineTo(tagWidth, barTop - 32f);
            tagPath.lineTo(tagWidth - 10f, barTop);
            tagPath.lineTo(0, barTop);
            tagPath.close();
            canvas.drawPath(tagPath, tagBg);

            canvas.drawText(topTag, 14f, barTop - 9f, tagTextPaint);
        }

        // Main Ribbon Label (e.g. "Hindi", "English", "Japanese", "Indie")
        if (ribbon != null && !ribbon.isEmpty()) {
            Paint ribbonTextPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            // High contrast dark text on yellow/amber/cyan ribbons, white on dark ribbons
            boolean isLightRibbon = isColorBright(accentColor);
            ribbonTextPaint.setColor(isLightRibbon ? Color.parseColor("#111827") : Color.WHITE);
            ribbonTextPaint.setTextSize(32f);
            ribbonTextPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            canvas.drawText(ribbon, 16f, size - 20f, ribbonTextPaint);
        }

        return out;
    }

    private Bitmap renderSongThumbnail(String videoId, String titleHint) {
        int size = 256;
        if (videoId != null && videoId.length() == 11) {
            Bitmap photo = downloadCenterSquareThumb("https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg", size);
            if (photo != null) {
                return photo;
            }
        }
        // Fallback sleek studio tile
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setShader(new LinearGradient(
            0, 0, size, size,
            new int[]{Color.parseColor("#1E1B4B"), Color.parseColor("#0F172A")},
            null, Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0, 0, size, size, bg);

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(68f);
        textPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        textPaint.setTextAlign(Paint.Align.CENTER);
        String letter = (titleHint != null && !titleHint.trim().isEmpty())
            ? titleHint.trim().substring(0, 1).toUpperCase()
            : "♫";
        float y = (size / 2f) - ((textPaint.descent() + textPaint.ascent()) / 2f);
        canvas.drawText(letter, size / 2f, y, textPaint);
        return bitmap;
    }

    private Bitmap downloadCenterSquareThumb(String urlStr, int targetSize) {
        try {
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(3500);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) UpBeatAuto/5.3");
            conn.connect();
            if (conn.getResponseCode() != 200) return null;

            Bitmap raw;
            try (InputStream is = conn.getInputStream()) {
                raw = BitmapFactory.decodeStream(is);
            }
            if (raw == null) return null;

            // YouTube hqdefault is 480x360 (4:3 with black bars top/bottom). Crop center 270x270 square!
            int w = raw.getWidth();
            int h = raw.getHeight();
            int cropSize = Math.min(w, (int) (h * 0.75f));
            if (cropSize <= 0) cropSize = Math.min(w, h);
            int left = (w - cropSize) / 2;
            int top = (h - cropSize) / 2;

            Bitmap out = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(out);
            Rect src = new Rect(left, top, left + cropSize, top + cropSize);
            Rect dst = new Rect(0, 0, targetSize, targetSize);
            Paint p = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
            c.drawBitmap(raw, src, dst, p);
            raw.recycle();
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isColorBright(int color) {
        double darkness = 1 - (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255;
        return darkness < 0.45;
    }

    @Nullable
    @Override
    public Cursor query(@NonNull Uri uri, @Nullable String[] projection, @Nullable String selection, @Nullable String[] selectionArgs, @Nullable String sortOrder) {
        return null;
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        return "image/jpeg";
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
