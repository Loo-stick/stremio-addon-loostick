/**
 * Client API TF1+
 *
 * Gère l'authentification Gigya et l'accès aux streams TF1+
 * Les credentials sont lus depuis les variables d'environnement
 * TF1_EMAIL et TF1_PASSWORD - JAMAIS stockés dans le code
 *
 * Proxy SOCKS5 optionnel (ex: NordVPN) via:
 * TF1_PROXY_HOST, TF1_PROXY_PORT, TF1_PROXY_USER, TF1_PROXY_PASS
 *
 * @module lib/tf1
 */

const fetch = require('node-fetch');
const { SocksProxyAgent } = require('socks-proxy-agent');

/** URL de l'API Gigya pour l'authentification */
const GIGYA_LOGIN_URL = 'https://compte.tf1.fr/accounts.login';

/** Clé API Gigya TF1 */
const GIGYA_API_KEY = '3_hWgJdARhz_7l1oOp3a8BDLoR9cuWZpUaKG4aqF7gum9_iK3uTZ2VlDBl8ANf8FVk';

/** URL pour obtenir le token TF1 */
const TOKEN_URL = 'https://www.tf1.fr/token/gigya/web';

/** URL de l'API MediaInfo */
const MEDIAINFO_URL = 'https://mediainfo.tf1.fr/mediainfocombo';

/** Cache en mémoire */
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/** Token d'authentification (en mémoire, jamais persisté) */
let authToken = null;
let authTokenExpiry = 0;

/** Agent proxy SOCKS5 (optionnel) */
let proxyAgent = null;

/**
 * Crée l'agent proxy SOCKS5 si configuré
 * @returns {SocksProxyAgent|null}
 */
function createProxyAgent() {
    const host = process.env.TF1_PROXY_HOST;
    const port = process.env.TF1_PROXY_PORT || '1080';
    const user = process.env.TF1_PROXY_USER;
    const pass = process.env.TF1_PROXY_PASS;

    if (!host) {
        return null;
    }

    let proxyUrl;
    if (user && pass) {
        proxyUrl = `socks5://${user}:${pass}@${host}:${port}`;
    } else {
        proxyUrl = `socks5://${host}:${port}`;
    }

    console.log(`[TF1] Proxy SOCKS5 configuré: ${host}:${port}`);
    return new SocksProxyAgent(proxyUrl);
}

// Initialise le proxy au chargement du module
proxyAgent = createProxyAgent();

/**
 * Récupère une valeur du cache ou exécute la fonction
 *
 * @param {string} key - Clé du cache
 * @param {Function} fn - Fonction à exécuter si pas en cache
 * @returns {Promise<*>} Résultat
 */
async function cached(key, fn) {
    const now = Date.now();
    const item = cache.get(key);

    if (item && now < item.expiry) {
        console.log(`[TF1] Cache hit: ${key}`);
        return item.value;
    }

    console.log(`[TF1] Cache miss: ${key}`);
    const value = await fn();
    cache.set(key, { value, expiry: now + CACHE_TTL });
    return value;
}

/**
 * Liste des chaînes TF1 disponibles en direct
 */
const LIVE_CHANNELS = [
    { id: 'L_TF1', name: 'TF1', logo: 'https://photos.tf1.fr/450/0/logo-tf1-2020-min-1c7c27-26ba3a-0@1x.jpg' },
    { id: 'L_TMC', name: 'TMC', logo: 'https://photos.tf1.fr/450/0/logo-tmc-2020-min-9fe0e0-5b1f13-0@1x.jpg' },
    { id: 'L_TFX', name: 'TFX', logo: 'https://photos.tf1.fr/450/0/logo-tfx-2020-min-e2ef72-8c8d13-0@1x.jpg' },
    { id: 'L_LCI', name: 'LCI', logo: 'https://photos.tf1.fr/450/0/logo-lci-2020-min-a0978b-4a05fe-0@1x.jpg' }
];

/**
 * Classe client pour l'API TF1+
 */
