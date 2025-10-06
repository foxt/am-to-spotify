import child_process from "child_process";
import http from "http";
import { AM_PLAYLIST_ID, NO_DUPLICATE_EXISTING, PLAYLIST_OVERWRITE, SPOT_CLIENT_ID, SPOT_CLIENT_SECRET, SPOT_PLAYLIST_ID } from "./config.mjs";

let amJwk ="";
async function getAMJWK() {
    if (amJwk) return amJwk;
    // we need to get a HTML page to get the JS bundle that contains the JWK
    console.error("Getting HTML");
    var htmlF = await fetch("https://music.apple.com/");
    var html = await htmlF.text();
    // we need to extract the JS bundle URL
    var jsBundleUrl = html.match(/src="(\/assets\/index[-~](legacy-)?[a-f0-9]+.js)"/);
    if (!jsBundleUrl) throw new Error("Could not find JS bundle URL");
    // we need to get the JS bundle
    console.error("Getting JS bundle");
    var jsF = await fetch(`https://music.apple.com/${jsBundleUrl[1]}`);
    var js = await jsF.text();
    // we need to extract the JWK
    var jwk = js.match(/"(eyJhb([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+))"/);
    if (!jwk) throw new Error("Could not find JWK");
    amJwk = jwk[1];
    console.error("JWK", amJwk);
    return amJwk;
}


async function getAMPlaylistTracks(playlistId) {
    let resp;
    let totalTracks = [];
    do {
        console.error("got", totalTracks.length, "tracks");
        var f = await fetch("https://amp-api.music.apple.com" + (resp ? resp.next : `/v1/catalog/gb/playlists/${playlistId}/tracks`), {
            headers: {
                "origin": "https://music.apple.com",
                "authorization": "Bearer " + await getAMJWK(),
                "accept": "*/*"
            }
        });
        if (!f.ok) throw new Error("Could not get playlist tracks" + f.status +  f.statusText);
        resp = (await f.json())
        var tracks = resp.data
            .filter((a) => a.type == "songs")
            .map(a => a.attributes);
        totalTracks = totalTracks.concat(tracks);
    } while (resp.next);
    return totalTracks;
}


let spotifyToken = "";
let spotifyRefreshToken = "";
let spotifyTokenExpires = 0;
async function getSpotifyToken() {
    if (spotifyToken && Date.now() < spotifyTokenExpires) return spotifyToken;
    if (spotifyRefreshToken) {
        console.error("Refreshing Spotify token");
        const f = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=refresh_token&refresh_token=" + spotifyRefreshToken
        });
        if (f.ok) {
            var resp = await f.json();
            spotifyToken = resp.access_token;
            spotifyTokenExpires = Date.now() + (resp.expires_in * 1000);
            return spotifyToken;
        } else {
            console.error("Could not refresh Spotify token", f.status, f.statusText, await f.text());
        }

    }

    let authUrl = "https://accounts.spotify.com/authorize?" +
        "response_type=code" +
        "&client_id=" + SPOT_CLIENT_ID +
        "&scope=playlist-modify-public%20playlist-modify-private" +
        "&redirect_uri=http%3A%2F%2Flocalhost:46851%2Fspot-callback";
    console.error("Please open the following link in your browser: ", authUrl);
    if (process.platform == "darwin") child_process.spawn("/usr/bin/open", [authUrl]);
    else if (process.platform == "win32") child_process.spawn("cmd", ["/c", "start", authUrl]);
    else if (process.platform == "linux") child_process.spawn("xdg-open", [authUrl]);

    var code = await new Promise((resolve) => {
        let server = http.createServer(async (req, res) => {
            if (req.url.startsWith("/spot-callback")) {
                var code = req.url.match(/code=([^&]+)/)[1];
                res.writeHead(200, {"Content-Type": "text/html"});
                res.end("<script>window.close()</script><h1>Success! You can close this window now.</h1>");
                setTimeout(() => server.close(), 100) // close the server after a short delay, prevents the browser from getting a connection refused error
                return resolve (code);
            } else {
                res.writeHead(200, {"Content-Type": "text/html"});
                res.end("<script>window.close()</script><h1>404 Not Found</h1>");
            }
        })
        server.listen(46851);
    })

    var f = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + (Buffer.from(SPOT_CLIENT_ID + ":" + SPOT_CLIENT_SECRET).toString("base64"))
        },
        body: "grant_type=authorization_code&code=" + code + "&redirect_uri=http%3A%2F%2Flocalhost:46851%2Fspot-callback"
    });
    if (!f.ok) throw new Error("Could not get Spotify token");
    var resp = await f.json();
    spotifyToken = resp.access_token;
    spotifyRefreshToken = resp.refresh_token;
    spotifyTokenExpires = Date.now() + (resp.expires_in * 1000);
    return spotifyToken; 

}

