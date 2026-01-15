/**
 * France.tv Addon (adapté pour mono-repo)
 *
 * Replay gratuit France Télévisions
 */

const { addonBuilder } = require('stremio-addon-sdk');
const FranceTVClient = require('./lib/francetv');

/**
 * Crée et configure l'addon France.tv
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest }
 */
function createAddon(config = {}) {
    const francetv = new FranceTVClient();
    const ID_PREFIX = 'francetv:';

    console.log('[France.tv] Client initialisé');

    // Manifest
    const manifest = {
        id: 'community.stremio.francetv',
        version: '1.0.0',
        name: 'France.tv',
        description: 'Replay gratuit France Télévisions - France 2, France 3, France 4, France 5, franceinfo, Slash',
        logo: 'https://www.france.tv/image/vignette_3x4/280/420/p/l/e/phpqlzple.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['movie', 'series', 'tv'],
        catalogs: [
            { type: 'movie', id: 'francetv-france-2', name: 'France 2', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-france-3', name: 'France 3', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-france-5', name: 'France 5', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-france-4', name: 'France 4', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-franceinfo', name: 'franceinfo', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-slash', name: 'France tv Slash', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-sport', name: '⚽ Sport', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'series', id: 'francetv-series-et-fictions', name: '📺 Séries & Fictions', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-rugby', name: '🏉 Rugby', extra: [{ name: 'skip', isRequired: false }] },
            { type: 'movie', id: 'francetv-papotin', name: '🎤 Le Papotin', extra: [{ name: 'skip', isRequired: false }] }
        ],
        idPrefixes: [ID_PREFIX]
    };

    const builder = new addonBuilder(manifest);

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[France.tv] Catalogue: ${id} (type: ${type})`);

        const skip = parseInt(extra?.skip) || 0;
        const limit = 50;
        const channelId = id.replace('francetv-', '');

        try {
            let videos = [];

            if (channelId === 'rugby') {
                videos = await francetv.getRugbyContent();
            } else if (channelId === 'papotin') {
                videos = await francetv.search('papotin');
            } else {
                videos = await francetv.getChannelContent(channelId);
            }

            const paginated = videos.slice(skip, skip + limit);
            const metas = paginated.map(video => {
                // Utilise le type 'series' pour les programmes, sinon le type demandé
                const itemType = video.isProgram ? 'series' : type;
                return {
                    id: `${ID_PREFIX}${video.id}`,
                    type: itemType,
                    name: video.title,
                    poster: video.poster || video.image,
                    posterShape: video.poster ? 'poster' : 'landscape',
                    description: video.description,
                    background: video.image
                };
            });

            console.log(`[France.tv] ${metas.length} résultats`);
            return { metas };
        } catch (error) {
            console.error(`[France.tv] Erreur catalogue:`, error.message);
            return { metas: [] };
        }
    });

    // Meta handler
    builder.defineMetaHandler(async ({ type, id }) => {
        console.log(`[France.tv] Meta: ${id} (type: ${type})`);

        const contentId = id.replace(ID_PREFIX, '');

        try {
            // Vérifie si c'est un programme (série)
            if (contentId.startsWith('program:')) {
                const programPath = contentId.replace('program:', '');
                const program = await francetv.getProgramInfo(programPath);

                if (!program) return { meta: null };

                // Formate les épisodes pour Stremio
                const videos = program.episodes.map(ep => ({
                    id: `${ID_PREFIX}${ep.id}`,
                    title: ep.title,
                    season: ep.season,
                    episode: ep.episode,
                    thumbnail: ep.thumbnail,
                    overview: ep.description,
                    released: new Date().toISOString()
                }));

                console.log(`[France.tv] Programme ${program.title}: ${videos.length} épisodes`);

                return {
                    meta: {
                        id: id,
                        type: 'series',
                        name: program.title,
                        poster: program.poster || program.image,
                        posterShape: program.poster ? 'poster' : 'landscape',
                        background: program.background || program.image,
                        description: program.description,
                        genres: ['France.tv', 'Replay'],
                        videos: videos
                    }
                };
            }

            // Sinon c'est une vidéo individuelle
            const video = await francetv.getVideoInfo(contentId);
            if (!video) return { meta: null };

            const hours = Math.floor((video.duration || 0) / 3600);
            const minutes = Math.floor(((video.duration || 0) % 3600) / 60);
            const runtime = hours > 0 ? `${hours}h${minutes}min` : `${minutes}min`;

            return {
                meta: {
                    id: id,
                    type: type,
                    name: video.title,
                    poster: video.image,
                    posterShape: 'landscape',
                    background: video.image,
                    description: video.description,
                    runtime: runtime,
                    genres: ['France.tv', 'Replay']
                }
            };
        } catch (error) {
            console.error(`[France.tv] Erreur meta:`, error.message);
            return { meta: null };
        }
    });

    // Stream handler
    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[France.tv] Stream: ${id}`);

        const videoId = id.replace(ID_PREFIX, '');

        try {
            const video = await francetv.getVideoInfo(videoId);

            if (!video) {
                console.log(`[France.tv] Pas de vidéo pour ${videoId}`);
                return { streams: [] };
            }

            if (video.drm) {
                return {
                    streams: [{
                        name: 'France.tv',
                        title: `${video.title}\n⚠️ Protégé par DRM - Non disponible`,
                        externalUrl: `https://www.france.tv/`
                    }]
                };
            }

            if (!video.streamUrl) {
                return { streams: [] };
            }

            return {
                streams: [{
                    name: 'France.tv',
                    title: `${video.title}\n🇫🇷 Français`,
                    url: video.streamUrl,
                    behaviorHints: { notWebReady: false }
                }]
            };
        } catch (error) {
            console.error(`[France.tv] Erreur stream:`, error.message);
            return { streams: [] };
        }
    });

    /**
     * Configure les routes Express pour cet addon
     */
    function setupRoutes(router) {
        // Pas de routes custom pour France.tv
    }

    return {
        builder,
        manifest,
        setupRoutes,
        name: 'francetv'
    };
}

module.exports = createAddon;
