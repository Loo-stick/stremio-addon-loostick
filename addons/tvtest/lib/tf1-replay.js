/**
 * Client TF1+ Replay - Test DRM Widevine
 *
 * Explore les replays TF1+ et analyse les protections DRM
 * Projet de recherche uniquement
 */

const fetch = require('node-fetch');
const { SocksProxyAgent } = require('socks-proxy-agent');

const GIGYA_LOGIN_URL = 'https://compte.tf1.fr/accounts.login';
const GIGYA_API_KEY = '3_hWgJdARhz_7l1oOp3a8BDLoR9cuWZpUaKG4aqF7gum9_iK3uTZ2VlDBl8ANf8FVk';
const TOKEN_URL = 'https://www.tf1.fr/token/gigya/web';
const MEDIAINFO_URL = 'https://mediainfo.tf1.fr/mediainfocombo';
const GRAPHQL_URL = 'https://www.tf1.fr/graphql/web';

const GRAPHQL_IDS = {
    PROGRAMS_BY_CHANNEL: '483ce0f',
    VIDEOS_BY_PROGRAM: 'a6f9cf0e',
    SEARCH_PROGRAMS: 'e78b188',
    SEARCH_VIDEOS: 'b2dc9439'
};

const CHANNEL_SLUGS = ['tf1', 'tmc', 'tfx', 'lci'];

const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

let authToken = null;
let authTokenExpiry = 0;

let proxyAgent = null;
const proxyHost = process.env.TF1_PROXY_HOST;
if (proxyHost) {
    const port = process.env.TF1_PROXY_PORT || '1080';
    const user = process.env.TF1_PROXY_USER;
    const pass = process.env.TF1_PROXY_PASS;
    const url = user && pass ? `socks5://${user}:${pass}@${proxyHost}:${port}` : `socks5://${proxyHost}:${port}`;
    proxyAgent = new SocksProxyAgent(url);
    console.log(`[TVTest] Proxy SOCKS5: ${proxyHost}:${port}`);
}

async function cached(key, fn) {
    const item = cache.get(key);
    if (item && Date.now() < item.expiry) return item.value;
    const value = await fn();
    cache.set(key, { value, expiry: Date.now() + CACHE_TTL });
    return value;
}

class TF1ReplayClient {
    constructor() {
        this.email = process.env.TF1_EMAIL;
        this.password = process.env.TF1_PASSWORD;
    }

    isConfigured() {
        return !!(this.email && this.password);
    }

    async _fetch(url, options = {}) {
        const fetchOptions = {
            ...options,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...options.headers
            }
        };
        if (proxyAgent) fetchOptions.agent = proxyAgent;

