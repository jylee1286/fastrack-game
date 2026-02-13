// Game Engine - Physics and Rendering
class FastrackGame {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.aimIndicator = document.getElementById('aim-indicator');
        
        // Game state
        this.isHost = false;
        this.gameStarted = false;
        this.myPucks = [];
        this.opponentPucks = [];
        
        // Physics
        this.engine = null;
        this.world = null;
        this.runner = null;
        
        // Dimensions
        this.boardWidth = 800;
        this.boardHeight = 600;
        this.puckRadius = 20;
        this.slotWidth = this.puckRadius * 3; // 1.5x diameter
        this.wallThickness = 10;
        
        // Interaction
        this.selectedPuck = null;
        this.dragStart = null;
        this.mousePos = { x: 0, y: 0 };
        
        // Network sync
        this.lastSyncTime = 0;
        this.syncInterval = 33; // ~30 updates/sec
        
        // Sound
        this.audioContext = null;
        
        this.setupCanvas();
        this.setupInput();
    }
    
    setupCanvas() {
        // Make canvas responsive but maintain aspect ratio
        const resizeCanvas = () => {
            const maxWidth = window.innerWidth;
            const maxHeight = window.innerHeight - 100; // Leave room for UI
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
        // Mouse/touch events
        this.canvas.addEventListener('mousedown', (e) => this.handlePointerDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handlePointerUp(e));
        
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.handlePointerDown(touch);
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.handlePointerMove(touch);
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handlePointerUp(e);
        }, { passive: false });
    }
    
    startGame(isHost) {
        this.isHost = isHost;
        this.gameStarted = true;
        
        // Initialize audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Initialize Matter.js
        this.engine = Matter.Engine.create();
        this.world = this.engine.world;
        this.world.gravity.y = 0; // No gravity (top-down view)
        
        // Create walls and divider
        this.createBoard();
        
        // Create pucks
        this.createPucks();
        
        // Start physics runner
        this.runner = Matter.Runner.create();
        Matter.Runner.run(this.runner, this.engine);
        
        // Start render loop
        this.render();
        
        // Set up network data handler
        network.onDataReceived = (data) => this.handleNetworkData(data);
    }
    
    createBoard() {
        const { Bodies } = Matter;
        const w = this.boardWidth;
        const h = this.boardHeight;
        const t = this.wallThickness;
        
        // Create walls (static bodies)
        const wallOptions = { 
            isStatic: true, 
            restitution: 0.8,
            friction: 0.1
        };
        
        // Top and bottom walls
        const topWall = Bodies.rectangle(w / 2, t / 2, w, t, wallOptions);
        const bottomWall = Bodies.rectangle(w / 2, h - t / 2, w, t, wallOptions);
        
        // Left and right walls
        const leftWall = Bodies.rectangle(t / 2, h / 2, t, h, wallOptions);
        const rightWall = Bodies.rectangle(w - t / 2, h / 2, t, h, wallOptions);
        
        // Center divider with slot
        const dividerY = h / 2;
        const leftDivider = Bodies.rectangle(
            (w / 2 - this.slotWidth / 2) / 2,
            dividerY,
            w / 2 - this.slotWidth / 2,
            t,
            wallOptions
        );
        
        const rightDivider = Bodies.rectangle(
            w / 2 + this.slotWidth / 2 + (w / 2 - this.slotWidth / 2) / 2,
            dividerY,
            w / 2 - this.slotWidth / 2,
            t,
            wallOptions
        );
        
        Matter.World.add(this.world, [
            topWall, bottomWall, leftWall, rightWall,
            leftDivider, rightDivider
        ]);
    }
    
    createPucks() {
        const { Bodies } = Matter;
        const myColor = this.isHost ? '#ff3333' : '#3366ff';
        const opponentColor = this.isHost ? '#3366ff' : '#ff3333';
        
        // My pucks start on my side
        const myStartY = this.isHost ? this.boardHeight - 100 : 100;
        
        for (let i = 0; i < 5; i++) {
            const x = 150 + i * 120;
            const puck = Bodies.circle(x, myStartY, this.puckRadius, {
                restitution: 0.9,
                friction: 0.01,
                frictionAir: 0.02,
                density: 0.05,
                render: { fillStyle: myColor }
            });
            
            puck.isMine = true;
            puck.color = myColor;
            this.myPucks.push(puck);
            Matter.World.add(this.world, puck);
        }
        
        // Opponent pucks (we'll update their positions from network)
        const opponentStartY = this.isHost ? 100 : this.boardHeight - 100;
        
        for (let i = 0; i < 5; i++) {
            const x = 150 + i * 120;
            const puck = Bodies.circle(x, opponentStartY, this.puckRadius, {
                restitution: 0.9,
                friction: 0.01,
                frictionAir: 0.02,
                density: 0.05,
                render: { fillStyle: opponentColor },
                isStatic: true // Opponent pucks are controlled remotely
            });
            
            puck.isMine = false;
            puck.color = opponentColor;
            this.opponentPucks.push(puck);
            Matter.World.add(this.world, puck);
        }
    }
    
    handlePointerDown(e) {
        if (!this.gameStarted) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.boardWidth / rect.width;
        const scaleY = this.boardHeight / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        // Check if clicked on any of my pucks
        for (const puck of this.myPucks) {
            const dx = puck.position.x - x;
            const dy = puck.position.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < this.puckRadius) {
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
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        this.mousePos = { x, y };
        
        // Update aim indicator
        this.updateAimIndicator();
    }
    
    handlePointerUp(e) {
        if (!this.selectedPuck) return;
        
        // Calculate launch velocity
        const dx = this.dragStart.x - this.mousePos.x;
        const dy = this.dragStart.y - this.mousePos.y;
        const power = Math.sqrt(dx * dx + dy * dy);
        const maxPower = 150;
        const scale = Math.min(power / maxPower, 1) * 0.5;
        
        // Apply force
        Matter.Body.setVelocity(this.selectedPuck, {
            x: dx * scale,
            y: dy * scale
        });
        
        // Play sound
        this.playSound(200 + power * 2, 0.1);
        
        this.selectedPuck = null;
        this.dragStart = null;
        this.aimIndicator.style.display = 'none';
    }
    
    updateAimIndicator() {
        if (!this.selectedPuck || !this.dragStart) return;
        
        const dx = this.dragStart.x - this.mousePos.x;
        const dy = this.dragStart.y - this.mousePos.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width / this.boardWidth;
        const scaleY = rect.height / this.boardHeight;
        
        this.aimIndicator.style.display = 'block';
        this.aimIndicator.style.left = (this.selectedPuck.position.x * scaleX + rect.left) + 'px';
        this.aimIndicator.style.top = (this.selectedPuck.position.y * scaleY + rect.top) + 'px';
        this.aimIndicator.style.height = Math.min(length * scaleY, 200) + 'px';
        this.aimIndicator.style.transform = `rotate(${angle}deg)`;
    }
    
    handleNetworkData(data) {
        if (data.type === 'pucks') {
            // Update opponent puck positions
            data.positions.forEach((pos, i) => {
                if (i < this.opponentPucks.length) {
                    Matter.Body.setPosition(this.opponentPucks[i], pos);
                }
            });
        } else if (data.type === 'sound') {
            this.playSound(data.freq, data.duration);
        }
    }
    
    syncPucks() {
        const now = Date.now();
        if (now - this.lastSyncTime < this.syncInterval) return;
        
        this.lastSyncTime = now;
        
        // Send my puck positions
        const positions = this.myPucks.map(p => ({ x: p.position.x, y: p.position.y }));
        network.send({ type: 'pucks', positions });
    }
    
    checkWinCondition() {
        const centerY = this.boardHeight / 2;
        
        // Count pucks on my side
        let myScore = 0;
        for (const puck of this.myPucks) {
            if (this.isHost && puck.position.y > centerY) myScore++;
            if (!this.isHost && puck.position.y < centerY) myScore++;
        }
        
        // Count opponent pucks on their side
        let opponentScore = 0;
        for (const puck of this.opponentPucks) {
            if (this.isHost && puck.position.y < centerY) opponentScore++;
            if (!this.isHost && puck.position.y > centerY) opponentScore++;
        }
        
        // Update UI
        document.getElementById('your-score').textContent = myScore;
        document.getElementById('opponent-score').textContent = opponentScore;
        
        // Check win/lose
        if (myScore === 0) {
            this.endGame(true); // Win
        } else if (opponentScore === 0) {
            this.endGame(false); // Lose
        }
    }
    
    endGame(won) {
        this.gameStarted = false;
        Matter.Runner.stop(this.runner);
        
        // Show result screen
        showScreen('result-screen');
        const resultTitle = document.getElementById('result-title');
        resultTitle.textContent = won ? 'YOU WIN!' : 'YOU LOSE!';
        resultTitle.className = 'result-title ' + (won ? 'win' : 'lose');
        
        // Play result sound
        this.playSound(won ? 800 : 200, 0.5);
    }
    
    playSound(frequency, duration) {
        if (!this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }
    
    render() {
        if (!this.gameStarted) return;
        
        // Clear canvas
        this.ctx.fillStyle = '#8B4513'; // Wood color
        this.ctx.fillRect(0, 0, this.boardWidth, this.boardHeight);
        
        // Draw checkered pattern in background
        this.drawCheckers();
        
        // Draw center divider
        this.drawDivider();
        
        // Draw walls
        this.drawWalls();
        
        // Draw pucks
        this.drawPucks();
        
        // Sync pucks over network
        this.syncPucks();
        
        // Check win condition
        this.checkWinCondition();
        
        requestAnimationFrame(() => this.render());
    }
    
    drawCheckers() {
        const size = 40;
        this.ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
        for (let y = 0; y < this.boardHeight; y += size) {
            for (let x = 0; x < this.boardWidth; x += size) {
                if ((x / size + y / size) % 2 === 0) {
                    this.ctx.fillRect(x, y, size, size);
                }
            }
        }
    }
    
    drawDivider() {
        const centerY = this.boardHeight / 2;
        const t = this.wallThickness;
        
        // Draw divider segments
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(0, centerY - t / 2, this.boardWidth / 2 - this.slotWidth / 2, t);
        this.ctx.fillRect(this.boardWidth / 2 + this.slotWidth / 2, centerY - t / 2, 
                         this.boardWidth / 2 - this.slotWidth / 2, t);
        
        // Highlight slot
        this.ctx.strokeStyle = '#ff3333';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(this.boardWidth / 2 - this.slotWidth / 2, centerY - t / 2, 
                           this.slotWidth, t);
        this.ctx.setLineDash([]);
    }
    
    drawWalls() {
        const t = this.wallThickness;
        this.ctx.fillStyle = '#cc0000';
        this.ctx.fillRect(0, 0, this.boardWidth, t); // Top
        this.ctx.fillRect(0, this.boardHeight - t, this.boardWidth, t); // Bottom
        this.ctx.fillRect(0, 0, t, this.boardHeight); // Left
        this.ctx.fillRect(this.boardWidth - t, 0, t, this.boardHeight); // Right
    }
    
    drawPucks() {
        const allPucks = [...this.myPucks, ...this.opponentPucks];
        
        for (const puck of allPucks) {
            const x = puck.position.x;
            const y = puck.position.y;
            const r = this.puckRadius;
            
            // Shadow
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            this.ctx.beginPath();
            this.ctx.arc(x + 3, y + 3, r, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Puck body
            const gradient = this.ctx.createRadialGradient(x - r / 3, y - r / 3, 0, x, y, r);
            gradient.addColorStop(0, this.lightenColor(puck.color, 40));
            gradient.addColorStop(1, puck.color);
            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, r, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Star emblem
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.drawStar(x, y, r * 0.5, 5);
            
            // Highlight
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            this.ctx.beginPath();
            this.ctx.arc(x - r / 3, y - r / 3, r / 4, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
    
    drawStar(cx, cy, radius, points) {
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.beginPath();
        
        for (let i = 0; i < points * 2; i++) {
            const r = i % 2 === 0 ? radius : radius / 2;
            const angle = (Math.PI / points) * i;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
    }
    
    lightenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
                     (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
                     (B < 255 ? B < 1 ? 0 : B : 255))
                     .toString(16).slice(1);
    }
    
    cleanup() {
        if (this.runner) {
            Matter.Runner.stop(this.runner);
        }
        if (this.world) {
            Matter.World.clear(this.world);
        }
        if (this.engine) {
            Matter.Engine.clear(this.engine);
        }
        this.myPucks = [];
        this.opponentPucks = [];
        this.gameStarted = false;
    }
}

// Create global game instance
const game = new FastrackGame();
