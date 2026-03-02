# Zwift LED Integration - Research Document

**Created:** 2026-02-22  
**Updated:** 2026-03-02  
**Status:** Research & Planning Phase  

---

## Overview

An ioBroker adapter that connects Zwift workout data with smart home LED strips to create an immersive indoor cycling experience. LED colors and patterns respond in real-time to workout intensity, heart rate zones, and performance metrics.

---

## Concept

Transform indoor cycling workouts into visually engaging experiences by syncing LED strips with Zwift workout data:

- **High-intensity zones** → Red, pulsing LEDs (warning, effort)
- **Moderate intensity** → Orange/yellow (sustained effort)
- **Low-intensity/recovery** → Cool colors: blue/green (relaxation)
- **Cadence/power feedback** → Visual rhythm matching workout tempo
- **Heart rate zones** → Color transitions based on HR zones

---

## Technical Architecture

### System Flow

```
Zwift App → Zwift API → ioBroker.zwift Adapter → ioBroker State Tree → LED Controller (WLED/etc.)
```

### Components

1. **Zwift API Integration**
   - Real-time workout data stream
   - all available data points
   - Authentication & session management

2. **ioBroker.zwift Adapter**
   - Poll Zwift API for live workout data
   - Parse and normalize
   - Publish to ioBroker state tree

3. **ioBroker State Tree**
   - Expose workout data as states
   - Integration point for other adapters‚

---

## Design Goals

### Why This Project Fits

- ✅ **Builder identity** — Creating a new product from scratch
- ✅ **Compound system** — Software + hardware + user experience
- ✅ **Real-world problem** — Makes indoor training more engaging and motivating
- ✅ **Combines interests** — Cycling/Zwift + smart home automation + software development
- ✅ **Expandable platform** — Foundation for more immersive features

### User Experience Principles

1. **Immediate feedback** — LED changes should feel instant (<100ms lag)
2. **Clear zone mapping** — Intuitive color coding (red = hard, blue = easy)
3. **Configurable** — Users can customize color schemes and thresholds
4. **Non-intrusive** — Can be disabled/dimmed without affecting workout
5. **Progressive enhancement** — Works standalone, but integrates with broader smart home

---

## Functional Requirements

### Core Features (MVP)

- [ ] Connect to Zwift API
- [ ] Read real-time workout data (power, HR, cadence, zone)
- [ ] Map workout zones to LED color schemes
- [ ] Publish LED commands to ioBroker states
- [ ] Basic configuration UI (color mappings, thresholds)

### Enhanced Features (V2+)

- [ ] Smooth color transitions (fading between zones)
- [ ] Cadence-based pulsing/flashing effects
- [ ] Power meter visualization (brightness = power output)
- [ ] Achievement celebrations (special patterns on PRs, segment wins)
- [ ] Multi-rider support (different LED zones for different riders)

### Future Expansions

- Smart fan control (speed matches effort level)
- Temperature adjustment (cooling during intense efforts)
- Sound effects or music tempo sync
- Social features (LED patterns sync with group rides)
- Gamification (achievements unlock new LED patterns)

---

## Technical Implementation Plan

### Phase 1: Zwift API Research & Testing
- [ ] Review Zwift API documentation
- [ ] Test authentication flow
- [ ] Verify real-time data availability
- [ ] Document API rate limits and constraints

### Phase 2: ioBroker Adapter Scaffold
- [ ] Generate adapter boilerplate
- [ ] Set up state tree structure
- [ ] Implement basic configuration UI
- [ ] Add logging and error handling

### Phase 3: Zwift Integration
- [ ] Implement API client
- [ ] Handle authentication and session management
- [ ] Poll workout data at appropriate interval
- [ ] Parse and normalize metrics

### Phase 4: LED Mapping Logic
- [ ] Define zone → color mapping
- [ ] Implement transition logic
- [ ] Add user-configurable presets
- [ ] Test with various workout types

### Phase 5: Testing & Refinement
- [ ] Test with real Zwift workouts
- [ ] Measure latency (API → LED change)
- [ ] Optimize polling frequency
- [ ] Refine color schemes based on feedback

---

## Known Challenges

### Technical
- **API access** — Zwift doesn't have an official public API; may need to use community-documented endpoints
- **Latency** — Need to minimize delay between workout change and LED response
- **Polling frequency** — Balance between responsiveness and API rate limits
- **Authentication** — Handling Zwift login credentials securely

### UX
- **Color fatigue** — Too many rapid changes could be distracting
- **Individual preferences** — What's motivating for one rider may annoy another
- **Lighting context** — Need to work in various room lighting conditions

---

## Resources & References

### Zwift API
- Community-documented API endpoints (to be added)
- Authentication flow documentation
- Real-time data stream formats

### LED Controllers
- **WLED:** https://kno.wled.ge/ — Popular ESP32/ESP8266 LED controller firmware
- MQTT interface documentation
- HTTP API reference

### ioBroker Development
- Adapter development guide: https://github.com/ioBroker/ioBroker.docs
- State tree best practices
- Configuration UI patterns (jsonConfig)

---

## Success Metrics

- **Responsiveness:** LED changes within 100ms of workout zone change
- **Stability:** No crashes during typical 60-minute workout
- **Configurability:** 3+ color preset options for different preferences
- **User adoption:** Positive feedback from 5+ beta testers

---

## Timeline

**Phase 1-2 (Setup):** 1-2 weeks  
**Phase 3-4 (Core features):** 2-3 weeks  
**Phase 5 (Testing):** 1 week  

**Total estimated time:** 4-6 weeks (part-time development)

---

**Note:** This is a living document. Update as research progresses and requirements evolve.