        const response = await fetch(url, fetchOptions);
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status}: ${response.statusText} - ${text.slice(0, 200)}`);
        }
        return response.json();
    }

    async _fetchRaw(url, options = {}) {
        const fetchOptions = {
            ...options,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...options.headers
            }
        };
        if (proxyAgent) fetchOptions.agent = proxyAgent;
        return fetch(url, fetchOptions);
    }

    async _loginGigya() {
        console.log('[TVTest] Login Gigya...');
        const params = new URLSearchParams();
        params.append('apiKey', GIGYA_API_KEY);
        params.append('loginID', this.email);
        params.append('password', this.password);

        const fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            body: params
        };
        if (proxyAgent) fetchOptions.agent = proxyAgent;

        const response = await fetch(GIGYA_LOGIN_URL, fetchOptions);
        const data = await response.json();

        if (data.statusCode !== 200) {
            throw new Error(`Gigya auth failed: ${data.errorMessage}`);
        }

        console.log('[TVTest] Login Gigya OK');
        return { uid: data.UID, signature: data.UIDSignature, timestamp: parseInt(data.signatureTimestamp) };
    }

    async _getToken(gigyaSession) {
        console.log('[TVTest] Getting TF1 token...');
        const fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.tf1.fr' },
            body: JSON.stringify(gigyaSession)
        };
        if (proxyAgent) fetchOptions.agent = proxyAgent;

        const response = await fetch(TOKEN_URL, fetchOptions);
        const data = await response.json();

        if (data.error) throw new Error(`Token error: ${data.error}`);
        console.log('[TVTest] Token TF1 OK');
        return data.token;
    }

    async ensureToken() {
        if (authToken && Date.now() < authTokenExpiry - 300000) return authToken;
        const session = await this._loginGigya();
        const token = await this._getToken(session);
        authToken = token;
        authTokenExpiry = Date.now() + 12 * 3600 * 1000;
        return token;
    }

    /**
     * Récupère les infos d'un média avec analyse DRM détaillée
     */
    async getMediaInfo(mediaId) {
        const token = await this.ensureToken();

        // Test différents formats pour voir ce qui change
        const formats = ['hls', 'dash', 'hls,dash'];
        const results = {};

        for (const format of formats) {
            try {
                const url = `${MEDIAINFO_URL}/${mediaId}?context=MYTF1&pver=5010000&format=${format}`;
                const fetchOptions = {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Authorization': `Bearer ${token}`
                    }
                };
                if (proxyAgent) fetchOptions.agent = proxyAgent;

                const response = await fetch(url, fetchOptions);
                const data = await response.json();
                results[format] = data;
            } catch (e) {
                results[format] = { error: e.message };
            }
        }

        return results;
    }

    /**
     * Récupère les infos brutes d'un média (un seul format)
     */
    async getMediaInfoRaw(mediaId, format = 'hls') {
        const token = await this.ensureToken();
        const url = `${MEDIAINFO_URL}/${mediaId}?context=MYTF1&pver=5010000&format=${format}`;
        const fetchOptions = {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Authorization': `Bearer ${token}`
            }
        };
        if (proxyAgent) fetchOptions.agent = proxyAgent;
        const response = await fetch(url, fetchOptions);
        return response.json();
    }

    /**
     * Analyse le manifest DASH pour extraire les infos DRM
     */
    async analyzeDashManifest(mpdUrl) {
        try {
            const response = await this._fetchRaw(mpdUrl);
            const mpd = await response.text();

            const analysis = {
                url: mpdUrl,
                size: mpd.length,
                hasWidevine: mpd.includes('edef8ba9-79d6-4ace-a3c8-27dcd51d21ed') || mpd.includes('urn:uuid:edef8ba9'),
                hasPlayReady: mpd.includes('9a04f079-9840-4286-ab92-e65be0885f95') || mpd.includes('urn:uuid:9a04f079'),
                hasFairPlay: mpd.includes('94ce86fb-07ff-4f43-adb8-93d2fa968ca2'),
                hasClearKey: mpd.includes('e2719d58-a985-b3c9-781a-b030af78d30e') || mpd.includes('urn:uuid:e2719d58'),
                contentProtections: [],
                licenseUrls: [],
            };

            // Extract ContentProtection elements
            const cpRegex = /<ContentProtection[^>]*>([\s\S]*?)<\/ContentProtection>|<ContentProtection[^>]*\/>/g;
            let match;
            while ((match = cpRegex.exec(mpd)) !== null) {
                analysis.contentProtections.push(match[0].slice(0, 500));
            }

            // Extract license URLs
            const licenseRegex = /license[_-]?url["\s:=]+["']?([^"'\s<>]+)/gi;
            while ((match = licenseRegex.exec(mpd)) !== null) {
                analysis.licenseUrls.push(match[1]);
            }

            // Extract PSSH boxes (base64)
            const psshRegex = /<cenc:pssh[^>]*>([^<]+)<\/cenc:pssh>/gi;
            const psshBoxes = [];
            while ((match = psshRegex.exec(mpd)) !== null) {
                psshBoxes.push(match[1].trim());
            }
            analysis.psshBoxes = psshBoxes;

            // First 2000 chars for inspection
            analysis.mpdPreview = mpd.slice(0, 2000);

            return analysis;
        } catch (e) {
            return { error: e.message };
        }
    }

    /**
     * Analyse un manifest HLS
     */
    async analyzeHlsManifest(m3u8Url) {
        try {
            const response = await this._fetchRaw(m3u8Url);
            const m3u8 = await response.text();

            return {
                url: m3u8Url,
                size: m3u8.length,
                hasWidevine: m3u8.includes('com.widevine') || m3u8.includes('WIDEVINE'),
                hasFairPlay: m3u8.includes('com.apple.streamingkeydelivery') || m3u8.includes('FAIRPLAY'),
                hasAes128: m3u8.includes('METHOD=AES-128'),
                hasSampleAes: m3u8.includes('METHOD=SAMPLE-AES'),
                isEncrypted: m3u8.includes('#EXT-X-KEY') || m3u8.includes('#EXT-X-SESSION-KEY'),
                keyLines: m3u8.split('\n').filter(l => l.includes('#EXT-X-KEY') || l.includes('#EXT-X-SESSION-KEY')),
                preview: m3u8.slice(0, 2000)
            };
        } catch (e) {
            return { error: e.message };
        }
    }

    async _graphql(queryId, variables = {}) {
        const varsString = typeof variables === 'string' ? variables : JSON.stringify(variables);
        const url = `${GRAPHQL_URL}?id=${queryId}&variables=${encodeURIComponent(varsString)}`;
        const fetchOptions = {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.tf1.fr/programmes-tv'
            }
        };
        if (proxyAgent) fetchOptions.agent = proxyAgent;
        const response = await fetch(url, fetchOptions);
        const data = await response.json();
        return data.data || data;
    }

    /**
     * Récupère les derniers replays disponibles
     */
    async getLatestReplays(channel = 'tf1', limit = 20) {
        return cached(`replays_${channel}_${limit}`, async () => {
            console.log(`[TVTest] Récupération replays ${channel}...`);

            const variables = {
                context: { persona: 'PERSONA_2', application: 'WEB', device: 'DESKTOP', os: 'WINDOWS' },
                filter: { channel: channel.toLowerCase() },
                offset: 0,
                limit: 10
            };

            const data = await this._graphql(GRAPHQL_IDS.PROGRAMS_BY_CHANNEL, variables);
            if (!data?.programs?.items) return [];

            const replays = [];
            for (const prog of data.programs.items.slice(0, 5)) {
                try {
                    const varsStr = `{"programSlug":"${prog.slug}","offset":0,"limit":${limit},"sort":{"type":"DATE","order":"DESC"},"types":["REPLAY"]}`;
                    const vData = await this._graphql(GRAPHQL_IDS.VIDEOS_BY_PROGRAM, varsStr);
                    const videos = vData?.programBySlug?.videos?.items || [];

                    for (const v of videos) {
                        const decoration = v.decoration || {};
                        const images = decoration.images || [];
                        let poster = null;
                        for (const img of images) {
                            const src = img.sources?.[0]?.url;
                            if (src) { poster = src; break; }
                        }

                        replays.push({
                            id: v.id,
                            slug: v.slug,
                            title: decoration.label || v.slug || prog.name,
                            program: prog.name,
                            programSlug: prog.slug,
                            description: decoration.description || '',
                            poster: poster,
                            duration: v.playingInfos?.duration,
                            date: v.date,
                            channel: channel.toUpperCase(),
                            rights: v.rights || [],
                            streamId: v.streamId || v.id,
                        });
                    }
                } catch (e) {
                    console.error(`[TVTest] Erreur replays ${prog.slug}:`, e.message);
                }
            }

            console.log(`[TVTest] ${replays.length} replays ${channel}`);
            return replays;
        });
    }
}

module.exports = TF1ReplayClient;
