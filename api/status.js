export const config = {
  runtime: 'edge',
};

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

  return new Response(
    JSON.stringify({
      status: 'ok',
      mode: 'web-edge',
      version: '4.4.7.1',
      pwa: true,
      features: ['innertube-edge-proxy', 'ios-audio-streaming', 'pwa-offline', 'taste-dna'],
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    }
  );
}
