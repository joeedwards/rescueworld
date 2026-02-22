# RescueWorld Flutter Client

Flutter port of the RescueWorld game client for Android, iOS, and Web.

## Scope

- Reuses existing backend signaling and game WebSocket servers.
- Implements protocol-compatible binary input + snapshot decode.
- Includes playable world rendering, HUD actions, touch joystick, keyboard input, and minimap.
- Supports advanced snapshot fields (shelters, breeder shelters, adoption events, boss mode, team scores).

## Run

From repo root:

```bash
npm run dev:server
npm run dev:flutter:web
```

Optional custom signaling URL:

```bash
cd flutter_client
flutter run -d chrome --dart-define=SIGNALING_WS_URL=ws://localhost:4000
```

## Validation

```bash
cd flutter_client
flutter analyze
flutter test
```
# flutter_client

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.
