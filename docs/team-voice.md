# Team voice

Players in the same team talk to each other with their microphones: in the survival team lobby, the
battle royale squad lobby and the Zombie Wave party. A speaker icon shows who is talking, beside the
name in the lobby and above the character in game.

## How it works

| Part | Where | Does |
|---|---|---|
| Rules and messages | `packages/shared/src/voice.ts` | Message types and their parser (sizes bounded) |
| Room server | `apps/server/src/game/voice.ts` (`VoiceHub`) | The `/voice` WebSocket, on the game port |
| Client | `apps/web/src/lib/voice.ts` | Microphone, one WebRTC connection per teammate, talk detection |
| Interface | `apps/web/src/components/Voice.tsx` | `VoiceControls` (lobbies), `SpeakingIcon` (names), `VoiceDock` (in game) |
| Speaker over heads | `Avatar.setSpeaking` / `GameEngine.showTalking` | Matched by player name |

**What the server does.** It sets up calls but never carries the audio:

- **Sign-in.** The client signs in with a one-use game ticket (`/api/game/ticket`).
- **Rooms.** The server puts the client in the room of its team for that lobby. A room is named
  `survival:<team>`, `battle-royale:<team>` or `waves:<team>`.
- **Relaying.** It relays WebRTC offers, answers and candidates, but only between members of the
  same room.
- **Status.** It passes on who is talking and who has their mic muted.
- **Leaving a team.** Membership is checked every 3 s. A player who leaves the team is removed
  from its voice room.

**How the audio travels.** It goes directly between players, at most four in a team, so each
player connects to everyone else.

**Network help.**

- STUN lets players find a direct route to each other.
- TURN relays the audio when a network blocks direct connections. This happens on some mobile
  networks and many office networks.

**Talk detection.**

- The client measures the loudness of the speech band (120–3800 Hz) every 60 ms.
- It counts as talking above 0.02 RMS.
- Talking ends below 0.012 RMS, after a 350 ms hangover.

**Player settings** (Cài đặt → Chung → Thoại đội):

- Teammates' volume.
- The mic mode: opens on its own when you talk, or push-to-talk on Z, B, N or Caps.
- Muting your mic tells your teammates (they see the mic-off icon).

## Server setup

### 1. Environment

```
VOICE_STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:<server-ip-or-domain>:3478?transport=udp,turn:<server-ip-or-domain>:3478?transport=tcp
TURN_SECRET=<long random string, the same as coturn's static-auth-secret>
```

- **Without `TURN_URLS`/`TURN_SECRET`,** voice still works for most players, but not behind
  strict networks.
- **Credentials.** The game server hands each player TURN credentials valid for 12 hours, in
  coturn's `use-auth-secret` scheme: username `<expiry>:<account>`, password
  HMAC-SHA1(secret, username) in base64.

### 2. coturn (on the same server)

```bash
sudo apt install coturn
```

`/etc/turnserver.conf`:

```
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=<the same TURN_SECRET>
realm=zion.1vibe.link
# The server's public IP (and its private IP after a slash if it is behind NAT):
external-ip=<public-ip>
min-port=49160
max-port=49200
no-multicast-peers
no-cli
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
total-quota=200
```

Then enable and start it:

```bash
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
```

Open these firewall ports:

- **3478** for UDP and TCP;
- **49160–49200** for UDP.

### 3. Reverse proxy

`/voice` shares the game port and host with `/ws`. If a reverse proxy only forwards the `/ws`
upgrade, it must also forward `/voice`. With nginx:

```
location /voice {
  proxy_pass http://127.0.0.1:<game port>;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 120s;
}
```

The desktop app's local proxy already forwards every WebSocket path.

## Tests

| What | How |
|---|---|
| Rooms, relaying only within a team, talking and leaving, refusals, TURN signatures | `apps/server/src/game/voice.test.ts` |
| Real WebRTC between two browser pages: they connect, the audio arrives, talking and mute show, another team hears nothing | `node apps/web/scripts/voice-e2e.mjs`. Before running it, start Edge with `--remote-debugging-port=9444 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. |

## Limits

- **In game, voice continues from the lobby.** You join in the lobby and stay on voice into the
  match, because the page does not reload. Reloading the page leaves voice.
- **The speaker over a head is matched by player name.** Battle royale hides other players' names,
  but the speaker still shows over squadmates.
- **Team size.** A room holds at most 6 sockets. Teams have at most 4 players.
