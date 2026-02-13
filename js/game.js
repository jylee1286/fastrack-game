// Game Engine - Physics and Rendering
class FastrackGame {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.aimIndicator = document.getElementById('aim-indicator');
        
        // Game state
        this.isHost = false;
        this.gameStarted = false;
        this.allPucks = []; // All pucks in one array
        this.goldenGoal = false;
        this.countdown = 0; // For 3-2-1-GO countdown
        
        // Timer
        this.gameDuration = 60; // 1 minute
        this.timeRemaining = 60;
        this.timerInterval = null;
        
        // Colors
        this.hostColor = '#ff3333';
        this.joinerColor = '#3366ff';
        
        // Physics
        this.engine = null;
        this.world = null;
        this.runner = null;
        
        // Dimensions
        this.boardWidth = 800;
        this.boardHeight = 600;
        this.puckRadius = 20;
        this.slotWidth = this.puckRadius * 3;
        this.wallThickness = 10;
        
        // Interaction
        this.selectedPuck = null;
        this.dragStart = null;
        this.mousePos = { x: 0, y: 0 };
        
        // Network sync
        this.lastSyncTime = 0;
        this.syncInterval = 33;
        
        // Sound
        this.audioContext = null;
        
        // Visual effects
        this.particles = [];
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.slotGlowPhase = 0;
        this.puckPositionHistory = new Map(); // For smooth interpolation
        this.puckTrails = []; // For motion trails
        this.impactEffects = []; // Flash/ring effects
        
