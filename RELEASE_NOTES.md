# Release Notes

## v0.1.3 (2024-12-30)

### New Features
- **feat**: Automatic conversation monitoring and introduction messages - Added proactive monitoring for new XMTP conversations with automatic introduction messages for enhanced user experience

### Technical Improvements
- Added `monitorNewConversations()` function for real-time conversation detection
- Added `handleNewConversation()` function for processing new conversation introductions  
- Enhanced conversation tracking with `introducedConversations` Set to prevent duplicate introductions
- Improved parallel processing with conversation monitoring running alongside message streaming
- Added proper error handling for introduction message failures with fallback messages

**Full Changelog**: https://github.com/crestalnetwork/intentkit-xmtp-agent/compare/v0.1.2...v0.1.3

---

## v0.1.2 (2024-12-30)

### Improvements
- **improve**: Enhanced IntentKit integration and XMTP message processing - Better handling of IntentKit responses with improved message processing and error handling
- **fix**: Remove skill params from display - Cleaner skill call presentation without exposing internal parameters
- **doc**: Update LLM documentation - Updated documentation for better LLM integration guidance

**Full Changelog**: https://github.com/crestalnetwork/intentkit-xmtp-agent/compare/v0.1.1...v0.1.2

---

## v0.1.1 (2024-12-28)

### Bug Fixes
- **fix**: use wallet address as user_id instead of inbox_id for intentkit integration - This improves user identification by using the actual wallet address rather than the internal inbox ID

### Maintenance
- **chore**: update dependencies and remove package-lock.json

**Full Changelog**: https://github.com/crestalnetwork/intentkit-xmtp-agent/compare/v0.1.0...v0.1.1

---

## v0.1.0 (Previous Release)

Initial release with XMTP agent functionality.
