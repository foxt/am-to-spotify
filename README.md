# `am-to-spotify`

Quick and dirty script for transfering a playlist on Apple Music to Spotify.

## You'll need:

1. Node.js version 18 or later
2. A Spotify client ID and secret
    1. Visit https://developer.spotify.com/dashboard
    2. Create an application
    3. Fill in app name, description & website with whatever you want
    4. In Redirect URI enter: `http://localhost:46851/spot-callback`
    5. Select `Web API` and agree to the terms
    6. Go to the newly created app's settings
    7. Copy the Client ID and Client Secret
3. An Apple Music playlist ID
    1. Click Share on the playlist, copy URL, and you'll get a string that starts with 'pl.u-' followed by 16 random letters & numbers.
    2. For example, for `https://music.apple.com/gb/playlist/pl.u-GgA5epRuZJLoYPG`, the ID is `pl.u-GgA5epRuZJLoYPG`
4. A Spotify playlist ID
    1. Right click the playlist, and Share, **hold Alt** and select 'Copy Spotify URI', and you'll get a string like `spotify:playlist:1PR4TOMefHGTfmyxzm71bw`
    2. You just want the 22-ish character long string (for example `1PR4TOMefHGTfmyxzm71bw`)

## Usage

1. Download the script as a zip file.
2. Edit the config.js file, filling in the details you collected from the above
3. Run the script with `node index.js`