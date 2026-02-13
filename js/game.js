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
        
        // Update UI colors to match actual player colors
        this.updateScoreColors();
        
        // Initialize audio
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Initialize Matter.js
        this.engine = Matter.Engine.create();
        this.world = this.engine.world;
        this.world.gravity.y = 0;
        
        // Collision events for sounds
        Matter.Events.on(this.engine, 'collisionStart', (event) => {
            for (const pair of event.pairs) {
                const speed = Math.sqrt(
                    Math.pow((pair.bodyA.velocity?.x || 0) - (pair.bodyB.velocity?.x || 0), 2) +
                    Math.pow((pair.bodyA.velocity?.y || 0) - (pair.bodyB.velocity?.y || 0), 2)
                );
                if (speed > 1) {
                    this.playSound(300 + speed * 30, 0.08);
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
        
        // Start timer
        this.startTimer();
        
        // Network handler
        network.onDataReceived = (data) => this.handleNetworkData(data);
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
            
            // Flash red when under 10 seconds
            if (this.timeRemaining <= 10) {
                timerEl.classList.toggle('timer-urgent');
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
            
            // Play a goal sound if the puck crossed sides
            if (prevColor !== puck.ownerColor) {
                this.playSound(600, 0.15);
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
        
        this.playSound(won ? 800 : 200, 0.5);
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
    
    render() {
        if (!this.gameStarted) return;
        
        const ctx = this.ctx;
        const w = this.boardWidth;
        const h = this.boardHeight;
        
        // Keep pucks in bounds (host only — joiner gets state from host)
        if (this.isHost) this.constrainPucks();
        
        // Flip canvas for joiner so their side is at bottom
        ctx.save();
        if (!this.isHost) {
            ctx.translate(0, h);
            ctx.scale(1, -1);
        }
        
        // Wood background
        ctx.fillStyle = '#C4933F';
        ctx.fillRect(0, 0, w, h);
        
        // Subtle wood grain
        ctx.strokeStyle = 'rgba(160, 120, 40, 0.3)';
        ctx.lineWidth = 1;
        for (let i = 0; i < h; i += 8) {
            ctx.beginPath();
            ctx.moveTo(0, i + Math.sin(i * 0.1) * 3);
            ctx.lineTo(w, i + Math.sin(i * 0.1 + 2) * 3);
            ctx.stroke();
        }
        
        // My side highlight (bottom half is always "my side" visually)
        const centerY = h / 2;
        ctx.fillStyle = 'rgba(255, 50, 50, 0.05)';
        ctx.fillRect(0, centerY, w, h / 2);
        
        // Checkered borders (top and bottom racing stripes)
        this.drawRacingStripe(0, 0, w, 10);
        this.drawRacingStripe(0, h - 10, w, 10);
        
        // Walls
        ctx.fillStyle = '#cc0000';
        const t = this.wallThickness;
        ctx.fillRect(0, 0, w, t);
        ctx.fillRect(0, h - t, w, t);
        ctx.fillRect(0, 0, t, h);
        ctx.fillRect(w - t, 0, t, h);
        
        // Center divider
        this.drawDivider();
        
        // Draw aim indicator
        if (this.selectedPuck && this.dragStart) {
            this.drawAimLine();
        }
        
        // Draw pucks
        this.drawPucks();
        
        // Restore canvas transform
        ctx.restore();
        
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
        
        // Divider segments
        ctx.fillStyle = '#333';
        ctx.fillRect(0, centerY - t / 2, slotLeft, t);
        ctx.fillRect(slotRight, centerY - t / 2, this.boardWidth - slotRight, t);
        
        // Slot glow effect
        ctx.shadowColor = '#ff6600';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = '#ff6600';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(slotLeft, centerY - t / 2);
        ctx.lineTo(slotLeft, centerY + t / 2);
        ctx.moveTo(slotRight, centerY - t / 2);
        ctx.lineTo(slotRight, centerY + t / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Slot opening highlight
        ctx.fillStyle = 'rgba(255, 100, 0, 0.15)';
        ctx.fillRect(slotLeft, centerY - t, this.slotWidth, t * 2);
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
            
            // Shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.arc(x + 3, y + 3, r, 0, Math.PI * 2);
            ctx.fill();
            
            // Selection ring
            if (isSelected) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(x, y, r + 5, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // Puck body with gradient
            const grad = ctx.createRadialGradient(x - r / 3, y - r / 3, 0, x, y, r);
            grad.addColorStop(0, this.lightenColor(color, 50));
            grad.addColorStop(1, color);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            
            // Border
            ctx.strokeStyle = this.lightenColor(color, -30);
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Star emblem
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.drawStar(x, y, r * 0.45, 5);
            
            // Highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.arc(x - r / 3, y - r / 3, r / 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Dim pucks I can't move
            if (!canMove) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
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
