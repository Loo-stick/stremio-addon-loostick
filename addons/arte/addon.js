/**
 * Arte.tv Addon (adapté pour mono-repo)
 *
 * Streaming légal et gratuit depuis Arte.tv
 */

const { addonBuilder } = require('stremio-addon-sdk');
const ArteClient = require('./lib/arte');

/**
 * Crée et configure l'addon Arte.tv
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest }
 */
function createAddon(config = {}) {
    const arte = new ArteClient();
    const ID_PREFIX = 'arte:';

    console.log('[Arte.tv] Client initialisé');

    // Manifest
    const manifest = {
        id: 'community.stremio.arte',
        version: '1.0.0',
        name: 'Arte.tv',
        description: 'Streaming légal et gratuit depuis Arte.tv - Documentaires, films, séries et direct',
        logo: 'https://raw.githubusercontent.com/Loo-stick/stremio-arteloo-addon/main/logo.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['movie', 'series', 'tv'],
        catalogs: [
            { type: 'movie', id: 'arte-home', name: 'Arte - À la une', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'arte-cinema', name: 'Arte - Cinéma', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'arte-docs', name: 'Arte - Documentaires', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'series', id: 'arte-series', name: 'Arte - Séries', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'tv', id: 'arte-live', name: 'Arte - Direct', extra: [] }
        ],
        idPrefixes: [ID_PREFIX]
    };

    const builder = new addonBuilder(manifest);

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[Arte.tv] Catalogue: ${id}`);

        const skip = parseInt(extra?.skip) || 0;
        const limit = 50;

        try {
            let videos = [];

            switch (id) {
                case 'arte-home':
                    videos = await arte.getHomepage();
                    break;
                case 'arte-cinema':
                    videos = await arte.getCategory('CIN');
                    break;
                case 'arte-docs':
                    videos = await arte.getCategory('DOR');
                    break;
                case 'arte-series':
                    videos = await arte.getCategory('SER');
                    break;
                case 'arte-live':
                    const live = await arte.getLiveStream();
                    if (live && live.streamUrl) {
                        return {
                            metas: [{
                                id: `${ID_PREFIX}LIVE`,
                                type: 'tv',
                                name: 'Arte - Direct',
                                poster: 'https://static-cdn.arte.tv/guide/favicons/apple-touch-icon.png',
                                posterShape: 'square',
                                description: live.subtitle ? `${live.title} - ${live.subtitle}` : live.title || 'Arte en direct'
                            }]
                        };
                    }
                    return { metas: [] };
                default:
                    return { metas: [] };
            }

            const paginated = videos.slice(skip, skip + limit);
            const metas = paginated.map(video => ({
                id: `${ID_PREFIX}${video.programId}`,
                type: type,
                name: video.title,
                poster: video.imageLarge || video.image,
                posterShape: 'regular',
                description: video.description,
                releaseInfo: video.durationLabel,
                genres: video.genre ? [video.genre] : []
            }));

            console.log(`[Arte.tv] ${metas.length} résultats`);
            return { metas };
        } catch (error) {
            console.error(`[Arte.tv] Erreur catalogue:`, error.message);
            return { metas: [] };
        }
    });

    // Meta handler
    builder.defineMetaHandler(async ({ type, id }) => {
        console.log(`[Arte.tv] Meta: ${id}`);

        const programId = id.replace(ID_PREFIX, '');

        // Live
        if (programId === 'LIVE') {
            const live = await arte.getLiveStream();
            if (live) {
                return {
                    meta: {
                        id: id,
                        type: 'tv',
                        name: 'Arte - Direct',
                        poster: 'https://static-cdn.arte.tv/guide/favicons/apple-touch-icon.png',
                        posterShape: 'square',
                        description: live.description || 'Arte en direct',
                        runtime: 'En direct',
                        genres: ['Direct', 'Culture']
                    }
                };
            }
            return { meta: null };
        }

        try {
            // Collection (série)
            const isCollection = programId.startsWith('RC-');

            if (isCollection && type === 'series') {
                const episodes = await arte.getCollectionEpisodes(programId);
                const video = await arte.getVideoMeta(programId);

                if (!video && episodes.length === 0) return { meta: null };

                const videos = episodes.map((ep, index) => ({
                    id: `${ID_PREFIX}${ep.programId}`,
                    title: ep.subtitle || ep.title,
                    season: 1,
                    episode: index + 1,
                    thumbnail: ep.image,
                    overview: ep.description
                }));

                const poster = video?.images?.[0]?.url || episodes[0]?.image;

                return {
                    meta: {
                        id: id,
                        type: 'series',
                        name: video?.title?.split(' - ')[0] || episodes[0]?.title?.split(' - ')[0] || 'Série Arte',
                        poster: poster,
                        posterShape: 'regular',
                        background: poster,
                        description: video?.description || episodes[0]?.description,
                        genres: ['Arte', 'Culture'],
                        videos: videos
                    }
                };
            }

            // Contenu simple
            const video = await arte.getVideoMeta(programId);
            if (!video) return { meta: null };

            const hours = Math.floor(video.duration / 3600);
            const minutes = Math.floor((video.duration % 3600) / 60);
            const runtime = hours > 0 ? `${hours}h${minutes}min` : `${minutes}min`;

            const poster = video.images?.[0]?.url || null;

            return {
                meta: {
                    id: id,
                    type: type,
                    name: video.title,
                    poster: poster,
                    posterShape: 'regular',
                    background: poster,
                    description: video.subtitle ? `${video.subtitle}\n\n${video.description}` : video.description,
                    runtime: runtime,
                    genres: ['Arte', 'Culture']
                }
            };
        } catch (error) {
            console.error(`[Arte.tv] Erreur meta:`, error.message);
            return { meta: null };
        }
    });

    // Stream handler
    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[Arte.tv] Stream: ${id}`);

        const programId = id.replace(ID_PREFIX, '');

        try {
            let streamUrl;
            let title;

            if (programId === 'LIVE') {
                const live = await arte.getLiveStream();
                if (!live || !live.streamUrl) return { streams: [] };
                streamUrl = live.streamUrl;
                title = 'Arte Direct';
            } else {
                streamUrl = await arte.getStreamUrl(programId);
                if (!streamUrl) return { streams: [] };
                const meta = await arte.getVideoMeta(programId);
                title = meta?.title || 'Arte';
            }

            return {
                streams: [{
                    name: 'Arte.tv',
                    title: `${title}\n🇫🇷 Français - HD`,
                    url: streamUrl,
                    behaviorHints: { notWebReady: false }
                }]
            };
        } catch (error) {
            console.error(`[Arte.tv] Erreur stream:`, error.message);
            return { streams: [] };
        }
    });

    /**
     * Configure les routes Express pour cet addon
     */
    function setupRoutes(router) {
        router.get('/stats', (req, res) => {
            res.json({
                addon: 'Arte.tv',
                catalogs: manifest.catalogs.map(c => c.id)
            });
        });
    }

    return {
        builder,
        manifest,
        setupRoutes,
        name: 'arte'
    };
}

module.exports = createAddon;