class TF1Client {
    constructor() {
        this.channels = LIVE_CHANNELS;
        // Credentials lus depuis les variables d'environnement - JAMAIS en dur
        this.email = process.env.TF1_EMAIL;
        this.password = process.env.TF1_PASSWORD;
    }

    /**
     * Vérifie si les credentials sont configurés
     *
     * @returns {boolean} True si les credentials sont présents
     */
    isConfigured() {
        return !!(this.email && this.password);
    }

    /**
     * Effectue une requête HTTP (avec proxy si configuré)
     *
     * @param {string} url - URL à appeler
     * @param {Object} options - Options fetch
     * @returns {Promise<Object>} Réponse JSON
     * @private
     */
    async _fetch(url, options = {}) {
        const defaultHeaders = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        const fetchOptions = {
            ...options,
            headers: { ...defaultHeaders, ...options.headers }
        };

        // Utilise le proxy SOCKS5 si configuré
        if (proxyAgent) {
            fetchOptions.agent = proxyAgent;
        }

        try {
            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`[TF1] Erreur requête ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Authentification via Gigya
     * Les credentials ne sont JAMAIS loggés
     *
     * @returns {Promise<Object>} Infos de session Gigya
     * @private
     */
    async _loginGigya() {
        if (!this.isConfigured()) {
            throw new Error('TF1_EMAIL et TF1_PASSWORD non configurés');
        }

        console.log('[TF1] Authentification Gigya...');

        const params = new URLSearchParams();
        params.append('apiKey', GIGYA_API_KEY);
        params.append('loginID', this.email);
        params.append('password', this.password);

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: params
        };

        if (proxyAgent) {
            fetchOptions.agent = proxyAgent;
        }

        const response = await fetch(GIGYA_LOGIN_URL, fetchOptions);

        const data = await response.json();

        if (data.statusCode !== 200) {
            console.error('[TF1] Échec authentification Gigya:', data.errorMessage);
            throw new Error(`Authentification échouée: ${data.errorMessage}`);
        }

        console.log('[TF1] Authentification Gigya réussie');

        return {
            uid: data.UID,
            signature: data.UIDSignature,
            timestamp: parseInt(data.signatureTimestamp)
        };
    }

    /**
     * Obtient un token TF1 à partir de la session Gigya
     *
     * @param {Object} gigyaSession - Session Gigya
     * @returns {Promise<string>} Token JWT TF1
     * @private
     */
    async _getToken(gigyaSession) {
        console.log('[TF1] Obtention du token TF1...');

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://www.tf1.fr'
            },
            body: JSON.stringify({
                uid: gigyaSession.uid,
                signature: gigyaSession.signature,
                timestamp: gigyaSession.timestamp
            })
        };

        if (proxyAgent) {
            fetchOptions.agent = proxyAgent;
        }

        const response = await fetch(TOKEN_URL, fetchOptions);

        const data = await response.json();

        if (data.error) {
            console.error('[TF1] Erreur obtention token:', data.error);
            throw new Error(`Erreur token: ${data.error}`);
        }

        console.log('[TF1] Token TF1 obtenu (valide 12h)');

        return {
            token: data.token,
            refreshToken: data.refresh_token,
            ttl: data.ttl || 43200
        };
    }

    /**
     * Assure qu'un token valide est disponible
     * Gère le refresh automatique
     *
     * @returns {Promise<string>} Token JWT valide
     */
    async ensureToken() {
        const now = Date.now();

        // Token encore valide (avec 5 min de marge)
        if (authToken && now < authTokenExpiry - 300000) {
            return authToken;
        }

        console.log('[TF1] Token expiré ou absent, renouvellement...');

        // Login Gigya puis obtention token TF1
        const gigyaSession = await this._loginGigya();
        const tokenData = await this._getToken(gigyaSession);

        authToken = tokenData.token;
        authTokenExpiry = now + (tokenData.ttl * 1000);

        return authToken;
    }

    /**
     * Récupère les informations d'un média (live ou replay)
     *
     * @param {string} mediaId - ID du média (ex: L_TF1, 14191414)
     * @returns {Promise<Object|null>} Infos du média avec URL de stream
     */
    async getMediaInfo(mediaId) {
        console.log(`[TF1] Récupération média ${mediaId}...`);

        try {
            const token = await this.ensureToken();

            const url = `${MEDIAINFO_URL}/${mediaId}?context=MYTF1&pver=5010000`;
            const fetchOptions = {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Authorization': `Bearer ${token}`
                }
            };

            if (proxyAgent) {
                fetchOptions.agent = proxyAgent;
            }

            const response = await fetch(url, fetchOptions);

            const data = await response.json();
            const media = data.media || {};

            if (media.error_code) {
                console.log(`[TF1] Erreur média ${mediaId}: ${media.error_code} - ${media.error_desc}`);
                return {
                    id: mediaId,
                    title: media.title,
                    error: media.error_code,
                    errorDesc: media.error_desc
                };
            }

            // Récupère l'URL de stream depuis delivery
            let streamUrl = null;
            if (data.delivery && data.delivery.url) {
                streamUrl = data.delivery.url;
            }

            return {
                id: mediaId,
                title: media.title,
                shortTitle: media.shortTitle,
                programName: media.programName,
                programSlug: media.programSlug,
                channel: media.channel2 || media.channel,
                type: media.type,
                duration: media.duration,
                preview: media.preview,
                sqPreview: media.sqPreview,
                isLive: media.type === 'live',
                streamUrl: streamUrl,
                geolock: media.geolock
            };

        } catch (error) {
            console.error(`[TF1] Erreur média ${mediaId}:`, error.message);
            return null;
        }
    }

    /**
     * Récupère les directs disponibles
     *
     * @returns {Promise<Array>} Liste des chaînes en direct
     */
    async getLiveChannels() {
        return cached('live_channels', async () => {
            console.log('[TF1] Récupération des directs...');

            const lives = [];

            for (const channel of LIVE_CHANNELS) {
                try {
                    const info = await this.getMediaInfo(channel.id);
                    if (info && !info.error) {
                        lives.push({
                            id: channel.id,
                            title: `${channel.name} - Direct`,
                            description: info.shortTitle || info.title || `En direct sur ${channel.name}`,
                            image: info.preview,
                            logo: channel.logo,
                            channel: channel.name,
                            isLive: true
                        });
                    }
                } catch (error) {
                    console.error(`[TF1] Erreur live ${channel.id}:`, error.message);
                }
            }

            console.log(`[TF1] ${lives.length} directs disponibles`);
            return lives;
        });
    }

    /**
     * Recherche des programmes
     *
     * @param {string} query - Terme de recherche
     * @returns {Promise<Array>} Liste des programmes trouvés
     */
    async search(query) {
        // TF1 utilise Algolia pour la recherche - à implémenter si besoin
        console.log(`[TF1] Recherche: ${query} (non implémenté)`);
        return [];
    }

    /**
     * Récupère les programmes populaires/récents
     * Note: L'API TF1 est complexe, on utilise des IDs connus pour l'instant
     *
     * @returns {Promise<Array>} Liste des programmes
     */
    async getPopularPrograms() {
        return cached('popular_programs', async () => {
            console.log('[TF1] Récupération programmes populaires...');

            // IDs de programmes populaires (à enrichir)
            const popularIds = [
                { id: '14191414', expected: 'Nicky Larson' },
                { id: '14193498', expected: 'Programme' }
            ];

            const programs = [];

            for (const prog of popularIds) {
                try {
                    const info = await this.getMediaInfo(prog.id);
                    if (info && info.streamUrl) {
                        programs.push({
                            id: prog.id,
                            title: info.title || prog.expected,
                            programName: info.programName,
                            description: info.shortTitle,
                            image: info.preview,
                            duration: info.duration,
                            channel: info.channel
                        });
                    }
                } catch (error) {
                    console.error(`[TF1] Erreur programme ${prog.id}:`, error.message);
                }
            }

            console.log(`[TF1] ${programs.length} programmes récupérés`);
            return programs;
        });
    }
}

module.exports = TF1Client;
