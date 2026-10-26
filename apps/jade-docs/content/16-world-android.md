<!-- id: world-android | parent: using | level: 2 | order: 16 | tags: android, senses, phone, screen, bluetooth, cast, ssh, kiosk, apk -->
# Phone, senses and the Android shell

These need the Android app. Each pack (senses, browser, phone, screen, Sentry, SSH) has a switch in Settings → World that removes it from her prompt; the context cost is shown on each line.

| Tool | What she can do |
| --- | --- |
| `senses` | camera (photo, frames, clip, front/back), microphone (record, level), GPS, every sensor (accelerometer, gyro, magnetic field, light, pressure, proximity, steps) with min/max/mean/std, battery, Wi-Fi, device facts, flashlight, vibration, speech-to-text |
| `look` | open an image (or frames of a video) from the vault and see it |
| `litert` | run any `.tflite` model (float, uint8 and int8, with scale/zero-point handling; images as input) |
| `phone` | alarms, timers, sounds and radio streams, tones, volume, calls and texts (asks first; emergency numbers never), contacts, clipboard, open URLs, launch apps, brightness, Bluetooth (scan, pair, connect), media keys, Chromecast/Google TV casting |
| `screen` | like a screen reader: read the labelled, tappable things on screen and tap, type, scroll, swipe, press nav keys, screenshot, on-screen keyboard. The user must switch Jade on in Android Accessibility settings |
| `browser` | her own browser (a second WebView): open, read, click, type, select, check, scroll, find, screenshot |
| `ssh` | real interactive SSH sessions to saved machines, by name, credentials never visible to her |

## Android classes

`MainActivity` (WebView, permissions, JS bridge), `KeepAliveService`, `ApiServer` (the HTTP API), `World` (senses), `PhoneHost`, `CastHost`/`CastClient`/`FileServer` (casting; the LAN file server), `BrowserHost`, `JadeAccess` (accessibility service), `SentryService`/`SentryEngine`/`SentryCore`/`SentrySystems`/`SentryNotifications`, `SshHost`/`SshClient`/`SshKeys`/`SshWire` (a from-scratch SSH-2 client: ecdh-sha2-nistp256, aes-ctr, hmac-sha2-256; password, keyboard-interactive, publickey), `Disk`/`DiskHost` (the vault folder), `MiniJson`, `AdminReceiver` (kiosk device owner).

## Kiosk mode

Config → App → Background: Jade becomes the home screen, starts at boot and stays in front. With `adb shell dpm set-device-owner app.netrunner.vault/app.netrunner.jade.AdminReceiver` it becomes a full kiosk. Built for a spare PC or tablet (Bliss OS).

## Voice

Hands-free: a Talk button, optional wake phrases, avatar-only mode. Speech-to-text and picture understanding can each use their own provider/model.

## Building the APK

No Android SDK is needed: `android/build-apk.sh` compiles Java against stubs, dexes, packages and signs. See [Build the Android APK](#doc:android-apk).
