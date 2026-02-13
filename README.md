# FASTRACK - Online Multiplayer

An online multiplayer version of the classic Fastrack board game by Blue Orange Games.

## 🎮 Play Now

**Live Game:** https://fastrack-game.vercel.app

## 📖 How to Play

1. **Create or Join a Game**
   - One player clicks "Create Game" and shares the 6-character room code
   - Other player clicks "Join Game" and enters the code

2. **Objective**
   - Each player has 5 pucks (red or blue) on their side of the board
   - Get all 5 of your pucks onto the opponent's side to win

3. **Controls**
   - Click/tap on one of your pucks
   - Drag back (like pulling a slingshot) to aim
   - Release to flick the puck
   - Aim for the narrow slot in the center divider to pass through

4. **Gameplay**
   - Both players flick simultaneously (NOT turn-based!)
   - Pucks bounce off walls and each other
   - First to get all pucks across wins

## 🛠️ Technical Stack

- **HTML5 Canvas** for rendering
- **Matter.js** for physics engine
- **PeerJS** for P2P multiplayer networking
- **Web Audio API** for sound effects
- Pure vanilla JavaScript (no framework)

## 🚀 Development

### Local Setup

```bash
# Clone the repository
git clone https://github.com/jylee1286/fastrack-game.git
cd fastrack-game

# Start a local server (any HTTP server works)
python3 -m http.server 8000

# Open in browser
open http://localhost:8000
```

### Project Structure

```
fastrack-game/
├── index.html          # Main page with all screens
├── css/
│   └── style.css       # All styles
├── js/
│   ├── game.js         # Game engine, physics, rendering
│   ├── network.js      # PeerJS multiplayer logic
│   └── ui.js           # UI state management, screens
├── package.json        # For Vercel deployment
└── vercel.json         # Vercel configuration
```

## 🎨 Features

- ✅ Real-time peer-to-peer multiplayer
- ✅ Realistic physics with Matter.js
- ✅ Polished UI with racing aesthetic
- ✅ Sound effects for hits and goals
- ✅ Mobile-responsive design
- ✅ No backend server required
- ✅ Instant room code matchmaking

## 📄 License

MIT

## 👏 Credits

Based on the Fastrack board game by Blue Orange Games.
