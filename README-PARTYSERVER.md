# PartyServer Frontend Integration

This template includes automatic configuration for connecting to your PartyServer backend.

## 🚀 Quick Start

### 1. Environment Configuration

The PartyServer URL is automatically configured with the following priority:

1. **Custom URL**: Set `VITE_PARTYSERVER_URL` in your `.env` file
2. **Default URL**: Uses `<VITE_TAROBASE_APP_ID>-api.poof.new`
3. **Local Fallback**: Uses `localhost:1999` for development

```bash
# .env file (optional - only if you want to override the default)
VITE_PARTYSERVER_URL=my-custom-domain.com
```

### 2. Using PartyServer in Your Components

#### Method 1: Import Configuration (Recommended)

```typescript
import { PARTYSERVER_URL, getPartyServerWsUrl } from '@/lib/config';

// Get WebSocket URL for a room
const wsUrl = getPartyServerWsUrl('my-room-id');
const socket = new WebSocket(wsUrl);
```

#### Method 2: With usePartySocket Hook

```typescript
import usePartySocket from 'partysocket/react';
import { PARTYSERVER_URL } from '@/lib/config';
import { getIdToken } from '@pooflabs/web';

const socket = usePartySocket({
  host: PARTYSERVER_URL,
  room: 'my-room',
  party: 'state',
  query: async () => ({ token: await getIdToken() }), // Optional auth
  onMessage: (event) => {
    const data = JSON.parse(event.data);
    console.log('Received:', data);
  },
});
```

## 📁 Configuration Files

### `/src/lib/config.ts`

Central configuration file that exports:

- `PARTYSERVER_URL` - The PartyServer backend URL
- `getPartyServerWsUrl(roomId, party?)` - Helper to build WebSocket URLs
- `getPartyServerHttpUrl(path?)` - Helper to build HTTP URLs
- `TAROBASE_CONFIG` - Tarobase configuration
- `UI_CONFIG` - UI-related configuration

### `/src/main.tsx`

Uses the centralized configuration for Tarobase initialization.

## 🔧 Available Helpers

### `getPartyServerWsUrl(roomId, party?, protocol?)`

Builds a complete WebSocket URL for connecting to a room.

```typescript
// Basic usage
getPartyServerWsUrl('game-123');

// With custom party
getPartyServerWsUrl('chat-room', 'chat');

// Force protocol
getPartyServerWsUrl('local-test', 'state', 'ws');
```

### `getPartyServerHttpUrl(path?)`

Builds HTTP URLs for API calls to your PartyServer.

```typescript
getPartyServerHttpUrl('/api/rooms');
// → "https://myapp.wish.poof.new/api/rooms"
```

## 🎮 Example Usage

### Basic Chat Example

```typescript
import React, { useState, useEffect } from 'react';
import { getPartyServerWsUrl } from '@/lib/config';

export function Chat({ roomId }: { roomId: string }) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    const ws = new WebSocket(getPartyServerWsUrl(roomId));

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessages(prev => [...prev, data]);
    };

    setSocket(ws);

    return () => ws.close();
  }, [roomId]);

  const sendMessage = (content: string) => {
    socket?.send(JSON.stringify({
      type: 'message',
      content,
      timestamp: Date.now()
    }));
  };

  return (
    <div>
      {/* Your chat UI here */}
    </div>
  );
}
```

### With Authentication

```typescript
import { getIdToken } from '@pooflabs/web';
import { getPartyServerWsUrl } from '@/lib/config';

useEffect(() => {
  const connect = async () => {
    const token = await getIdToken();
    const wsUrl = getPartyServerWsUrl(roomId);
    const ws = new WebSocket(`${wsUrl}?token=${token}`);
    // ... rest of connection logic
  };

  connect();
}, []);
```

## 🌍 Environment Examples

### Development

```bash
# No env vars needed - automatically uses localhost:1999
```

### Staging

```bash
VITE_TAROBASE_APP_ID=my-staging-app
# Uses: my-staging-app-api.poof.new
```

### Production

```bash
VITE_TAROBASE_APP_ID=my-prod-app
VITE_PARTYSERVER_URL=realtime.mycompany.com
# Uses: realtime.mycompany.com
```

## 📝 Notes

- **Automatic Protocol Detection**: Uses `wss://` for production domains, `ws://` for localhost
- **No Hardcoding**: Never hardcode PartyServer URLs in your components
- **Flexible**: Supports any PartyServer deployment (Cloudflare Workers, custom domains, etc.)
- **Type Safe**: All configuration is typed with TypeScript
