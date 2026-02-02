/**
 * TVTest - Addon TF1+ Replay avec support DRM
 *
 * Replays TF1+ lisibles via IPTV DRM Stream Player (Android)
 * Utilise Widevine DRM via playlist M3U + KODIPROP
 */

const { addonBuilder } = require('stremio-addon-sdk');
const TF1ReplayClient = require('./lib/tf1-replay');

function createAddon(config = {}) {
    const client = new TF1ReplayClient();
    const ID_PREFIX = 'tvtest:';

    if (!client.isConfigured()) {
        console.warn('[TVTest] TF1_EMAIL et TF1_PASSWORD non configurés - addon désactivé');
        return null;
    }

    console.log('[TVTest] Client initialisé');

    const manifest = {
        id: 'community.stremio.tvtest',
        version: '0.2.0',
        name: 'TF1+ Replay',
        description: 'Replays TF1, TMC, TFX, LCI avec support Widevine DRM (Desktop fork) ou DRM Player (Android).',
        logo: 'https://photos.tf1.fr/450/0/logo-tf1-2020-min-1c7c27-26ba3a-0@1x.jpg',
        resources: ['catalog', 'meta', 'stream'],
        types: ['series'],
        catalogs: [
            { type: 'series', id: 'tvtest-replays', name: 'TF1+ Replay' }
        ],
        idPrefixes: [ID_PREFIX],
        behaviorHints: {
            configurable: false,
            configurationRequired: false
        }
    };

    const builder = new addonBuilder(manifest);

    // Cache des replays
    let replaysCache = null;
    let replaysCacheTime = 0;
    const CACHE_TTL = 15 * 60 * 1000;

    async function getReplays() {
        if (replaysCache && Date.now() - replaysCacheTime < CACHE_TTL) return replaysCache;
        const all = [];
        for (const channel of ['tf1', 'tmc', 'tfx', 'lci']) {
            try {
                const items = await client.getLatestReplays(channel, 10);
                all.push(...items);
            } catch (e) {
                console.error(`[TVTest] Erreur replays ${channel}:`, e.message);
            }
        }
        replaysCache = all;
        replaysCacheTime = Date.now();
        return all;
    }

    // Catalog
    builder.defineCatalogHandler(async ({ type, id }) => {
        if (id !== 'tvtest-replays') return { metas: [] };
        console.log('[TVTest] Catalogue replays');

        try {
            const replays = await getReplays();
            const programs = new Map();
            for (const r of replays) {
                if (!programs.has(r.programSlug)) {
                    programs.set(r.programSlug, {
                        slug: r.programSlug,
                        name: r.program,
                        poster: r.poster,
                        channel: r.channel,
                        episodes: []
                    });
                }
                programs.get(r.programSlug).episodes.push(r);
            }

            const metas = Array.from(programs.values()).map(p => ({
                id: `${ID_PREFIX}prog:${p.slug}`,
                type: 'series',
                name: `${p.name} (${p.channel.toUpperCase()})`,
                poster: p.poster,
                posterShape: 'landscape',
                description: `${p.episodes.length} replay(s) disponible(s)`
            }));

            console.log(`[TVTest] ${metas.length} programmes`);
            return { metas };
        } catch (e) {
            console.error('[TVTest] Erreur catalogue:', e.message);
            return { metas: [] };
        }
    });

    // Meta
    builder.defineMetaHandler(async ({ type, id }) => {
        console.log(`[TVTest] Meta: ${id}`);
        if (!id.startsWith(ID_PREFIX)) return { meta: null };

        const contentId = id.replace(ID_PREFIX, '');
        if (!contentId.startsWith('prog:')) return { meta: null };

        const slug = contentId.replace('prog:', '');

        try {
            const replays = await getReplays();
            const episodes = replays.filter(r => r.programSlug === slug);
            if (episodes.length === 0) return { meta: null };

            const first = episodes[0];
            return {
                meta: {
                    id,
                    type: 'series',
                    name: `${first.program} (${first.channel.toUpperCase()})`,
                    poster: first.poster,
                    posterShape: 'landscape',
                    description: `${episodes.length} épisode(s) en replay`,
                    videos: episodes.map((ep, i) => ({
                        id: `${ID_PREFIX}ep:${ep.streamId}`,
                        title: ep.title,
                        season: 1,
                        episode: i + 1,
                        released: ep.date,
                        overview: ep.description || `Durée: ${ep.duration ? Math.round(ep.duration / 60) + ' min' : '?'}`
                    }))
                }
            };
        } catch (e) {
            console.error('[TVTest] Erreur meta:', e.message);
            return { meta: null };
        }
    });

    // Stream handler
    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[TVTest] Stream: ${id}`);
        if (!id.startsWith(ID_PREFIX)) return { streams: [] };

        const contentId = id.replace(ID_PREFIX, '');
        if (!contentId.startsWith('ep:')) return { streams: [] };

        const mediaId = contentId.replace('ep:', '');

        try {
            const dashInfo = await client.getMediaInfoRaw(mediaId, 'dash');
            const streams = [];

            if (dashInfo.delivery?.url && dashInfo.delivery['drm-server']) {
                const mpdUrl = dashInfo.delivery.url;
                const licenseUrl = dashInfo.delivery['drm-server'];
                const addonUrl = config.addonUrl || 'https://loostick.loostick.ovh/tvtest';
                const m3uUrl = `${addonUrl}/drm-playlist/${mediaId}.m3u`;
                const title = dashInfo.media?.title || 'Replay TF1+';

                // Option 1 : Lecture native Stremio (Shaka Player + Widevine)
                // Nécessite stremio-video-fork avec support DRM
                streams.push({
                    name: 'Stremio DRM',
                    title: `${title}\n🔐 Widevine`,
                    url: mpdUrl,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: 'tf1-drm',
                        // URL originale pour bypass du proxy streaming server
                        originalUrl: mpdUrl,
                        key_systems: {
                            'com.widevine.alpha': licenseUrl
                        },
                        proxyHeaders: {
                            response: {
                                'content-type': 'application/dash+xml'
                            }
                        }
                    }
                });

                // Option 2 : DRM Stream Player (Android externe)
                streams.push({
                    name: 'DRM Player',
                    title: `${title}\n📱 IPTV DRM Stream Player (Android)`,
                    externalUrl: m3uUrl
                });

                // Fallback : TF1.fr / app TF1+
                const channel = dashInfo.media?.channel || 'tf1';
                const programSlug = dashInfo.media?.programSlug || '';
                const tf1Url = programSlug
                    ? `https://www.tf1.fr/${channel}/${programSlug}/videos/${mediaId}`
                    : `https://www.tf1.fr/${channel}/videos/${mediaId}`;

                streams.push({
                    name: 'TF1+',
                    title: `🌐 Ouvrir sur TF1.fr`,
                    externalUrl: tf1Url
                });
            }

            if (streams.length === 0) {
                streams.push({
                    name: 'TF1+',
                    title: 'Stream non disponible',
                    externalUrl: 'https://www.tf1.fr/'
                });
            }

            return { streams };
        } catch (e) {
            console.error('[TVTest] Erreur stream:', e.message);
            return {
                streams: [{
                    name: 'TF1+',
                    title: `Erreur: ${e.message}`,
                    externalUrl: 'https://www.tf1.fr/'
                }]
            };
        }
    });

    function setupRoutes(router) {
        // Playlist M3U avec DRM pour IPTV DRM Stream Player / Tivimate / Kodi
        router.get('/drm-playlist/:mediaId.m3u', async (req, res) => {
            try {
                const mediaId = req.params.mediaId;
                const info = await client.getMediaInfoRaw(mediaId, 'dash');

                if (!info.delivery?.url || !info.delivery['drm-server']) {
                    return res.status(404).send('Stream non disponible');
                }

                const mpdUrl = info.delivery.url;
                const licenseUrl = info.delivery['drm-server'];
                const title = info.media?.title || 'TF1+ Replay';

                const m3u = `#EXTM3U
#EXTINF:-1,${title}
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
#KODIPROP:inputstream.adaptive.license_key=${licenseUrl}|Content-Type=application/octet-stream|R{SSM}|
${mpdUrl}
`;

                res.setHeader('Content-Type', 'audio/x-mpegurl');
                res.setHeader('Content-Disposition', `attachment; filename="${mediaId}.m3u"`);
                res.send(m3u);

            } catch (e) {
                console.error('[TVTest] Erreur génération M3U:', e.message);
                res.status(500).send('Erreur: ' + e.message);
            }
        });

        router.get('/status', (req, res) => {
            res.json({
                configured: client.isConfigured(),
                message: 'TF1+ Replay - Widevine DRM via M3U'
            });
        });
    }

    return {
        builder,
        manifest,
        setupRoutes
    };
}

module.exports = createAddon;