        this.setupCanvas();
        this.setupInput();
    }
    
    get myColor() {
        return this.isHost ? this.hostColor : this.joinerColor;
    }
    
    get opponentColor() {
        return this.isHost ? this.joinerColor : this.hostColor;
    }
    
    // Every player always sees THEIR side at the bottom of the screen
    // We flip rendering for the joiner
    get mySideIsBottom() {
        return true; // Always true — we flip the board for the joiner
    }
    
    setupCanvas() {
        const resizeCanvas = () => {
            const maxWidth = window.innerWidth;
            const maxHeight = window.innerHeight - 120;
            const scale = Math.min(maxWidth / this.boardWidth, maxHeight / this.boardHeight, 1);
            
            this.canvas.width = this.boardWidth;
            this.canvas.height = this.boardHeight;
            this.canvas.style.width = (this.boardWidth * scale) + 'px';
            this.canvas.style.height = (this.boardHeight * scale) + 'px';
        };
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }
    
    setupInput() {
        this.canvas.addEventListener('mousedown', (e) => this.handlePointerDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handlePointerUp(e));
        
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handlePointerDown(e.touches[0]);
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handlePointerMove(e.touches[0]);
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handlePointerUp(e);
        }, { passive: false });
    }
    
    startGame(isHost) {
        this.isHost = isHost;
        this.gameStarted = true;
        this.goldenGoal = false;
        this.timeRemaining = this.gameDuration;
        this.countdown = 3;
        
        // Update UI colors to match actual player colors
        this.updateScoreColors();
        
        // Initialize audio
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Initialize Matter.js
        this.engine = Matter.Engine.create();
        this.world = this.engine.world;
        this.world.gravity.y = 0;
        
        // Collision events for sounds and effects
        Matter.Events.on(this.engine, 'collisionStart', (event) => {
            for (const pair of event.pairs) {
                const speed = Math.sqrt(
                    Math.pow((pair.bodyA.velocity?.x || 0) - (pair.bodyB.velocity?.x || 0), 2) +
                    Math.pow((pair.bodyA.velocity?.y || 0) - (pair.bodyB.velocity?.y || 0), 2)
                );
                if (speed > 1) {
                    // Determine collision type
                    const isPuckPuck = pair.bodyA.label === 'puck' && pair.bodyB.label === 'puck';
                    const isWallHit = pair.bodyA.label === 'wall' || pair.bodyB.label === 'wall';
                    
                    if (isPuckPuck) {
                        this.playCollisionSound(500 + speed * 40, 0.06, 'sine');
                        const pos = pair.bodyA.label === 'puck' ? pair.bodyA.position : pair.bodyB.position;
                        this.addImpactEffect(pos.x, pos.y, speed);
                    } else if (isWallHit) {
                        this.playCollisionSound(180 + speed * 20, 0.1, 'triangle');
                        const pos = pair.bodyA.label === 'puck' ? pair.bodyA.position : pair.bodyB.position;
                        this.addImpactEffect(pos.x, pos.y, speed);
                        if (speed > 8) {
                            this.addScreenShake(speed * 0.3);
                        }
                    }
                }
            }
        });
        
        this.createBoard();
        this.createPucks(5);
        
        // Only host runs physics — joiner receives state from host
        this.runner = Matter.Runner.create();
        if (this.isHost) {
            Matter.Runner.run(this.runner, this.engine);
        }
        
        // Start render loop
        this.render();
        
        // 3-2-1-GO! Countdown
        this.startCountdown();
        
        // Network handler
        network.onDataReceived = (data) => this.handleNetworkData(data);
    }
    
    startCountdown() {
        const countdownInterval = setInterval(() => {
            if (this.countdown > 0) {
                this.playSound(600, 0.1);
                this.countdown--;
            } else {
                clearInterval(countdownInterval);
                this.playSound(800, 0.15); // GO!
                this.startTimer();
            }
        }, 1000);
    }
    
    updateScoreColors() {
        const youEl = document.querySelector('.player-you');
        const oppEl = document.querySelector('.player-opponent');
        if (youEl) youEl.style.color = this.myColor;
        if (oppEl) oppEl.style.color = this.opponentColor;
    }
    
    startTimer() {
        // Create or update timer display
        let timerEl = document.getElementById('game-timer');
        if (!timerEl) {
            timerEl = document.createElement('div');
            timerEl.id = 'game-timer';
            timerEl.className = 'game-timer';
            document.getElementById('game-ui').appendChild(timerEl);
        }
        timerEl.textContent = this.formatTime(this.timeRemaining);
        
        this.timerInterval = setInterval(() => {
            this.timeRemaining--;
            timerEl.textContent = this.formatTime(this.timeRemaining);
            
            // Tick-tock sound and flash when under 10 seconds
            if (this.timeRemaining <= 10) {
                timerEl.classList.toggle('timer-urgent');
                this.playTickSound();
            }
            
            if (this.timeRemaining <= 0) {
                clearInterval(this.timerInterval);
                this.handleTimeUp();
            }
        }, 1000);
    }
    
    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
    
    handleTimeUp() {
        const centerY = this.boardHeight / 2;
        let pucksOnMySide = 0;
        let pucksOnOpponentSide = 0;
        
        for (const puck of this.allPucks) {
            const onBottom = puck.position.y > centerY;
            
            if (this.isHost) {
                if (onBottom) pucksOnMySide++;
                else pucksOnOpponentSide++;
            } else {
                if (!onBottom) pucksOnMySide++;
                else pucksOnOpponentSide++;
            }
        }
        
        if (pucksOnMySide === pucksOnOpponentSide) {
            // TIE — golden goal!
            this.startGoldenGoal();
        } else if (pucksOnMySide < pucksOnOpponentSide) {
            // Fewer pucks on my side = I win (opponent has more)
            this.endGame(true, `Time's up! You had ${pucksOnMySide} pucks, opponent had ${pucksOnOpponentSide}.`);
        } else {
            this.endGame(false, `Time's up! You had ${pucksOnMySide} pucks, opponent had ${pucksOnOpponentSide}.`);
        }
    }
    
    startGoldenGoal() {
        this.goldenGoal = true;
        
        // Remove all existing pucks
        for (const puck of this.allPucks) {
            Matter.World.remove(this.world, puck);
        }
        this.allPucks = [];
        
        // Create 1 puck per player
        this.createPucks(1);
        
        // Reset timer for golden goal (30 seconds)
        this.timeRemaining = 30;
        
        let timerEl = document.getElementById('game-timer');
        if (timerEl) timerEl.textContent = this.formatTime(this.timeRemaining);
        
        // Show golden goal banner
        this.showBanner('⚡ GOLDEN GOAL ⚡', 'First to get their puck through wins!');
        
        // Notify opponent
        network.send({ type: 'goldenGoal' });
        
        // Restart timer
        this.timerInterval = setInterval(() => {
            this.timeRemaining--;
            if (timerEl) timerEl.textContent = this.formatTime(this.timeRemaining);
            if (this.timeRemaining <= 10) {
                timerEl?.classList.toggle('timer-urgent');
            }
            if (this.timeRemaining <= 0) {
                clearInterval(this.timerInterval);
                // Golden goal timeout = draw
                this.endGame(false, "Golden goal expired — it's a draw!");
            }
        }, 1000);
    }
    
    showBanner(title, subtitle) {
        let banner = document.getElementById('game-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'game-banner';
            banner.className = 'game-banner';
            document.getElementById('game-screen').appendChild(banner);
        }
        banner.innerHTML = `<div class="banner-title">${title}</div><div class="banner-sub">${subtitle}</div>`;
        banner.style.display = 'flex';
        
        setTimeout(() => {
            banner.style.display = 'none';
        }, 3000);
    }
    
    createBoard() {
        const { Bodies } = Matter;
        const w = this.boardWidth;
        const h = this.boardHeight;
        const t = this.wallThickness;
        
        const wallOptions = { 
            isStatic: true, 
            restitution: 1.0,   // Perfect bounce off walls
            friction: 0.0,      // No friction on walls — clean rebounds
            label: 'wall'
        };
        
        const topWall = Bodies.rectangle(w / 2, t / 2, w, t, wallOptions);
        const bottomWall = Bodies.rectangle(w / 2, h - t / 2, w, t, wallOptions);
        const leftWall = Bodies.rectangle(t / 2, h / 2, t, h, wallOptions);
        const rightWall = Bodies.rectangle(w - t / 2, h / 2, t, h, wallOptions);
        
        // Center divider with slot
        const dividerY = h / 2;
        const leftDividerWidth = w / 2 - this.slotWidth / 2;
        const rightDividerWidth = w / 2 - this.slotWidth / 2;
        
        const leftDivider = Bodies.rectangle(
            leftDividerWidth / 2,
            dividerY,
            leftDividerWidth,
            t,
            wallOptions
        );
        
        const rightDivider = Bodies.rectangle(
            w - rightDividerWidth / 2,
            dividerY,
            rightDividerWidth,
            t,
            wallOptions
        );
        
        Matter.World.add(this.world, [
            topWall, bottomWall, leftWall, rightWall,
            leftDivider, rightDivider
        ]);
    }
    
    createPucks(count) {
        const { Bodies } = Matter;
        const centerY = this.boardHeight / 2;
        
        // Host's pucks start on bottom, joiner's on top
        // Each puck starts as the color of the player whose side it's on
        const spacing = this.boardWidth / (count + 1);
        
        for (let i = 0; i < count; i++) {
            const x = spacing * (i + 1);
            
            // Puck on bottom side (host's side) — starts as host's color
            const bottomPuck = Bodies.circle(x, centerY + 100 + Math.random() * 50, this.puckRadius, {
                restitution: 0.95,   // High bounce between pucks
                friction: 0.0,       // No surface friction — clean slides
                frictionAir: 0.015,  // Slight air resistance so they eventually stop
                density: 0.05,
                label: 'puck'
            });
            bottomPuck.ownerColor = this.hostColor;
            bottomPuck.puckIndex = i;
            bottomPuck.side = 'bottom';
            this.allPucks.push(bottomPuck);
            Matter.World.add(this.world, bottomPuck);
            
            // Puck on top side (joiner's side) — starts as joiner's color
            const topPuck = Bodies.circle(x, centerY - 100 - Math.random() * 50, this.puckRadius, {
                restitution: 0.95,
                friction: 0.0,
                frictionAir: 0.015,
                density: 0.05,
                label: 'puck'
            });
            topPuck.ownerColor = this.joinerColor;
            topPuck.puckIndex = i + count;
            topPuck.side = 'top';
            this.allPucks.push(topPuck);
            Matter.World.add(this.world, topPuck);
        }
    }
    
    // Determine if a puck is currently on my side and thus I can move it
    // In game coords: host's side = bottom, joiner's side = top
    canIMovePuck(puck) {
        const centerY = this.boardHeight / 2;
        if (this.isHost) {
            return puck.position.y > centerY; // Host controls bottom
        } else {
            return puck.position.y < centerY; // Joiner controls top
        }
    }
    
    // Update puck colors based on which side they're on
    updatePuckOwnership() {
        const centerY = this.boardHeight / 2;
        
        for (const puck of this.allPucks) {
            const onBottom = puck.position.y > centerY;
            const prevColor = puck.ownerColor;
            
            if (onBottom) {
                puck.ownerColor = this.hostColor;
            } else {
                puck.ownerColor = this.joinerColor;
            }
            
            // Play goal sound and particles if the puck crossed sides
            if (prevColor !== puck.ownerColor) {
                this.playGoalSound();
                this.addParticles(puck.position.x, centerY, puck.ownerColor, 20);
                network.send({ type: 'goal' });
            }
        }
    }
    
    // Convert screen coords to game coords (flip Y for joiner)
    screenToGame(screenX, screenY) {
        if (!this.isHost) {
            return { x: screenX, y: this.boardHeight - screenY };
        }
        return { x: screenX, y: screenY };
    }
    
    // Convert game coords to screen coords (flip Y for joiner)
    gameToScreen(gameX, gameY) {
        if (!this.isHost) {
            return { x: gameX, y: this.boardHeight - gameY };
        }
        return { x: gameX, y: gameY };
    }
    
    handlePointerDown(e) {
        if (!this.gameStarted) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.boardWidth / rect.width;
        const scaleY = this.boardHeight / rect.height;
        const rawX = (e.clientX - rect.left) * scaleX;
        const rawY = (e.clientY - rect.top) * scaleY;
        const { x, y } = this.screenToGame(rawX, rawY);
        
        // Check if clicked on a puck that's on MY side
        for (const puck of this.allPucks) {
            if (!this.canIMovePuck(puck)) continue;
            
            const dx = puck.position.x - x;
            const dy = puck.position.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < this.puckRadius * 1.5) {
                this.selectedPuck = puck;
                this.dragStart = { x, y };
                this.mousePos = { x, y };
                break;
            }
        }
    }
    
    handlePointerMove(e) {
        if (!this.selectedPuck) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.boardWidth / rect.width;
        const scaleY = this.boardHeight / rect.height;
        const rawX = (e.clientX - rect.left) * scaleX;
        const rawY = (e.clientY - rect.top) * scaleY;
        const { x, y } = this.screenToGame(rawX, rawY);
        this.mousePos = { x, y };
    }
    
    handlePointerUp(e) {
        if (!this.selectedPuck) return;
        
        const dx = this.dragStart.x - this.mousePos.x;
        const dy = this.dragStart.y - this.mousePos.y;
        const power = Math.sqrt(dx * dx + dy * dy);
        const maxPower = 150;
        const scale = Math.min(power / maxPower, 1) * 0.5;
        
        const vx = dx * scale;
        const vy = dy * scale;
        
        if (this.isHost) {
            // Host applies physics directly
            Matter.Body.setVelocity(this.selectedPuck, { x: vx, y: vy });
        } else {
            // Joiner sends flick command to host (host applies physics)
            network.send({
                type: 'flick',
                index: this.selectedPuck.puckIndex,
                vx: vx,
                vy: vy
            });
        }
        
        this.playSound(200 + power * 2, 0.1);
        
        // Haptic feedback on mobile
        if (navigator.vibrate && power > 30) {
            navigator.vibrate(Math.min(power, 50));
        }
        
        this.selectedPuck = null;
        this.dragStart = null;
        this.aimIndicator.style.display = 'none';
    }
    
    handleNetworkData(data) {
        if (data.type === 'state') {
            // Joiner receives authoritative state from host
            if (!this.isHost && data.pucks) {
                data.pucks.forEach((p, i) => {
                    if (i < this.allPucks.length) {
                        Matter.Body.setPosition(this.allPucks[i], { x: p.x, y: p.y });
                        Matter.Body.setVelocity(this.allPucks[i], { x: p.vx, y: p.vy });
                        this.allPucks[i].ownerColor = p.color;
                    }
                });
            }
        } else if (data.type === 'flick') {
            // Host receives flick command from joiner
            const puck = this.allPucks.find(p => p.puckIndex === data.index);
            if (puck) {
                Matter.Body.setVelocity(puck, { x: data.vx, y: data.vy });
            }
        } else if (data.type === 'goal') {
            this.playSound(600, 0.15);
        } else if (data.type === 'goldenGoal') {
            // Opponent triggered golden goal — we should already be in sync
        }
    }
    
    syncPucks() {
        // Only the host sends state updates
        if (!this.isHost) return;
        
        const now = Date.now();
        if (now - this.lastSyncTime < this.syncInterval) return;
        this.lastSyncTime = now;
        
        const pucks = this.allPucks.map(p => ({
            x: p.position.x,
            y: p.position.y,
            vx: p.velocity.x,
            vy: p.velocity.y,
            color: p.ownerColor
        }));
        network.send({ type: 'state', pucks });
    }
    
    checkWinCondition() {
        this.updatePuckOwnership();
        
        const centerY = this.boardHeight / 2;
        let pucksOnMySide = 0;
        let pucksOnOpponentSide = 0;
        
        for (const puck of this.allPucks) {
            const onBottom = puck.position.y > centerY;
            
            if (this.isHost) {
                if (onBottom) pucksOnMySide++;
                else pucksOnOpponentSide++;
            } else {
                if (!onBottom) pucksOnMySide++;
                else pucksOnOpponentSide++;
            }
        }
        
        // Update score display
        document.getElementById('your-score').textContent = pucksOnMySide;
        document.getElementById('opponent-score').textContent = pucksOnOpponentSide;
        
        // In golden goal, first to clear their side wins
        if (this.goldenGoal && pucksOnMySide === 0) {
            this.endGame(true, 'Golden goal — you cleared your side!');
        }
    }
    
    // Keep pucks in bounds
    constrainPucks() {
        const t = this.wallThickness;
        const r = this.puckRadius;
        
        for (const puck of this.allPucks) {
            let x = puck.position.x;
            let y = puck.position.y;
            let clamped = false;
            
            if (x < t + r) { x = t + r; clamped = true; }
            if (x > this.boardWidth - t - r) { x = this.boardWidth - t - r; clamped = true; }
            if (y < t + r) { y = t + r; clamped = true; }
            if (y > this.boardHeight - t - r) { y = this.boardHeight - t - r; clamped = true; }
            
            if (clamped) {
                Matter.Body.setPosition(puck, { x, y });
            }
        }
    }
    
    endGame(won, detail) {
        this.gameStarted = false;
        if (this.runner) Matter.Runner.stop(this.runner);
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        showScreen('result-screen');
        const resultTitle = document.getElementById('result-title');
        resultTitle.textContent = won ? 'YOU WIN!' : 'YOU LOSE!';
        resultTitle.className = 'result-title ' + (won ? 'win' : 'lose');
        
        // Show detail text
        let detailEl = document.getElementById('result-detail');
        if (!detailEl) {
            detailEl = document.createElement('p');
            detailEl.id = 'result-detail';
            detailEl.className = 'result-detail';
            resultTitle.parentNode.insertBefore(detailEl, resultTitle.nextSibling);
        }
        detailEl.textContent = detail || '';
        
        // Play victory or defeat sound
        if (won) {
            this.playVictorySound();
        } else {
            this.playDefeatSound();
        }
    }
    
    playSound(frequency, duration) {
        if (!this.audioContext) return;
        try {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            osc.connect(gain);
            gain.connect(this.audioContext.destination);
            osc.frequency.value = frequency;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
            osc.start(this.audioContext.currentTime);
            osc.stop(this.audioContext.currentTime + duration);
        } catch (e) {}
    }
    
    playCollisionSound(frequency, duration, type = 'sine') {
        if (!this.audioContext) return;
        try {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            osc.connect(gain);
            gain.connect(this.audioContext.destination);
            osc.frequency.value = frequency;
            osc.type = type;
            gain.gain.setValueAtTime(0.08, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
            osc.start(this.audioContext.currentTime);
            osc.stop(this.audioContext.currentTime + duration);
        } catch (e) {}
    }
    
    playGoalSound() {
        if (!this.audioContext) return;
        try {
            // Whoosh + chime
            const osc1 = this.audioContext.createOscillator();
            const gain1 = this.audioContext.createGain();
            osc1.connect(gain1);
            gain1.connect(this.audioContext.destination);
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(400, this.audioContext.currentTime);
            osc1.frequency.exponentialRampToValueAtTime(800, this.audioContext.currentTime + 0.2);
            gain1.gain.setValueAtTime(0.15, this.audioContext.currentTime);
            gain1.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
            osc1.start(this.audioContext.currentTime);
            osc1.stop(this.audioContext.currentTime + 0.3);
            
            // Chime
            setTimeout(() => {
                const osc2 = this.audioContext.createOscillator();
                const gain2 = this.audioContext.createGain();
                osc2.connect(gain2);
                gain2.connect(this.audioContext.destination);
                osc2.frequency.value = 1200;
                osc2.type = 'sine';
                gain2.gain.setValueAtTime(0.1, this.audioContext.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.4);
                osc2.start(this.audioContext.currentTime);
                osc2.stop(this.audioContext.currentTime + 0.4);
            }, 100);
        } catch (e) {}
    }
    
    playVictorySound() {
        if (!this.audioContext) return;
        try {
            const notes = [523, 659, 784, 1047]; // C E G C (triumphant)
            notes.forEach((freq, i) => {
                setTimeout(() => {
                    const osc = this.audioContext.createOscillator();
                    const gain = this.audioContext.createGain();
                    osc.connect(gain);
                    gain.connect(this.audioContext.destination);
                    osc.frequency.value = freq;
                    osc.type = 'sine';
                    gain.gain.setValueAtTime(0.15, this.audioContext.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.4);
                    osc.start(this.audioContext.currentTime);
                    osc.stop(this.audioContext.currentTime + 0.4);
                }, i * 150);
            });
        } catch (e) {}
    }
    
    playDefeatSound() {
        if (!this.audioContext) return;
        try {
            const notes = [523, 392, 330, 262]; // C G E C (descending)
            notes.forEach((freq, i) => {
                setTimeout(() => {
                    const osc = this.audioContext.createOscillator();
                    const gain = this.audioContext.createGain();
                    osc.connect(gain);
                    gain.connect(this.audioContext.destination);
                    osc.frequency.value = freq;
                    osc.type = 'triangle';
                    gain.gain.setValueAtTime(0.12, this.audioContext.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
                    osc.start(this.audioContext.currentTime);
                    osc.stop(this.audioContext.currentTime + 0.5);
                }, i * 200);
            });
        } catch (e) {}
    }
    
    playTickSound() {
        if (!this.audioContext) return;
        try {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            osc.connect(gain);
            gain.connect(this.audioContext.destination);
            osc.frequency.value = 800;
            osc.type = 'square';
            gain.gain.setValueAtTime(0.05, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.05);
            osc.start(this.audioContext.currentTime);
            osc.stop(this.audioContext.currentTime + 0.05);
        } catch (e) {}
    }
    
    addParticles(x, y, color, count = 15) {
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const speed = 2 + Math.random() * 3;
            this.particles.push({
                x, y, color,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                size: 3 + Math.random() * 3
            });
        }
    }
    
    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }
    
    drawParticles() {
        const ctx = this.ctx;
        for (const p of this.particles) {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
    
    addImpactEffect(x, y, intensity) {
        this.impactEffects.push({
            x, y,
            radius: 5,
            maxRadius: 15 + intensity * 2,
            life: 1.0
        });
    }
    
    updateImpactEffects() {
        for (let i = this.impactEffects.length - 1; i >= 0; i--) {
            const e = this.impactEffects[i];
            e.radius += (e.maxRadius - e.radius) * 0.2;
            e.life -= 0.05;
            if (e.life <= 0) {
                this.impactEffects.splice(i, 1);
            }
        }
    }
    
    drawImpactEffects() {
        const ctx = this.ctx;
        for (const e of this.impactEffects) {
            ctx.globalAlpha = e.life * 0.5;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = e.life * 0.2;
            ctx.strokeStyle = '#ffcc00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius * 1.3, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
    }
    
    addScreenShake(intensity) {
        this.screenShake.intensity = Math.min(intensity, 10);
    }
    
    updateScreenShake() {
        if (this.screenShake.intensity > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.intensity *= 0.9;
            if (this.screenShake.intensity < 0.1) {
                this.screenShake.intensity = 0;
                this.screenShake.x = 0;
                this.screenShake.y = 0;
            }
        }
    }
    
    addPuckTrail(x, y, color) {
        this.puckTrails.push({
            x, y, color,
            life: 1.0,
            radius: this.puckRadius * 0.8
        });
        // Limit trail count
        if (this.puckTrails.length > 50) {
            this.puckTrails.shift();
        }
    }
    
    updatePuckTrails() {
        for (let i = this.puckTrails.length - 1; i >= 0; i--) {
            const t = this.puckTrails[i];
            t.life -= 0.05;
            if (t.life <= 0) {
                this.puckTrails.splice(i, 1);
            }
        }
    }
    
    drawPuckTrails() {
        const ctx = this.ctx;
        for (const t of this.puckTrails) {
            ctx.globalAlpha = t.life * 0.3;
            ctx.fillStyle = t.color;
            ctx.beginPath();
            ctx.arc(t.x, t.y, t.radius * t.life, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
    
    render() {
        if (!this.gameStarted) return;
        
        const ctx = this.ctx;
        const w = this.boardWidth;
        const h = this.boardHeight;
        
        // Update visual effects
        this.updateParticles();
        this.updateImpactEffects();
        this.updateScreenShake();
        this.updatePuckTrails();
        this.slotGlowPhase += 0.03;
        
        // Keep pucks in bounds (host only — joiner gets state from host)
        if (this.isHost) this.constrainPucks();
        
        // Apply screen shake
        ctx.save();
        ctx.translate(this.screenShake.x, this.screenShake.y);
        
        // Flip canvas for joiner so their side is at bottom
        if (!this.isHost) {
            ctx.translate(0, h);
            ctx.scale(1, -1);
        }
        
        // Premium wood background with gradient
        const woodGrad = ctx.createLinearGradient(0, 0, 0, h);
        woodGrad.addColorStop(0, '#C4933F');
        woodGrad.addColorStop(0.5, '#D4A558');
        woodGrad.addColorStop(1, '#B8812A');
        ctx.fillStyle = woodGrad;
        ctx.fillRect(0, 0, w, h);
        
        // Enhanced wood grain texture
        ctx.strokeStyle = 'rgba(160, 120, 40, 0.2)';
        ctx.lineWidth = 2;
        for (let i = 0; i < h; i += 6) {
            const offset = Math.sin(i * 0.05) * 5;
            ctx.globalAlpha = 0.15 + Math.sin(i * 0.1) * 0.05;
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.bezierCurveTo(w/3, i + offset, 2*w/3, i - offset, w, i);
            ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
        
        // Wood knots
        for (let i = 0; i < 8; i++) {
            const x = (i % 4) * (w / 4) + w / 8;
            const y = Math.floor(i / 4) * (h / 2) + h / 4;
            ctx.fillStyle = 'rgba(100, 70, 30, 0.1)';
            ctx.beginPath();
            ctx.ellipse(x, y, 20 + Math.random() * 10, 10 + Math.random() * 5, Math.random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // My side highlight (bottom half is always "my side" visually)
        const centerY = h / 2;
        ctx.fillStyle = 'rgba(255, 50, 50, 0.03)';
        ctx.fillRect(0, centerY, w, h / 2);
        
        // Checkered borders (top and bottom racing stripes)
        this.drawRacingStripe(0, 0, w, 10);
        this.drawRacingStripe(0, h - 10, w, 10);
        
        // Walls with metallic shine
        const wallGrad = ctx.createLinearGradient(0, 0, w, 0);
        wallGrad.addColorStop(0, '#aa0000');
        wallGrad.addColorStop(0.5, '#ff3333');
        wallGrad.addColorStop(1, '#aa0000');
        ctx.fillStyle = wallGrad;
        const t = this.wallThickness;
        ctx.fillRect(0, 0, w, t);
        ctx.fillRect(0, h - t, w, t);
        
        const wallGrad2 = ctx.createLinearGradient(0, 0, 0, h);
        wallGrad2.addColorStop(0, '#aa0000');
        wallGrad2.addColorStop(0.5, '#ff3333');
        wallGrad2.addColorStop(1, '#aa0000');
        ctx.fillStyle = wallGrad2;
        ctx.fillRect(0, 0, t, h);
        ctx.fillRect(w - t, 0, t, h);
        
        // Center divider with pulsing glow
        this.drawDivider();
        
        // Draw puck trails
        this.drawPuckTrails();
        
        // Draw aim indicator
        if (this.selectedPuck && this.dragStart) {
            this.drawAimLine();
        }
        
        // Draw pucks with 3D effect
        this.drawPucks();
        
        // Draw particles
        this.drawParticles();
        
        // Draw impact effects
        this.drawImpactEffects();
        
        // Restore canvas transform
        ctx.restore();
        
        // Draw countdown (NOT flipped — always readable)
        if (this.countdown > 0) {
            ctx.save();
            ctx.font = 'bold 120px "Russo One"';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ff3333';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 8;
            const countdownText = this.countdown.toString();
            ctx.strokeText(countdownText, w / 2, h / 2);
            ctx.fillText(countdownText, w / 2, h / 2);
            ctx.restore();
        } else if (this.countdown === 0 && this.timeRemaining === this.gameDuration) {
            // Show "GO!" briefly
            ctx.save();
            ctx.font = 'bold 100px "Russo One"';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#00ff00';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 8;
            ctx.strokeText('GO!', w / 2, h / 2);
            ctx.fillText('GO!', w / 2, h / 2);
            ctx.restore();
            // Hide after a moment
            setTimeout(() => { this.countdown = -1; }, 500);
        }
        
        // Draw side labels (NOT flipped — always readable)
        ctx.save();
        ctx.font = '14px "Open Sans"';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillText('YOUR SIDE', w / 2, h - 25);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillText('OPPONENT', w / 2, 30);
        ctx.restore();
        
        // Sync
        this.syncPucks();
        
        // Win check
        this.checkWinCondition();
        
        requestAnimationFrame(() => this.render());
    }
    
    drawRacingStripe(x, y, width, height) {
        const ctx = this.ctx;
        const size = height;
        ctx.fillStyle = '#222';
        ctx.fillRect(x, y, width, height);
        ctx.fillStyle = '#fff';
        for (let i = 0; i < width / size; i++) {
            if (i % 2 === 0) {
                ctx.fillRect(x + i * size, y, size, size);
            }
        }
    }
    
    drawDivider() {
        const ctx = this.ctx;
        const centerY = this.boardHeight / 2;
        const t = this.wallThickness;
        const slotLeft = this.boardWidth / 2 - this.slotWidth / 2;
        const slotRight = this.boardWidth / 2 + this.slotWidth / 2;
        
        // Divider segments with gradient
        const divGrad = ctx.createLinearGradient(0, centerY, this.boardWidth, centerY);
        divGrad.addColorStop(0, '#222');
        divGrad.addColorStop(0.4, '#444');
        divGrad.addColorStop(0.6, '#444');
        divGrad.addColorStop(1, '#222');
        ctx.fillStyle = divGrad;
        ctx.fillRect(0, centerY - t / 2, slotLeft, t);
        ctx.fillRect(slotRight, centerY - t / 2, this.boardWidth - slotRight, t);
        
        // Pulsing glow effect on slot
        const glowIntensity = 0.5 + Math.sin(this.slotGlowPhase) * 0.3;
        ctx.shadowColor = `rgba(255, 100, 0, ${glowIntensity})`;
        ctx.shadowBlur = 20 + Math.sin(this.slotGlowPhase) * 10;
        
        // Slot edges with gradient
        const slotGrad = ctx.createLinearGradient(slotLeft, centerY, slotRight, centerY);
        slotGrad.addColorStop(0, '#ff6600');
        slotGrad.addColorStop(0.5, '#ffaa00');
        slotGrad.addColorStop(1, '#ff6600');
        ctx.strokeStyle = slotGrad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(slotLeft, centerY - t / 2 - 2);
        ctx.lineTo(slotLeft, centerY + t / 2 + 2);
        ctx.moveTo(slotRight, centerY - t / 2 - 2);
        ctx.lineTo(slotRight, centerY + t / 2 + 2);
        ctx.stroke();
        
        ctx.shadowBlur = 0;
        
        // Slot opening with radial gradient
        const slotCenterX = this.boardWidth / 2;
        const slotGlowGrad = ctx.createRadialGradient(slotCenterX, centerY, 0, slotCenterX, centerY, this.slotWidth);
        slotGlowGrad.addColorStop(0, `rgba(255, 150, 0, ${glowIntensity * 0.4})`);
        slotGlowGrad.addColorStop(0.5, `rgba(255, 100, 0, ${glowIntensity * 0.2})`);
        slotGlowGrad.addColorStop(1, 'rgba(255, 100, 0, 0)');
        ctx.fillStyle = slotGlowGrad;
        ctx.fillRect(slotLeft, centerY - t * 2, this.slotWidth, t * 4);
        
        // Inner edge lighting
        ctx.strokeStyle = `rgba(255, 200, 100, ${glowIntensity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(slotLeft + 2, centerY - t / 2);
        ctx.lineTo(slotLeft + 2, centerY + t / 2);
        ctx.moveTo(slotRight - 2, centerY - t / 2);
        ctx.lineTo(slotRight - 2, centerY + t / 2);
        ctx.stroke();
    }
    
    drawAimLine() {
        const ctx = this.ctx;
        const puck = this.selectedPuck;
        const dx = this.dragStart.x - this.mousePos.x;
        const dy = this.dragStart.y - this.mousePos.y;
        const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);
        
        // Draw line from puck in launch direction
        const angle = Math.atan2(dy, dx);
        const lineLen = power * 1.5;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(puck.position.x, puck.position.y);
        ctx.lineTo(
            puck.position.x + Math.cos(angle) * lineLen,
            puck.position.y + Math.sin(angle) * lineLen
        );
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Power indicator circle
        const maxR = this.puckRadius * 2;
        const powerR = this.puckRadius + (power / 150) * maxR;
        ctx.strokeStyle = `rgba(255, ${255 - power * 1.5}, 0, 0.5)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(puck.position.x, puck.position.y, powerR, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    drawPucks() {
        const ctx = this.ctx;
        
        for (const puck of this.allPucks) {
            // Puck positions are in game coords — canvas is already flipped for joiner
            const x = puck.position.x;
            const y = puck.position.y;
            const r = this.puckRadius;
            const color = puck.ownerColor;
            const isSelected = puck === this.selectedPuck;
            const canMove = this.canIMovePuck(puck);
            
            // Add trail for fast-moving pucks
            const speed = Math.sqrt(puck.velocity.x * puck.velocity.x + puck.velocity.y * puck.velocity.y);
            if (speed > 3) {
                this.addPuckTrail(x, y, color);
            }
            
            // Enhanced shadow with blur
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 4;
            ctx.shadowOffsetY = 4;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.beginPath();
            ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            // Selection ring with glow
            if (isSelected) {
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 10;
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(x, y, r + 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
            
            // 3D puck body with enhanced gradient
            const grad = ctx.createRadialGradient(x - r / 2.5, y - r / 2.5, r * 0.1, x, y, r * 1.2);
            grad.addColorStop(0, this.lightenColor(color, 80));
            grad.addColorStop(0.3, this.lightenColor(color, 40));
            grad.addColorStop(0.7, color);
            grad.addColorStop(1, this.lightenColor(color, -40));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            
            // Rim lighting (edge highlight)
            const rimGrad = ctx.createRadialGradient(x, y, r * 0.7, x, y, r);
            rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
            rimGrad.addColorStop(0.8, 'rgba(255, 255, 255, 0)');
            rimGrad.addColorStop(1, 'rgba(255, 255, 255, 0.5)');
            ctx.fillStyle = rimGrad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            
            // Outer border with depth
            ctx.strokeStyle = this.lightenColor(color, -50);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, r - 1, 0, Math.PI * 2);
            ctx.stroke();
            
            // Star emblem with embossed effect
            ctx.save();
            // Shadow for emboss
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            this.drawStar(x + 1, y + 1, r * 0.4, 5);
            // Highlight for emboss
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            this.drawStar(x - 0.5, y - 0.5, r * 0.4, 5);
            ctx.restore();
            
            // Glossy highlight (top-left shine)
            const glossGrad = ctx.createRadialGradient(x - r / 2.5, y - r / 2.5, 0, x - r / 3, y - r / 3, r / 2);
            glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
            glossGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
            glossGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = glossGrad;
            ctx.beginPath();
            ctx.arc(x - r / 3, y - r / 3, r / 2.5, 0, Math.PI * 2);
            ctx.fill();
            
            // Dim pucks I can't move
            if (!canMove) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    
    drawStar(cx, cy, radius, points) {
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const r = i % 2 === 0 ? radius : radius / 2;
            const angle = (Math.PI / points) * i - Math.PI / 2;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
    }
    
    lightenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, Math.max(0, (num >> 16) + amt));
        const G = Math.min(255, Math.max(0, (num >> 8 & 0xFF) + amt));
        const B = Math.min(255, Math.max(0, (num & 0xFF) + amt));
        return '#' + ((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1);
    }
    
    cleanup() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this.runner) Matter.Runner.stop(this.runner);
        if (this.world) Matter.World.clear(this.world);
        if (this.engine) Matter.Engine.clear(this.engine);
        this.allPucks = [];
        this.gameStarted = false;
        this.goldenGoal = false;
        
        // Clean up dynamic UI elements
        const timer = document.getElementById('game-timer');
        if (timer) timer.remove();
        const banner = document.getElementById('game-banner');
        if (banner) banner.remove();
        const detail = document.getElementById('result-detail');
        if (detail) detail.remove();
    }
}

const game = new FastrackGame();
