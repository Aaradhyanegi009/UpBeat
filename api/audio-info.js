export const config = {
  runtime: 'edge',
};

const IOS_PLAYER_CLIENT = {
  clientName: 'IOS',
  clientVersion: '20.10.4',
  deviceMake: 'Apple',
  deviceModel: 'iPhone16,2',
  osName: 'iPhone',
  osVersion: '18.3.2.22D82',
  hl: 'en',
  gl: 'US',
};

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get('id') || searchParams.get('video_id');

  if (!videoId || videoId.length !== 11) {
    return new Response(JSON.stringify({ error: 'Missing or invalid 11-char video ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const upstreamRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; US)',
      },
      body: JSON.stringify({
        context: { client: IOS_PLAYER_CLIENT },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });

    if (!upstreamRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to query YouTube player' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await upstreamRes.json();
    if (data?.playabilityStatus?.status !== 'OK') {
      return new Response(
        JSON.stringify({
          error: data?.playabilityStatus?.reason || 'Track not playable',
          status: data?.playabilityStatus?.status,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        }
      );
    }

    const adaptive = (data?.streamingData?.adaptiveFormats || []).filter(
      (f) => f.url && (f.mimeType || '').startsWith('audio/')
    );

    const chosen =
      adaptive.find((f) => f.itag === 140) ||
      adaptive.find((f) => (f.mimeType || '').includes('mp4a.40.2')) ||
      adaptive.find((f) => f.itag === 251) ||
      adaptive.find((f) => (f.mimeType || '').startsWith('audio/mp4')) ||
      adaptive[0] ||
      (data?.streamingData?.formats || []).find((f) => f.url);

    if (!chosen?.url) {
      return new Response(JSON.stringify({ error: 'No audio stream format found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const durationSec =
      Number(data?.videoDetails?.lengthSeconds || 0) ||
      Math.round(Number(chosen.approxDurationMs || 0) / 1000) ||
      0;

    return new Response(
      JSON.stringify({
        video_id: videoId,
        duration: durationSec,
        duration_text: formatSeconds(durationSec),
        url: `/api/audio/${videoId}`,
        direct_stream_url: chosen.url,
        title: data?.videoDetails?.title || '',
        artist: data?.videoDetails?.author || '',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=1800',
        },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Stream resolution error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
