# Claude Code Project Guide

This is a WhatsApp to Typebot integration service that acts as a middleware between WhatsApp Cloud API and Typebot conversational flows.

## Project Overview

- **Tech Stack**: TypeScript, Express.js, Prisma (SQLite), Pino logging
- **Purpose**: Forward WhatsApp messages to Typebot and relay responses back
- **Features**: Audio transcription, interactive UI support (buttons/lists), session management

## Architecture

```
WhatsApp Cloud API → Express Webhook → Typebot API → Response Processing → WhatsApp API
                                    ↓
                               SQLite Database
```

## Key Files & Structure

- `src/index.ts` - Main Express server with webhook endpoints
- `src/config.ts` - Environment configuration and constants
- `src/whatsappApi.ts` - WhatsApp Cloud API client functions
- `src/transcriptionService.ts` - Audio transcription (Groq integration)
- `src/localization.ts` - Multi-language message support
- `src/optionMatcher.ts` - Audio-to-option matching logic
- `src/mediaUtils.ts` - WhatsApp media download utilities
- `prisma/schema.prisma` - Database schema (User, Message models)

## Common Development Tasks

### Running the Project
```bash
yarn dev          # Development with hot reload and pretty logs
yarn start        # Production mode
yarn build        # Generate Prisma client and run migrations
```

### Testing Commands
- **Linting**: No linter configured - consider adding eslint
- **Type checking**: `tsc --noEmit` (not in package.json scripts)
- **Database**: Prisma handles migrations with `prisma migrate deploy`

### Environment Setup
Required environment variables in `.env`:
- WhatsApp: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_URL`
- Typebot: `TYPEBOT_ID`, `TYPEBOT_API_KEY`, `TYPEBOT_API_BASE`
- Database: `DATABASE_URL`
- Transcription: `GROQ_API_KEY`, `TRANSCRIPTION_ENABLED`, `TRANSCRIPTION_LANGUAGE`
- Reactions: `QUEUED_REACTION`, `WORKING_REACTION`, `DONE_REACTION`, `ERROR_REACTION`

## Development Patterns

### Message Flow
1. WhatsApp webhook receives message → `/webhook` POST endpoint
2. Extract message content (text/audio/interactive responses)
3. For audio: transcribe using Groq API, match to active choices if applicable
4. Store message in database with user session
5. Forward to Typebot API (continue existing session or start new)
6. Process Typebot response (text, video, buttons, lists)
7. Send formatted response back to WhatsApp
8. Update message reactions (queued → working → done/error)

### Session Management
- Users identified by WhatsApp ID (`waId`)
- Sessions tracked via `sessionId` from Typebot
- Active choice sessions stored in memory for audio matching
- Database stores all messages with session references

### Audio Transcription
- Supports Groq Whisper integration
- Downloads WhatsApp audio files via Media API
- Transcribed text matched against active choice options using Fuse.js
- Fallback handling for failed transcription/matching

## Code Conventions

- TypeScript with strict typing
- Pino for structured JSON logging
- Prisma for database operations
- Environment-based configuration
- Error handling with appropriate WhatsApp reactions
- Comprehensive logging at info/error levels

## Integration Points

- **WhatsApp Cloud API**: Send/receive messages, reactions, media
- **Typebot API**: Start/continue chat sessions
- **Groq API**: Audio transcription service
- **SQLite**: Local message and user persistence

## Debugging

- Logs are JSON formatted (use `pino-pretty` for readable output)
- Full webhook request/response logging enabled
- Message processing includes detailed context logging
- Error states include stack traces and reaction updates

## Current Status

- ✅ Basic text message handling
- ✅ Audio transcription with choice matching
- ✅ Interactive UI support (buttons/lists)
- ✅ Video message support
- ✅ Session persistence
- ✅ Multi-language localization
- ✅ Comprehensive logging