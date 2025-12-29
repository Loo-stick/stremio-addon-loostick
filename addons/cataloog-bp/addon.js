/**
 * Cataloog BP (Beaux-Parents) Addon (adapté pour mono-repo)
 *
 * Catalogue personnalisé - Asie, Classiques, Thrillers, Policiers
 */

const { addonBuilder } = require('stremio-addon-sdk');
const TMDBClient = require('./lib/tmdb');

/**
 * Crée et configure l'addon Cataloog BP
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest }
 */
function createAddon(config = {}) {
    const tmdbApiKey = config.tmdbApiKey || process.env.TMDB_API_KEY;

    if (!tmdbApiKey) {
        console.warn('[CataloogBP] TMDB_API_KEY non définie - addon désactivé');
        return null;
    }

    const tmdb = new TMDBClient(tmdbApiKey, 'fr-FR');
    console.log('[CataloogBP] Client TMDB initialisé');

    // Définition des catalogues
    const CATALOGS = {
        // Asie
        'kdrama': { name: '🇰🇷 K-Drama', type: 'series', fetch: (page) => tmdb.getKDramas(page) },
        'korean-romance': { name: '💕 Romance Coréenne', type: 'series', fetch: (page) => tmdb.getKoreanRomance(page) },
        'korean-movies': { name: '🇰🇷 Cinéma Coréen', type: 'movie', fetch: (page) => tmdb.getMoviesByCountry('KR', page) },
        'jdrama': { name: '🇯🇵 J-Drama', type: 'series', fetch: (page) => tmdb.getJDrama(page) },
        'japanese-movies': { name: '🇯🇵 Cinéma Japonais', type: 'movie', fetch: (page) => tmdb.getMoviesByCountry('JP', page) },
        'asian-drama': { name: '🌏 Drama Asiatique', type: 'series', fetch: (page) => tmdb.getAsianDrama(page) },
        'chinese-movies': { name: '🇨🇳 Cinéma Chinois', type: 'movie', fetch: (page) => tmdb.getChineseMovies(page) },

        // Thriller & Policier
        'thriller-movies': { name: '🔪 Thriller', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(53, page) },
        'thriller-series': { name: '🔪 Thriller', type: 'series', fetch: (page) => tmdb.getSeriesByGenre(80, page) },
        'crime-movies': { name: '🔍 Policier', type: 'movie', fetch: (page) => tmdb.getCrimeMovies(page) },
        'crime-series': { name: '🔍 Policier', type: 'series', fetch: (page) => tmdb.getCrimeSeries(page) },

        // Classiques
        'classic-movies': { name: '🎬 Films Classiques', type: 'movie', fetch: (page) => tmdb.getClassicMovies(page) },
        'classic-series': { name: '📺 Séries Classiques', type: 'series', fetch: (page) => tmdb.getClassicSeries(page) },
        'miniseries': { name: '📺 Mini-séries', type: 'series', fetch: (page) => tmdb.getMiniSeries(page) },

        // Romance & Drame
        'romance-movies': { name: '💕 Romance', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(10749, page) },
        'drama-movies': { name: '📖 Drame', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(18, page) },
        'drama-series': { name: '📖 Drame', type: 'series', fetch: (page) => tmdb.getSeriesByGenre(18, page) },

        // Top
        'top-movies': { name: '🏆 Top Films', type: 'movie', fetch: (page) => tmdb.getTopRatedMovies(page) },
        'top-series': { name: '🏆 Top Séries', type: 'series', fetch: (page) => tmdb.getTopRatedSeries(page) },

        // Plateformes
        'netflix-movies': { name: '🔴 Netflix', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(8, page) },
        'netflix-series': { name: '🔴 Netflix', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(8, page) },
        'prime-movies': { name: '📦 Prime Video', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(119, page) },
        'prime-series': { name: '📦 Prime Video', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(119, page) },
        'disney-movies': { name: '🏰 Disney+', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(337, page) },
        'disney-series': { name: '🏰 Disney+', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(337, page) },
        'canal-movies': { name: '➕ Canal+', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(381, page) },
        'canal-series': { name: '➕ Canal+', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(381, page) }
    };

    // Manifest
    const manifest = {
        id: 'community.stremio.cataloog-bp',
        version: '1.0.0',
        name: 'Cataloog BP',
        description: 'Catalogue personnalisé - Asie, Classiques, Thrillers, Policiers',
        logo: 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3edd904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg',
        resources: ['catalog'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: Object.entries(CATALOGS).map(([id, catalog]) => ({
            type: catalog.type,
            id: `cataloog-bp-${id}`,
            name: catalog.name,
            extra: [{ name: 'skip', isRequired: false }]
        }))
    };

    const builder = new addonBuilder(manifest);

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[CataloogBP] Catalogue: ${id}`);

        const catalogId = id.replace('cataloog-bp-', '');
        const catalog = CATALOGS[catalogId];

        if (!catalog) {
            console.log(`[CataloogBP] Catalogue inconnu: ${catalogId}`);
            return { metas: [] };
        }

        const skip = parseInt(extra?.skip) || 0;
        const page = Math.floor(skip / 20) + 1;

        try {
            const results = await catalog.fetch(page);
            console.log(`[CataloogBP] ${results.length} résultats pour ${catalog.name}`);
            return { metas: results };
        } catch (error) {
            console.error(`[CataloogBP] Erreur:`, error.message);
            return { metas: [] };
        }
    });

    /**
     * Configure les routes Express pour cet addon
     */
    function setupRoutes(router) {
        router.get('/stats', (req, res) => {
            res.json({
                catalogsCount: Object.keys(CATALOGS).length,
                catalogs: Object.keys(CATALOGS)
            });
        });
    }

    return {
        builder,
        manifest,
        setupRoutes,
        name: 'cataloog-bp'
    };
}

module.exports = createAddon;