async function callSpotify(url, opts) {
    var f = await fetch(`https://api.spotify.com/v1` + url, {
        ...opts,
        headers: {
            Authorization: "Bearer " + await getSpotifyToken(),
            ...opts?.headers,
        }
    });
    if (f.status == 429) {
        var retry = (parseInt(f.headers.get("retry-after")) + 1) || 5;
        await new Promise((resolve) => setTimeout(resolve, retry * 1000));
        return callSpotify(url, opts);
    }
    if (f.status == 401) {
        spotifyToken = "";
        return callSpotify(url, opts);
    }
    if (!f.ok) throw new Error(url + ": " + f.status +  f.statusText + (await f.text()));
    return await f.json();

}


let matchCache = new Map();
async function getSpotifyTrackMatching(track,i) {
    var { name, artistName, albumName, isrc,original, playParams: { id } } = track;
    if (matchCache.has(id)) {
        let cached = matchCache.get(id);
        console.log([i,original.isrc,original.name,original.artistName,original.albumName,true,cached, "from cache"].map((a) => JSON.stringify(a)).join(","));
        return cached;
    }
    original = original || track;
    var query = "isrc:" + isrc;
    if (!isrc && name && artistName && albumName) query = `track:"${name}" artist:"${artistName}" album:"${albumName}"`;
    if (!isrc && name && artistName) query = `track:"${name}" artist:"${artistName}"`;
    if (!isrc && name) query = `track:"${name}"`;
    let resp = await callSpotify(`/search?q=${encodeURIComponent(query)}&type=track&limit=1`);

    if (!resp.tracks.items.length) return null;
    var responseTrack =  resp.tracks.items[0];
    if (!responseTrack) {
        if (isrc) return await getSpotifyTrackMatching({ original: track, ...track, isrc: null });
        if (albumName) return await getSpotifyTrackMatching({ original: track, ...track, albumName: null });
        console.log([i,original.isrc,original.name,original.artistName,original.albumName,false,"Not found"].map((a) => JSON.stringify(a)).join(","));
        matchCache.set(id, null);
        return null;
    } else {
        console.log([i,original.isrc,original.name,original.artistName,original.albumName,true,responseTrack.id,responseTrack.name,responseTrack.artists.map(a => a.name).join(","),responseTrack.album.name].map((a) => JSON.stringify(a)).join(","));
        matchCache.set(id, responseTrack.uri);
        return responseTrack.uri;
    }
}



let shouldOverwrite = NO_DUPLICATE_EXISTING ? false : PLAYLIST_OVERWRITE;
async function pushSpotifyIDQueue() {
    var set = spotifyIdQueue.slice(0, 99);
    while (true) {
        console.error("Syncing to Spotify...");
        await callSpotify("/playlists/" + SPOT_PLAYLIST_ID + "/tracks", {
            method: shouldOverwrite ? "PUT" : "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({ uris: set })
        })
        shouldOverwrite = false;
        break;
    }
    spotifyIdQueue = spotifyIdQueue.filter((a) => !set.includes(a));

}

/**
 * Returns a list of ISRCs in the Spotify playlist.
 */
async function getSpotifyPlaylistTracks(playlistId) {
    let offset = 0;
    let total = 0;
    let isrcs = new Set();
    while (true) {
        console.error("Fetching Spotify playlist tracks [" + offset + "/ " + total + "]");
        const t = await callSpotify( `/playlists/${playlistId}/tracks?fields=items(track(external_ids.isrc)),next,offset,total&limit=100&offset=${offset}`);
        t.items.forEach((item) => isrcs.add(item.track.external_ids.isrc));
        offset += t.items.length;
        total = t.total;
        if (!t.next) break;
    }
    console.error(`Fetched Spotify playlist tracks [${offset} total, ${isrcs.size} unique]`);
    return isrcs;
}

var amPlaylist = await getAMPlaylistTracks(AM_PLAYLIST_ID);
let spotifyIdQueue = [];
let seenIsrcs = NO_DUPLICATE_EXISTING ? await getSpotifyPlaylistTracks(SPOT_PLAYLIST_ID) : new Set();


console.log("i,isrc,name,artistName,albumName,found,spotifyId,spotifyName,spotifyArtists,spotifyAlbum");
for (var i = 0; i < amPlaylist.length; i++) {
    var track = amPlaylist[i];
    if (track.isrc) {
        if (seenIsrcs.has(track.isrc)) continue;
        seenIsrcs.add(track.isrc);
    }
    var spotTrack = await getSpotifyTrackMatching(track,amPlaylist.length -  i);
    if (spotTrack) spotifyIdQueue.push(spotTrack);
    if (spotifyIdQueue.length >= 100) await pushSpotifyIDQueue();
}
if (spotifyIdQueue.length) await pushSpotifyIDQueue();
