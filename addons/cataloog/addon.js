/**
 * Cataloog Addon (adapté pour mono-repo)
 *
 * Catalogue enrichi avec TMDB - Tendances, genres, thématiques et plus
 */

const { addonBuilder } = require('stremio-addon-sdk');
const TMDBClient = require('./lib/tmdb');

/**
 * Crée et configure l'addon Cataloog
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest }
 */
function createAddon(config = {}) {
    const tmdbApiKey = config.tmdbApiKey || process.env.TMDB_API_KEY;

    if (!tmdbApiKey) {
        console.warn('[Cataloog] TMDB_API_KEY non définie - addon désactivé');
        return null;
    }

    const tmdb = new TMDBClient(tmdbApiKey, 'fr-FR');
    console.log('[Cataloog] Client TMDB initialisé');

    // Définition des catalogues
    const CATALOGS = {
        'trending-movies-day': { name: '🔥 Tendances du jour', type: 'movie', fetch: (page) => tmdb.getTrendingMoviesDay(page) },
        'trending-movies-week': { name: '📈 Tendances semaine', type: 'movie', fetch: (page) => tmdb.getTrendingMoviesWeek(page) },
        'trending-series-day': { name: '🔥 Séries du jour', type: 'series', fetch: (page) => tmdb.getTrendingSeriesDay(page) },
        'trending-series-week': { name: '📈 Séries semaine', type: 'series', fetch: (page) => tmdb.getTrendingSeriesWeek(page) },
        'netflix-movies': { name: '🔴 Netflix', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(8, page) },
        'netflix-series': { name: '🔴 Netflix', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(8, page) },
        'prime-movies': { name: '📦 Prime Video', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(119, page) },
        'prime-series': { name: '📦 Prime Video', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(119, page) },
        'disney-movies': { name: '🏰 Disney+', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(337, page) },
        'disney-series': { name: '🏰 Disney+', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(337, page) },
        'apple-movies': { name: '🍎 Apple TV+', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(350, page) },
        'apple-series': { name: '🍎 Apple TV+', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(350, page) },
        'hbo-movies': { name: '💜 Max (HBO)', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(384, page) },
        'hbo-series': { name: '💜 Max (HBO)', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(384, page) },
        'canal-movies': { name: '➕ Canal+', type: 'movie', fetch: (page) => tmdb.getMoviesByProvider(381, page) },
        'canal-series': { name: '➕ Canal+', type: 'series', fetch: (page) => tmdb.getSeriesByProvider(381, page) },
        'top-rated-movies': { name: '🏆 Top Films', type: 'movie', fetch: (page) => tmdb.getTopRatedMovies(page) },
        'top-rated-series': { name: '🏆 Top Séries', type: 'series', fetch: (page) => tmdb.getTopRatedSeries(page) },
        'now-playing': { name: '🎬 Au cinéma', type: 'movie', fetch: (page) => tmdb.getNowPlayingMovies(page) },
        'upcoming': { name: '📅 Prochainement', type: 'movie', fetch: (page) => tmdb.getUpcomingMovies(page) },
        'genre-action': { name: '💥 Action', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(28, page) },
        'genre-comedy': { name: '😂 Comédie', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(35, page) },
        'genre-horror': { name: '😱 Horreur', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(27, page) },
        'genre-scifi': { name: '🚀 Science-Fiction', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(878, page) },
        'genre-thriller': { name: '🔪 Thriller', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(53, page) },
        'genre-romance': { name: '💕 Romance', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(10749, page) },
        'genre-drama': { name: '📖 Drame', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(18, page) },
        'genre-animation': { name: '🎨 Animation', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(16, page) },
        'genre-documentary': { name: '📚 Documentaire', type: 'movie', fetch: (page) => tmdb.getMoviesByGenre(99, page) },
        'genre-series-action': { name: '💥 Action', type: 'series', fetch: (page) => tmdb.getSeriesByGenre(10759, page) },
        'genre-series-comedy': { name: '😂 Comédie', type: 'series', fetch: (page) => tmdb.getSeriesByGenre(35, page) },
        'genre-series-drama': { name: '📖 Drame', type: 'series', fetch: (page) => tmdb.getSeriesByGenre(18, page) },
        'genre-series-scifi': { name: '🚀 Science-Fiction', type: 'series', fetch: (page) => tmdb.getSeriesByGenre(10765, page) },
        'miniseries': { name: '📺 Mini-séries', type: 'series', fetch: (page) => tmdb.getMiniSeries(page) },
        'kdramas': { name: '🇰🇷 K-Drama', type: 'series', fetch: (page) => tmdb.getKDramas(page) },
        'anime': { name: '🇯🇵 Anime', type: 'series', fetch: (page) => tmdb.getAnime(page) },
        'country-fr': { name: '🇫🇷 Cinéma Français', type: 'movie', fetch: (page) => tmdb.getMoviesByCountry('FR', page) },
        'country-kr': { name: '🇰🇷 Cinéma Coréen', type: 'movie', fetch: (page) => tmdb.getMoviesByCountry('KR', page) },
        'christmas': { name: '🎄 Noël', type: 'movie', fetch: (page) => tmdb.getChristmasMovies(page) },
        'family': { name: '👨‍👩‍👧 Famille', type: 'movie', fetch: (page) => tmdb.getFamilyMovies(page) },
        'oscars': { name: '🏆 Oscars', type: 'movie', fetch: (page) => tmdb.getOscarWinners(page) }
    };

    // Manifest
    const manifest = {
        id: 'community.stremio.cataloog',
        version: '1.0.1',
        name: 'Cataloog',
        description: 'Catalogue enrichi TMDB - Tendances, genres, mini-séries, thématiques et plus',
        logo: 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3edd904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg',
        resources: ['catalog'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: Object.entries(CATALOGS).map(([id, catalog]) => ({
            type: catalog.type,
            id: `cataloog-${id}`,
            name: catalog.name,
            extra: [{ name: 'skip', isRequired: false }]
        }))
    };

    const builder = new addonBuilder(manifest);

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[Cataloog] Catalogue: ${id}`);

        const catalogId = id.replace('cataloog-', '');
        const catalog = CATALOGS[catalogId];

        if (!catalog) {
            console.log(`[Cataloog] Catalogue inconnu: ${catalogId}`);
            return { metas: [] };
        }

        const skip = parseInt(extra?.skip) || 0;
        const page = Math.floor(skip / 20) + 1;

        try {
            const results = await catalog.fetch(page);
            console.log(`[Cataloog] ${results.length} résultats pour ${catalog.name}`);
            return { metas: results };
        } catch (error) {
            console.error(`[Cataloog] Erreur:`, error.message);
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
        name: 'cataloog'
    };
}

module.exports = createAddon;
