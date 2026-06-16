# PartyServer Template

A flexible PartyServer template for building real-time applications with Cloudflare Workers and Durable Objects.

## Quick Start

This template provides a basic PartyServer setup with optional authentication and message handling patterns. Customize it based on your specific use case.

### Basic Usage

1. **Public Real-time App** (no authentication)
   - The default setup allows anyone to connect
   - Messages are broadcasted to all connected clients
   - Perfect for public chat rooms, live dashboards, or collaborative tools

2. **Authenticated App** (with user validation)
   - Uncomment authentication examples in `src/index.ts`
   - Choose from JWT tokens, wallet addresses, or custom validation
   - See `src/auth_check.ts` for authentication patterns

3. **Tarobase Integration** (persistent storage)
   - Import functions from `./tarobase` (auto-generated)
   - Examples show how to save chat messages, game state, etc.
   - Choose between "real-time first" or "persistence first" patterns

## File Structure

```
src/
├── index.ts              # Main server logic (customize this)
├── auth_check.ts         # Optional auth examples
├── jws.ts               # JWT utilities (if needed)
├── utils/               # Optional utility modules
│   ├── auth-helpers.ts  # Authentication patterns
│   └── message-handler.ts # Message routing examples
└── tarobase.ts          # Auto-generated SDK (DO NOT MODIFY)
```

## Environment Variables

```bash
TAROBASE_APP_ID=your_app_id          # Required
HELIUS_RPC_URL=your_rpc_endpoint     # Optional: defaults to devnet
```

## Message Examples

### Basic Messages

```typescript
// Ping/pong for connection health
{ type: 'ping', timestamp: 1234567890 }
{ type: 'pong', timestamp: 1234567890 }

// Public broadcasting
{ type: 'broadcast', content: 'Hello everyone!' }
{ type: 'message', from: 'conn_123', content: 'Hello!', timestamp: 1234567890 }
```

### Game Messages (uncomment in index.ts)

```typescript
{ type: 'gameAction', action: 'move', data: { x: 10, y: 20 } }
{ type: 'gameUpdate', action: 'move', player: 'conn_123', timestamp: 1234567890 }
```

### Chat Messages (uncomment in index.ts)

```typescript
{ type: 'chat', content: 'Hello everyone!' }
{ type: 'chatMessage', message: { id: '123', content: 'Hello!', from: 'conn_123' } }
```

## Authentication Patterns

### 1. Public Access (Default)

No authentication required - anyone can connect.

### 2. Token-Based

```typescript
// Client connects with token
const ws = new WebSocket('wss://your-app.com/parties/state/room1?token=your_token');
```

### 3. Tarobase Wallet Auth

```typescript
// Requires wallet address and room membership
// Uncomment Tarobase validation in onConnect()
```

## Customization

1. **Modify `src/index.ts`** - Add your application logic
2. **Choose auth pattern** - Uncomment relevant authentication code
3. **Add message types** - Extend the switch statement in `onMessage()`
4. **Storage strategy** - Use Tarobase for persistence or keep state in memory
5. **Custom utilities** - Create additional files in the `utils/` directory

## Use Cases

- **Gaming**: Real-time multiplayer games with state synchronization
- **Chat**: Persistent or ephemeral messaging systems
- **Collaboration**: Real-time document editing, whiteboards
- **Dashboards**: Live data streaming and updates
- **Custom**: Any real-time application you can imagine

## Deployment

The template uses Cloudflare Workers and is deployed via Wrangler:

```bash
bun run build
bun run deploy
```

Configuration is handled through `wrangler.toml.template` which gets processed during deployment.
